"""Hermes-side code execution endpoint — STUB.

This module owns POST /v1/code/run on the analytikul-hermes-adapter HTTP
server. The Node-side LibreChat tool layer calls this when LibreChat's
main-chat `bash_tool` / `read_file` tools are invoked, routed through
packages/api/src/tools/codeExec/hermesProvider.ts.

CURRENT STATE: stub only — returns 501 with a clear "not yet implemented"
body so the provider abstraction can be wired end-to-end and the agent
gets a coherent failure message instead of a hang.

NEXT SESSION (real implementation):
  1. Spawn an ephemeral container per request via the docker-socket-proxy
     under runsc (gVisor). Mount the request's `files` into /workdir.
  2. Run the requested language (python3 / node / bash) with strict
     resource limits (cpu, memory_mb, timeout_ms).
  3. Capture stdout/stderr (truncated to a sensible max).
  4. Walk /workdir for artifacts the code produced, base64-encode.
  5. Tear down the container; return the JSON result the TS provider
     expects (exit_code, stdout, stderr, duration_ms, artifacts, error_kind).

Security floor (must hold even before the real implementation lands):
  - Authentication via INTERNAL_SERVICE_TOKEN header (already in middleware).
  - Per-user resource accounting (user_id forwarded by the TS provider).
  - Hard caps: timeout_ms <= 120_000, memory_mb <= 2048 (enforced both here
    and in HermesProvider).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict

logger = logging.getLogger("analytikul.code_exec")

# Resource hard caps — mirror packages/api/src/tools/codeExec/hermesProvider.ts.
MAX_TIMEOUT_MS = 120_000
MAX_MEMORY_MB = 2048


def _validate_request(body: Dict[str, Any]) -> tuple[bool, str]:
    """Return (ok, error_message). Same shape used by Hermes' other routes."""
    if not isinstance(body, dict):
        return False, "request body must be a JSON object"
    language = body.get("language")
    if language not in ("python", "javascript", "bash"):
        return False, f"unsupported language: {language!r}"
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
    return True, ""


def run_code(body: Dict[str, Any]) -> Dict[str, Any]:
    """Stub handler for POST /v1/code/run.

    Validates the request shape, then returns a 501-equivalent error result
    until the real container-spawning implementation lands. The caller
    (HermesProvider in packages/api) interprets this as a non-throwing
    "provider unavailable" outcome and surfaces it to the agent cleanly.
    """
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

    logger.info(
        "[code_exec] STUB hit: lang=%s user=%s conv=%s code_len=%d",
        body.get("language"),
        body.get("user_id"),
        body.get("conversation_id"),
        len(body.get("code") or ""),
    )

    return {
        "exit_code": 1,
        "stdout": "",
        "stderr": (
            "Hermes code execution endpoint is not yet implemented. "
            "The provider abstraction is wired, but the per-task sandbox "
            "runner has not been built. This message confirms the request "
            "reached Hermes; once the runner lands, your code will execute."
        ),
        "duration_ms": int((time.perf_counter() - start) * 1000),
        "artifacts": [],
        "error_kind": "provider_unconfigured",
    }


__all__ = ["run_code", "MAX_TIMEOUT_MS", "MAX_MEMORY_MB"]
