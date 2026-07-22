"""Hermes-side code execution endpoint.

POST /v1/code/run — runs user-supplied code in a temp workdir, with hard
resource caps (CPU time, virtual memory, file size, wall-clock timeout).
Returns stdout, stderr, exit code, duration, and any artifacts the code
wrote to its workdir.

Isolation model — two paths, selected by TERMINAL_ENV:

  TERMINAL_ENV=docker (production, Phase 2 — true per-task isolation):
    - Each request runs in a FRESH ephemeral container spawned via the
      docker-socket-proxy under gVisor (runtime=runsc, supplied through
      TERMINAL_DOCKER_EXTRA_ARGS). The container has no network, a
      read-only rootfs, dropped capabilities, no-new-privileges, a pids
      cap, and a hard memory limit. It mounts ONLY this task's workdir
      (a subpath of the shared hermes-home volume) at /work — sibling
      tasks and the adapter's own home are not visible.
    - Wall-clock is bounded inside the container by `timeout` and backstopped
      by a subprocess timeout that force-removes the container.

  TERMINAL_ENV=local (dev fallback — Phase 1.5):
    - Each request runs in a fresh TemporaryDirectory in this container's
      writable layer, as a subprocess with rlimits applied via preexec_fn.
      gVisor (if installed at the daemon level) still mediates syscalls,
      but isolation is per-adapter, not per-task.

Security floor (both paths):
  - Hard caps re-applied here even though HermesProvider also caps them
    (defense in depth): timeout_ms <= 120000, memory_mb <= 2048.
  - Output truncated to STDOUT_MAX / STDERR_MAX chars to bound memory and
    serialization cost.
  - Artifacts capped by ARTIFACTS_MAX_TOTAL_BYTES; over-cap files are
    listed but content_b64 is omitted (size still reported).
  - Workdir is wiped after each run.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import resource
import subprocess
import tempfile
import time
from contextlib import contextmanager
from math import ceil
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple

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

# Languages we can run on this node.
SUPPORTED_LANGUAGES = ("python", "bash")

# ---------------------------------------------------------------------------
# Container-mode (TERMINAL_ENV=docker) configuration. All env-overridable so
# the same image works across deploys without code changes.
# ---------------------------------------------------------------------------
TERMINAL_ENV = os.environ.get("TERMINAL_ENV", "local")
# Per-task workdirs live here. Must sit inside SANDBOX_VOLUME_MOUNT so the
# spawned container can mount the matching subpath of the shared volume.
SANDBOX_DIR = os.environ.get("TERMINAL_SANDBOX_DIR", "/data/hermes/sandboxes")
# The named docker volume (daemon-visible name) shared between this adapter
# and the per-task containers, and the path it is mounted at in THIS adapter.
SANDBOX_VOLUME = os.environ.get("SANDBOX_VOLUME", "analytikul_hermes-home")
SANDBOX_VOLUME_MOUNT = os.environ.get("SANDBOX_VOLUME_MOUNT", "/data/hermes")
# Base image for per-task containers — needs python3 + bash on PATH.
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "python:3.11-slim")
# Hard cap on parallelism inside a single task container.
SANDBOX_PIDS_LIMIT = int(os.environ.get("SANDBOX_PIDS_LIMIT", "256"))
SANDBOX_TMPFS_SIZE_MB = int(os.environ.get("SANDBOX_TMPFS_SIZE_MB", "64"))
# The UID:GID the per-task container runs as (matches the adapter's `agent`
# user so workdir files round-trip readable/writable in both directions).
SANDBOX_RUN_AS = os.environ.get("SANDBOX_RUN_AS", "10001:10001")


def _parse_extra_docker_args() -> List[str]:
    """Parse TERMINAL_DOCKER_EXTRA_ARGS (a JSON list) into docker run flags.

    Defaults to the gVisor runtime when unset. A malformed value degrades to
    the secure default rather than silently dropping isolation flags.
    """
    raw = os.environ.get("TERMINAL_DOCKER_EXTRA_ARGS")
    if not raw:
        return ["--runtime=runsc"]
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        logger.warning("[code_exec] TERMINAL_DOCKER_EXTRA_ARGS not valid JSON: %r", raw)
        return ["--runtime=runsc"]
    if not isinstance(parsed, list) or not all(isinstance(a, str) for a in parsed):
        logger.warning("[code_exec] TERMINAL_DOCKER_EXTRA_ARGS must be a JSON string list")
        return ["--runtime=runsc"]
    return parsed


EXTRA_DOCKER_ARGS = _parse_extra_docker_args()


def _use_container_sandbox() -> bool:
    return TERMINAL_ENV == "docker"


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


@contextmanager
def _workdir() -> Iterator[Path]:
    """Yield a fresh per-task workdir, wiped on exit.

    In container mode the dir is created under SANDBOX_DIR (the shared volume)
    so the spawned container can mount the matching subpath. In local mode a
    plain TemporaryDirectory in the adapter's own layer is enough.
    """
    if _use_container_sandbox():
        Path(SANDBOX_DIR).mkdir(parents=True, exist_ok=True)
        raw = tempfile.mkdtemp(prefix="atk-code-", dir=SANDBOX_DIR)
        try:
            yield Path(raw)
        finally:
            _rmtree_quiet(Path(raw))
    else:
        with tempfile.TemporaryDirectory(prefix="atk-code-") as raw:
            yield Path(raw)


def _rmtree_quiet(path: Path) -> None:
    import shutil

    try:
        shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass


def _inner_command(language: str, entry_name: str, timeout_s: int) -> List[str]:
    """Build the in-container command, wrapped in `timeout` for wall-clock kill.

    `timeout -k 2 -s TERM <s>` sends SIGTERM at the deadline, then SIGKILL 2s
    later if the process ignores it. A clean timeout surfaces as exit 124.
    """
    guard = ["timeout", "-k", "2", "-s", "TERM", str(timeout_s)]
    if language == "python":
        # -I isolated, -B no bytecode (rootfs is read-only), -S no site.
        return guard + ["python3", "-I", "-B", "-S", entry_name]
    return guard + ["bash", entry_name]


def _build_docker_run(
    name: str,
    volume_subpath: str,
    memory_mb: int,
    inner_cmd: List[str],
) -> List[str]:
    """Assemble the `docker run` argv for a single hardened per-task container."""
    args = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--network=none",
        f"--memory={memory_mb}m",
        f"--memory-swap={memory_mb}m",
        "--cpus=1",
        f"--pids-limit={SANDBOX_PIDS_LIMIT}",
        "--read-only",
        "--tmpfs",
        f"/tmp:rw,size={SANDBOX_TMPFS_SIZE_MB}m,mode=1777",
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--mount",
        f"type=volume,source={SANDBOX_VOLUME},target=/work,volume-subpath={volume_subpath}",
        "-w",
        "/work",
        "--user",
        SANDBOX_RUN_AS,
        "-e",
        "HOME=/work",
        "-e",
        "LANG=C.UTF-8",
        "-e",
        "LC_ALL=C.UTF-8",
        "--label",
        "analytikul.sandbox=1",
    ]
    args += EXTRA_DOCKER_ARGS
    args += [SANDBOX_IMAGE]
    args += inner_cmd
    return args


def _docker_rm_force(name: str) -> None:
    try:
        subprocess.run(
            ["docker", "rm", "-f", name],
            capture_output=True,
            timeout=15,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        pass


def _run_in_container(
    language: str,
    workdir: Path,
    entry_name: str,
    stdin_text: str,
    timeout_ms: int,
    memory_mb: int,
) -> Tuple[int, str, str, bool]:
    """Run a single task in a fresh gVisor container. Returns (exit, out, err, timed_out)."""
    try:
        volume_subpath = workdir.relative_to(SANDBOX_VOLUME_MOUNT).as_posix()
    except ValueError:
        return (
            1,
            "",
            f"sandbox misconfigured: workdir {workdir} is not under "
            f"SANDBOX_VOLUME_MOUNT {SANDBOX_VOLUME_MOUNT}",
            False,
        )

    timeout_s = max(1, ceil(timeout_ms / 1000))
    name = f"atk-task-{workdir.name}"
    inner_cmd = _inner_command(language, entry_name, timeout_s)
    docker_cmd = _build_docker_run(name, volume_subpath, memory_mb, inner_cmd)
    # Backstop: if the in-container `timeout` is somehow defeated, kill from here.
    backstop_s = timeout_s + 10

    try:
        proc = subprocess.run(  # nosec — per-task container is the isolation boundary
            docker_cmd,
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=backstop_s,
        )
    except subprocess.TimeoutExpired as e:
        _docker_rm_force(name)
        stdout = _as_text(e.stdout)
        stderr = _as_text(e.stderr)
        return -1, stdout, stderr + f"\n[killed: exceeded timeout_ms={timeout_ms}]", True

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    timed_out = proc.returncode == 124
    if timed_out:
        stderr += f"\n[killed: exceeded timeout_ms={timeout_ms}]"
    return proc.returncode, stdout, stderr, timed_out


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.decode("utf-8", "replace")


def _run_subprocess(
    cmd: List[str],
    workdir: Path,
    stdin_text: str,
    timeout_ms: int,
    memory_mb: int,
) -> Tuple[int, str, str, bool]:
    """Run cmd in workdir with the given caps. Returns (exit, stdout, stderr, timed_out)."""
    timeout_s = timeout_ms / 1000.0
    try:
        proc = subprocess.run(  # nosec — local dev fallback, gated by runsc at daemon level
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
        stdout = _as_text(e.stdout)
        stderr = _as_text(e.stderr)
        return -1, stdout, stderr + f"\n[killed: exceeded timeout_ms={timeout_ms}]", True


def _error_result(start: float, message: str) -> Dict[str, Any]:
    return {
        "exit_code": 1,
        "stdout": "",
        "stderr": message,
        "duration_ms": int((time.perf_counter() - start) * 1000),
        "artifacts": [],
        "error_kind": "runtime_error",
    }


def _write_entry(workdir: Path, language: str, code: str) -> str:
    """Write the code to its entry file and return the entry file name."""
    if language == "python":
        (workdir / "_main.py").write_text(code, encoding="utf-8")
        return "_main.py"
    entry = workdir / "_main.sh"
    entry.write_text(code, encoding="utf-8")
    entry.chmod(0o755)
    return "_main.sh"


def run_code(body: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for POST /v1/code/run."""
    start = time.perf_counter()
    ok, err = _validate_request(body)
    if not ok:
        return _error_result(start, f"invalid request: {err}")

    language: str = body["language"]
    code: str = body["code"]
    timeout_ms: int = body.get("timeout_ms", 30_000)
    memory_mb: int = body.get("memory_mb", 512)
    stdin_text: str = body.get("stdin") or ""
    input_files: List[Dict[str, Any]] = body.get("files") or []

    user_id = body.get("user_id")
    conversation_id = body.get("conversation_id")
    logger.info(
        "[code_exec] run lang=%s mode=%s user=%s conv=%s code_len=%d timeout=%dms mem=%dMB",
        language,
        "docker" if _use_container_sandbox() else "subprocess",
        user_id,
        conversation_id,
        len(code),
        timeout_ms,
        memory_mb,
    )

    with _workdir() as workdir:
        try:
            _drop_input_files(workdir, input_files)
        except ValueError as e:
            return _error_result(start, str(e))

        input_paths = {entry["path"] for entry in input_files}
        entry_name = _write_entry(workdir, language, code)

        if _use_container_sandbox():
            exit_code, stdout, stderr, timed_out = _run_in_container(
                language, workdir, entry_name, stdin_text, timeout_ms, memory_mb
            )
        else:
            cmd = (
                ["python3", "-I", "-S", entry_name]
                if language == "python"
                else ["bash", entry_name]
            )
            exit_code, stdout, stderr, timed_out = _run_subprocess(
                cmd, workdir, stdin_text, timeout_ms, memory_mb
            )

        # Drop the runner's own entry file from artifacts so we don't return
        # the user's source code back to them.
        input_paths.add(entry_name)
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
