"""Hermes-side code execution endpoint.

POST /v1/code/run — runs user-supplied code in a temp workdir on this
container, with hard resource caps (CPU time, virtual memory, file size,
wall-clock timeout). Returns stdout, stderr, exit code, duration, and
any artifacts the code wrote to its workdir.

Today's isolation model (Phase 1 + Phase 1.5):
  - gVisor (runsc) is installed at the docker daemon level on linuxg3,
    so syscalls from THIS container are mediated by runsc.
  - Each request runs in a fresh TemporaryDirectory inside this
    container's writable layer. Subprocess runs with rlimits applied
    via preexec_fn.
  - Code runs as the same uid as the hermes-adapter process — NOT root.

Phase 2 (deferred — needs docker-socket-proxy + docker-cli in this image):
  - Spawn a fresh ephemeral container per request via the proxy under
    runsc. True per-task isolation. The HTTP shape doesn't change; the
    `_run_python` / `_run_bash` helpers will be replaced with a single
    `docker run --runtime=runsc ...` invocation.

Security floor:
  - Hard caps capped again here even though HermesProvider also caps
    them (defense in depth): timeout_ms <= 120000, memory_mb <= 2048.
  - Output is truncated to STDOUT_MAX / STDERR_MAX chars to bound
    memory and serialization cost.
  - Artifacts capped by ARTIFACTS_MAX_TOTAL_BYTES; over-cap files
    are listed but content_b64 is omitted (size still reported).
  - Workdir is wiped (TemporaryDirectory context) after each run.
"""

from __future__ import annotations

import base64
import logging
import os
import resource
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("analytikul.code_exec")

# Caps — mirror packages/api/src/tools/codeExec/hermesProvider.ts.
MAX_TIMEOUT_MS = 120_000
MAX_MEMORY_MB = 2048

# Output caps so a runaway loop printing forever can't OOM the adapter.
STDOUT_MAX = 100_000  # chars
STDERR_MAX = 50_000

# Artifact caps so a hostile script can't return a 4GB file.
ARTIFACTS_MAX_TOTAL_BYTES = 16 * 1024 * 1024  # 16 MB total across all artifacts
ARTIFACTS_MAX_FILE_BYTES = 8 * 1024 * 1024  # 8 MB per file
ARTIFACTS_MAX_COUNT = 32

# Languages we can run in this container today (Phase 1 / 1.5).
SUPPORTED_LANGUAGES = ("python", "bash")


def _validate_request(body: Dict[str, Any]) -> Tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "request body must be a JSON object"
    language = body.get("language")
    if language not in ("python", "javascript", "bash"):
        return False, f"unsupported language: {language!r}"
    if language not in SUPPORTED_LANGUAGES:
        return (
            False,
            f"language {language!r} not available on this Hermes node yet "
            f"(supported: {', '.join(SUPPORTED_LANGUAGES)})",
        )
    code = body.get("code")
    if not isinstance(code, str) or len(code) == 0:
        return False, "code must be a non-empty string"
    if len(code) > 200_000:
        return False, "code exceeds 200,000 character limit"
    timeout_ms = body.get("timeout_ms", 30_000)
    if not isinstance(timeout_ms, int) or timeout_ms < 1000 or timeout_ms > MAX_TIMEOUT_MS:
        return False, f"timeout_ms must be 1000..{MAX_TIMEOUT_MS}"
    memory_mb = body.get("memory_mb", 512)
    if not isinstance(memory_mb, int) or memory_mb < 64 or memory_mb > MAX_MEMORY_MB:
        return False, f"memory_mb must be 64..{MAX_MEMORY_MB}"
    files = body.get("files", [])
    if not isinstance(files, list):
        return False, "files must be an array"
    if len(files) > 64:
        return False, "files: max 64 entries"
    for entry in files:
        if not isinstance(entry, dict):
            return False, "files: each entry must be an object"
        path = entry.get("path")
        if not isinstance(path, str) or not path:
            return False, "files: missing path"
        # No traversal, no absolutes
        if path.startswith("/") or ".." in Path(path).parts:
            return False, f"files: unsafe path {path!r}"
        if not isinstance(entry.get("content_b64"), str):
            return False, "files: missing content_b64"
    return True, ""


def _make_rlimit_setter(memory_mb: int, timeout_ms: int):
    """Build a preexec_fn that applies rlimits to the child process.

    RLIMIT_AS = total virtual memory bytes
    RLIMIT_CPU = CPU seconds (kills with SIGKILL when hit)
    RLIMIT_FSIZE = max bytes written to any single file
    """
    mem_bytes = memory_mb * 1024 * 1024
    cpu_seconds = max(1, int(timeout_ms / 1000) + 1)

    def _set():
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(
                resource.RLIMIT_FSIZE,
                (ARTIFACTS_MAX_FILE_BYTES, ARTIFACTS_MAX_FILE_BYTES),
            )
        except (ValueError, OSError):
            pass

    return _set


def _drop_input_files(workdir: Path, files: List[Dict[str, Any]]) -> None:
    for entry in files:
        target = workdir / entry["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = base64.b64decode(entry["content_b64"], validate=False)
        except Exception as e:
            raise ValueError(f"file {entry['path']!r}: base64 decode failed: {e}") from e
        target.write_bytes(data)


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n[... truncated {len(text) - max_chars} chars]"


def _collect_artifacts(
    workdir: Path,
    input_paths: set[str],
) -> Tuple[List[Dict[str, Any]], int]:
    """Walk workdir, returning any new files (not in input_paths) as artifacts.

    Returns (artifacts_list, num_skipped_due_to_size).
    """
    artifacts: List[Dict[str, Any]] = []
    skipped = 0
    total_bytes = 0
    for path in sorted(workdir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(workdir).as_posix()
        if rel in input_paths:
            continue
        if len(artifacts) >= ARTIFACTS_MAX_COUNT:
            skipped += 1
            continue
        size = path.stat().st_size
        if total_bytes + size > ARTIFACTS_MAX_TOTAL_BYTES or size > ARTIFACTS_MAX_FILE_BYTES:
            artifacts.append(
                {
                    "path": rel,
                    "content_b64": "",
                    "size": size,
                    "mime": None,
                }
            )
            skipped += 1
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        total_bytes += len(data)
        artifacts.append(
            {
                "path": rel,
                "content_b64": base64.b64encode(data).decode("ascii"),
                "size": len(data),
                "mime": None,
            }
        )
    return artifacts, skipped


def _classify_exit(exit_code: int, stderr: str, timed_out: bool) -> str:
    if timed_out:
        return "timeout"
    if exit_code == 0:
        return "ok"
    s = (stderr or "").lower()
    if "memoryerror" in s or "killed" in s or "out of memory" in s:
        return "oom"
    if "syntaxerror" in s or "indentationerror" in s:
        return "syntax_error"
    return "runtime_error"


def _run_subprocess(
    cmd: List[str],
    workdir: Path,
    stdin_text: str,
    timeout_ms: int,
    memory_mb: int,
) -> Tuple[int, str, str, bool]:
    """Run cmd in workdir with the given caps. Returns (exit, stdout, stderr, timed_out)."""
    timed_out = False
    timeout_s = timeout_ms / 1000.0
    try:
        proc = subprocess.run(  # nosec — caller is internal Express, code path is gated by runsc at daemon level
            cmd,
            cwd=str(workdir),
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=timeout_s,
            preexec_fn=_make_rlimit_setter(memory_mb, timeout_ms),
            env={
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "HOME": str(workdir),
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
            },
        )
        return proc.returncode, proc.stdout or "", proc.stderr or "", False
    except subprocess.TimeoutExpired as e:
        timed_out = True
        stdout = (e.stdout or "") if isinstance(e.stdout, str) else (e.stdout or b"").decode("utf-8", "replace")
        stderr = (e.stderr or "") if isinstance(e.stderr, str) else (e.stderr or b"").decode("utf-8", "replace")
        return -1, stdout, stderr + f"\n[killed: exceeded timeout_ms={timeout_ms}]", True


def run_code(body: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for POST /v1/code/run."""
    start = time.perf_counter()
    ok, err = _validate_request(body)
    if not ok:
        return {
            "exit_code": 1,
            "stdout": "",
            "stderr": f"invalid request: {err}",
            "duration_ms": int((time.perf_counter() - start) * 1000),
            "artifacts": [],
            "error_kind": "runtime_error",
        }

    language: str = body["language"]
    code: str = body["code"]
    timeout_ms: int = body.get("timeout_ms", 30_000)
    memory_mb: int = body.get("memory_mb", 512)
    stdin_text: str = body.get("stdin") or ""
    input_files: List[Dict[str, Any]] = body.get("files") or []

    user_id = body.get("user_id")
    conversation_id = body.get("conversation_id")
    logger.info(
        "[code_exec] run lang=%s user=%s conv=%s code_len=%d timeout=%dms mem=%dMB",
        language,
        user_id,
        conversation_id,
        len(code),
        timeout_ms,
        memory_mb,
    )

    with tempfile.TemporaryDirectory(prefix="atk-code-") as raw_dir:
        workdir = Path(raw_dir)
        try:
            _drop_input_files(workdir, input_files)
        except ValueError as e:
            return {
                "exit_code": 1,
                "stdout": "",
                "stderr": str(e),
                "duration_ms": int((time.perf_counter() - start) * 1000),
                "artifacts": [],
                "error_kind": "runtime_error",
            }

        input_paths = {entry["path"] for entry in input_files}

        if language == "python":
            entry = workdir / "_main.py"
            entry.write_text(code, encoding="utf-8")
            cmd = ["python3", "-I", "-S", "_main.py"]
        elif language == "bash":
            entry = workdir / "_main.sh"
            entry.write_text(code, encoding="utf-8")
            entry.chmod(0o755)
            cmd = ["bash", "_main.sh"]
        else:
            return {
                "exit_code": 1,
                "stdout": "",
                "stderr": f"language {language!r} not supported on this node",
                "duration_ms": int((time.perf_counter() - start) * 1000),
                "artifacts": [],
                "error_kind": "runtime_error",
            }

        exit_code, stdout, stderr, timed_out = _run_subprocess(
            cmd, workdir, stdin_text, timeout_ms, memory_mb
        )
        # Drop the runner's own entry file from artifacts so we don't return
        # the user's source code back to them.
        input_paths.add(entry.relative_to(workdir).as_posix())
        artifacts, _skipped = _collect_artifacts(workdir, input_paths)

    duration_ms = int((time.perf_counter() - start) * 1000)
    error_kind = _classify_exit(exit_code, stderr, timed_out)

    return {
        "exit_code": exit_code,
        "stdout": _truncate(stdout, STDOUT_MAX),
        "stderr": _truncate(stderr, STDERR_MAX),
        "duration_ms": duration_ms,
        "artifacts": artifacts,
        "error_kind": error_kind,
    }


__all__ = [
    "run_code",
    "MAX_TIMEOUT_MS",
    "MAX_MEMORY_MB",
    "SUPPORTED_LANGUAGES",
]
