"""Analytikul client-side (bridge) tool execution.

Bridge runs hand file/terminal tool calls to a bridge process on the user's own
machine instead of running them inside the container.  A client tool executor is
bound in a ContextVar for the duration of one bridge run; container runs leave it
unset and therefore dispatch those tools locally, exactly as before.

Pending results are keyed by task_id + request_id: the agent thread blocks on a
``threading.Event`` until the adapter's ``/tool_result`` endpoint resolves it with
the string the client produced.  This mirrors the approval registry in
``analytikul_adapter/sessions.py`` and the ContextVar-bound requester pattern in
``acp_adapter/edit_approval.py``.
"""

from __future__ import annotations

import json
import logging
import threading
from contextvars import ContextVar, Token
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("analytikul.client_exec")

BRIDGE_ELIGIBLE = {"terminal", "read_file", "write_file", "patch", "search_files"}

ClientToolExecutor = Callable[[str, dict], str]

_CLIENT_TOOL_EXECUTOR: ContextVar[Optional[ClientToolExecutor]] = ContextVar(
    "ANALYTIKUL_CLIENT_TOOL_EXECUTOR",
    default=None,
)

_results_lock = threading.Lock()
_pending_results: Dict[str, Dict[str, Dict[str, Any]]] = {}


def open_result(task_id: str, request_id: str) -> threading.Event:
    """Register a pending client-tool result and return the Event to wait on."""

    ev = threading.Event()
    with _results_lock:
        _pending_results.setdefault(task_id, {})[request_id] = {"event": ev, "result": None}
    return ev


def resolve_result(task_id: str, request_id: str, result: str) -> bool:
    """Called from the /tool_result endpoint; unblocks the waiting executor."""

    with _results_lock:
        pend = _pending_results.get(task_id, {}).get(request_id)
        if pend is None:
            return False
        pend["result"] = result
        pend["event"].set()
        return True


def read_result(task_id: str, request_id: str) -> Optional[str]:
    with _results_lock:
        pend = _pending_results.get(task_id, {}).get(request_id)
        return pend.get("result") if pend else None


def forget_task(task_id: str) -> None:
    with _results_lock:
        _pending_results.pop(task_id, None)


def set_client_tool_executor(fn: Optional[ClientToolExecutor]) -> Token:
    """Bind a client tool executor for the current context."""

    return _CLIENT_TOOL_EXECUTOR.set(fn)


def reset_client_tool_executor(token: Token) -> None:
    """Restore a previous client tool executor binding."""

    _CLIENT_TOOL_EXECUTOR.reset(token)


def get_client_tool_executor() -> Optional[ClientToolExecutor]:
    return _CLIENT_TOOL_EXECUTOR.get()


def maybe_execute_on_client(tool_name: str, args: dict) -> Optional[str]:
    """Route a tool call to the bound client executor when eligible.

    Returns the executor's string result, or a JSON error string when the
    requester raises.  Returns ``None`` when no executor is bound or the tool is
    not bridge-eligible, so local dispatch continues unchanged.  This is the only
    behavioral change to non-bridge runs, and it is a no-op when unbound.
    """

    executor = get_client_tool_executor()
    if executor is None or tool_name not in BRIDGE_ELIGIBLE:
        return None
    try:
        return executor(tool_name, args)
    except Exception as exc:
        logger.warning("client tool executor failed for %s: %s", tool_name, exc)
        return json.dumps({"error": str(exc)}, ensure_ascii=False)
