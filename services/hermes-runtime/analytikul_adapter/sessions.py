"""Per-conversation agent session pool.

One AIAgent per {tenant_id}:{user_id}:{conversation_id}, evicted after
IDLE_TTL_S of inactivity. Hermes's own memory/skills persistence is disabled
(skip_memory=True) — the Analytikul memory-service owns cross-session state.

run_conversation() is synchronous, so each task runs on a worker thread; its
runtime callbacks emit onto the task's TaskEventBus. Cost metering wraps
agent.context_compressor.update_from_response — the single point every LLM
call's canonical usage flows through (agent/conversation_loop.py:1568).
"""

from __future__ import annotations

import os
import sys
import time
import uuid
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analytikul_adapter import memory, meter
from analytikul_adapter.events import TaskEventBus

logger = logging.getLogger("analytikul.sessions")

IDLE_TTL_S = int(os.environ.get("AGENT_IDLE_TTL_S", "600"))
MAX_CONCURRENT_TASKS = int(os.environ.get("AGENT_MAX_CONCURRENT", "8"))
MAX_TASKS_PER_USER = int(os.environ.get("AGENT_MAX_PER_USER", "2"))

# SECURITY: non-overridable runtime floor. With gVisor installed at the docker
# daemon (2026-06-20), code_execution and file are now unblocked — the runtime
# sandbox catches kernel-level escape attempts. The remaining entries stay
# floored because they can directly run host commands or pivot to internal
# services, neither of which gVisor mitigates on its own. Per-task ephemeral
# containers (Phase 2) will unblock 'terminal'. Must mirror FORBIDDEN_TOOLSETS
# in api/server/routes/analytikul.js for defense in depth.
# Analytikul Coder — in single-tenant personal power-mode (POWER_MODE=true, self-hosted,
# trusted operator) only live-desktop control (computer_use) stays floored; terminal /
# file / code_execution are unlocked so the agent can build & run projects like Claude Code.
# OFF by default → mirrors forbiddenToolsetsForPlan() in packages/api/src/analytikul/service.ts.
_POWER_MODE = os.environ.get("POWER_MODE", "").lower() == "true"
FORBIDDEN_TOOLSETS = frozenset(
    {"computer_use"}
    if _POWER_MODE
    else {"terminal", "computer_use", "messaging", "homeassistant"}
)

# Analytikul Coder: the bind-mounted host folder (<drive>:\Analytikul_Coder) that
# holds per-project workspaces. Each run works in WORKSPACE_ROOT/<project>.
WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", "").strip()

# Cap OUTPUT tokens. A local model whose context length == max output will otherwise
# request its full context (e.g. 65536) as output and overflow (vLLM HTTP 400 during
# context compression). 16k leaves ample room for input on a 64k model; configurable.
try:
    _AGENT_MAX_TOKENS = int(os.environ.get("AGENT_MAX_TOKENS", "16384") or "16384")
except ValueError:
    _AGENT_MAX_TOKENS = 16384


def resolve_workspace_cwd(workspace: Optional[str]) -> Optional[str]:
    """Map a project name to an absolute cwd under WORKSPACE_ROOT, creating it if
    needed. A project is a single top-level folder; path traversal / nested paths are
    rejected (fall back to the root). Returns None when no workspace root is
    configured, so the agent keeps its default cwd."""
    if not WORKSPACE_ROOT:
        return None
    root = os.path.realpath(WORKSPACE_ROOT)
    name = (workspace or "").strip().strip("/").strip("\\") or "default"
    if name in (".", "..") or "/" in name or "\\" in name:
        name = "default"
    target = os.path.realpath(os.path.join(root, name))
    if target != root and not target.startswith(root + os.sep):
        return root
    try:
        os.makedirs(target, exist_ok=True)
    except Exception:
        logger.warning("could not create workspace dir %s", target)
    return target


# ── Permission modes (Claude-Code-style) ──────────────────────────────────────
# plan        : read/plan only — edits denied, terminal/code_execution stripped.
# manual      : prompt (via the UI) before every file edit.
# accept_edits: auto-approve edits inside the workspace; sensitive paths still prompt.
# auto        : auto-approve non-sensitive edits without prompting.
# bypass      : no approval hooks at all.
PERMISSION_MODES = {"plan", "manual", "accept_edits", "auto", "bypass"}
# Toolsets stripped in plan mode (the agent may still read/search/plan).
_PLAN_DISABLED_TOOLSETS = frozenset({"terminal", "code_execution"})

# Per-task interactive approval registry: a requester (running on the agent thread)
# blocks on an Event until the UI POSTs a decision to /respond/{task_id}.
_approvals_lock = threading.Lock()
_pending_approvals: Dict[str, Dict[str, Dict[str, Any]]] = {}


def _open_approval(task_id: str, request_id: str) -> threading.Event:
    ev = threading.Event()
    with _approvals_lock:
        _pending_approvals.setdefault(task_id, {})[request_id] = {"event": ev, "decision": None}
    return ev


def resolve_approval(task_id: str, request_id: str, decision: str) -> bool:
    """Called from the /respond endpoint; unblocks the waiting requester."""
    with _approvals_lock:
        pend = _pending_approvals.get(task_id, {}).get(request_id)
        if pend is None:
            return False
        pend["decision"] = decision
        pend["event"].set()
        return True


def _read_decision(task_id: str, request_id: str) -> Optional[str]:
    with _approvals_lock:
        return _pending_approvals.get(task_id, {}).get(request_id, {}).get("decision")


def _clear_approvals(task_id: str) -> None:
    with _approvals_lock:
        _pending_approvals.pop(task_id, None)


def _make_edit_approval_requester(task_id: str, bus: "TaskEventBus", mode: str, cwd: Optional[str]):
    """Build an edit-approval requester bound to a run's permission mode."""
    from acp_adapter.edit_approval import should_auto_approve_edit

    def _prompt(proposal) -> bool:
        request_id = uuid.uuid4().hex[:12]
        ev = _open_approval(task_id, request_id)
        bus.emit(
            "permission_request",
            {
                "request_id": request_id,
                "kind": "edit",
                "tool": getattr(proposal, "tool_name", "edit"),
                "path": getattr(proposal, "path", ""),
                "old_text": (getattr(proposal, "old_text", None) or "")[:6000],
                "new_text": (getattr(proposal, "new_text", None) or "")[:6000],
            },
        )
        if not ev.wait(timeout=600):
            return False  # no response in 10 min → deny
        return _read_decision(task_id, request_id) in ("allow", "always")

    def requester(proposal) -> bool:
        if mode == "plan":
            return False  # plan mode never writes
        if mode == "auto":
            return should_auto_approve_edit(proposal, "session", cwd) or _prompt(proposal)
        if mode == "accept_edits":
            return should_auto_approve_edit(proposal, "workspace_session", cwd) or _prompt(proposal)
        # manual
        return _prompt(proposal)

    return requester


_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_TASKS, thread_name_prefix="agent")


@dataclass
class AgentSession:
    key: str
    tenant_id: str
    user_id: str
    conversation_id: str
    agent: Any
    last_used: float = field(default_factory=time.time)
    active_task_id: Optional[str] = None
    cwd: Optional[str] = None
    permission_mode: str = "plan"
    lock: threading.Lock = field(default_factory=threading.Lock)


class SessionPool:
    def __init__(self) -> None:
        self._sessions: Dict[str, AgentSession] = {}
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _key(tenant_id: str, user_id: str, conversation_id: str) -> str:
        return f"{tenant_id}:{user_id}:{conversation_id}"

    def _evict_idle(self) -> None:
        now = time.time()
        with self._lock:
            stale = [
                k
                for k, s in self._sessions.items()
                if s.active_task_id is None and now - s.last_used > IDLE_TTL_S
            ]
            for k in stale:
                del self._sessions[k]
            if stale:
                logger.info("evicted %d idle agent sessions", len(stale))

    def _user_active_count(self, user_id: str) -> int:
        return sum(
            1 for t in self._tasks.values() if t["user_id"] == user_id and not t["bus"].done.is_set()
        )

    def get_or_create(
        self,
        *,
        tenant_id: str,
        user_id: str,
        conversation_id: str,
        model: str,
        provider: str,
        api_key: str,
        base_url: str,
        enabled_toolsets: Optional[list] = None,
        disabled_toolsets: Optional[list] = None,
        workspace: Optional[str] = None,
        permission_mode: str = "plan",
    ) -> AgentSession:
        self._evict_idle()
        cwd = resolve_workspace_cwd(workspace)
        mode = permission_mode if permission_mode in PERMISSION_MODES else "plan"
        key = self._key(tenant_id, user_id, conversation_id)
        with self._lock:
            session = self._sessions.get(key)
            if session is not None:
                session.last_used = time.time()
                session.cwd = cwd
                session.permission_mode = mode
                return session

            from run_agent import AIAgent

            # Apply the non-overridable floor: strip forbidden toolsets from the
            # caller's enabled list and always union them into the disabled set,
            # regardless of what the caller supplied.
            # Plan mode strips execution toolsets (the agent may still read/plan);
            # edits are denied by the approval requester bound in _run.
            _mode_disabled = _PLAN_DISABLED_TOOLSETS if mode == "plan" else frozenset()
            safe_enabled = (
                [t for t in enabled_toolsets if t not in FORBIDDEN_TOOLSETS and t not in _mode_disabled]
                if enabled_toolsets is not None
                else None
            )
            safe_disabled = sorted(set(disabled_toolsets or []) | FORBIDDEN_TOOLSETS | _mode_disabled)

            # Seed the terminal/file tools' initial working directory to this project's
            # workspace (Hermes reads TERMINAL_CWD at agent init — mirrors the cron
            # scheduler's workdir bridge). Restored right after construction.
            _prev_tcwd = os.environ.get("TERMINAL_CWD")
            if cwd:
                os.environ["TERMINAL_CWD"] = cwd
            agent = AIAgent(
                base_url=base_url,
                api_key=api_key,
                provider=provider,
                model=model,
                skip_memory=True,
                skip_context_files=True,
                quiet_mode=True,
                save_trajectories=False,
                session_id=f"atk-{conversation_id}",
                platform="analytikul",
                enabled_toolsets=safe_enabled,
                disabled_toolsets=safe_disabled,
                max_tokens=_AGENT_MAX_TOKENS,
            )
            if cwd:
                if _prev_tcwd is None:
                    os.environ.pop("TERMINAL_CWD", None)
                else:
                    os.environ["TERMINAL_CWD"] = _prev_tcwd
            session = AgentSession(
                key=key,
                tenant_id=tenant_id,
                user_id=user_id,
                conversation_id=conversation_id,
                agent=agent,
                cwd=cwd,
                permission_mode=mode,
            )
            self._sessions[key] = session
            logger.info("created agent session %s (model=%s)", key, model)
            return session

    def start_task(self, session: AgentSession, message: str, bus: TaskEventBus) -> str:
        if self._user_active_count(session.user_id) >= MAX_TASKS_PER_USER:
            raise ConcurrencyLimit(f"user {session.user_id} already has {MAX_TASKS_PER_USER} running tasks")
        task_id = bus.task_id
        with self._lock:
            self._tasks[task_id] = {
                "bus": bus,
                "session_key": session.key,
                "user_id": session.user_id,
                "started": time.time(),
            }
        session.active_task_id = task_id
        _executor.submit(self._run, session, message, bus)
        return task_id

    def _run(self, session: AgentSession, message: str, bus: TaskEventBus) -> None:
        agent = session.agent
        # Pin this run's working directory: set_session_cwd feeds the system prompt /
        # context; TERMINAL_CWD feeds the terminal + file tools. TERMINAL_CWD is
        # process-global (as in Hermes' cron scheduler) — fine for single-user /
        # serialized runs; true per-task isolation needs per-task containers.
        cwd_token = None
        _run_prev_tcwd = os.environ.get("TERMINAL_CWD")
        if session.cwd:
            try:
                from agent.runtime_cwd import set_session_cwd

                cwd_token = set_session_cwd(session.cwd)
            except Exception:
                logger.warning("could not pin session cwd %s", session.cwd)
            os.environ["TERMINAL_CWD"] = session.cwd
            # Actually move the process into the project dir: the terminal env captures
            # os.getcwd() when it's first built and then ignores TERMINAL_CWD, so chdir
            # is the only signal every tool (terminal, file ops) reliably follows.
            # Process-global (like TERMINAL_CWD) — fine for single-user/serialized runs.
            try:
                _run_prev_cwd = os.getcwd()
                os.chdir(session.cwd)
            except Exception:
                _run_prev_cwd = None
                logger.warning("could not chdir to %s", session.cwd)
        else:
            _run_prev_cwd = None
        # Bind the permission-mode edit-approval requester (bypass = no hook, full speed).
        _approval_token = None
        if session.permission_mode != "bypass":
            try:
                from acp_adapter.edit_approval import set_edit_approval_requester

                _approval_token = set_edit_approval_requester(
                    _make_edit_approval_requester(
                        bus.task_id, bus, session.permission_mode, session.cwd
                    )
                )
            except Exception:
                logger.warning("could not bind edit approval requester")
        wired = _wire_callbacks(agent, bus, session)
        memory.register_task_context(
            bus.task_id,
            org_id=session.tenant_id,
            user_id=session.user_id,
            conversation_id=session.conversation_id,
        )
        try:
            bus.emit("status", {"state": "running", "model": agent.model})
            org_block = memory.build_memory_block(session.tenant_id, message)
            personal_block = memory.build_personal_memory_block(session.user_id, message)
            memory_block = "\n\n".join(b for b in (personal_block, org_block) if b) or None
            if memory_block is not None:
                bus.emit("status", {"state": "memory_injected"})
            result = agent.run_conversation(
                user_message=message,
                system_message=memory_block,
                task_id=bus.task_id,
                stream_callback=wired["stream"],
            )
            final = (result or {}).get("final_response")
            if (result or {}).get("failed"):
                bus.emit("error", {"message": (result or {}).get("error") or "agent run failed"})
            else:
                bus.emit("done", {"final_response": final, "interrupted": bool((result or {}).get("interrupted"))})
        except Exception as exc:
            logger.exception("agent task %s crashed", bus.task_id)
            bus.emit("error", {"message": str(exc)})
        finally:
            if _approval_token is not None:
                try:
                    from acp_adapter.edit_approval import reset_edit_approval_requester

                    reset_edit_approval_requester(_approval_token)
                except Exception:
                    pass
            _clear_approvals(bus.task_id)
            if cwd_token is not None:
                try:
                    from agent.runtime_cwd import clear_session_cwd

                    clear_session_cwd()
                except Exception:
                    pass
            if session.cwd:
                if _run_prev_tcwd is None:
                    os.environ.pop("TERMINAL_CWD", None)
                else:
                    os.environ["TERMINAL_CWD"] = _run_prev_tcwd
                if _run_prev_cwd:
                    try:
                        os.chdir(_run_prev_cwd)
                    except Exception:
                        pass
            wired["unwire"]()
            memory.clear_task_context(bus.task_id)
            session.active_task_id = None
            session.last_used = time.time()

    def cancel(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return False
            session = self._sessions.get(task["session_key"])
        if session is None or session.active_task_id != task_id:
            return False
        session.agent.interrupt("Cancelled by user from Analytikul UI")
        task["bus"].emit("status", {"state": "cancelling"})
        return True

    def get_bus(self, task_id: str) -> Optional[TaskEventBus]:
        with self._lock:
            task = self._tasks.get(task_id)
        return task["bus"] if task else None

    def reap_finished(self, max_age_s: int = 3600) -> None:
        now = time.time()
        with self._lock:
            for task_id in [
                t
                for t, info in self._tasks.items()
                if info["bus"].done.is_set() and now - info["started"] > max_age_s
            ]:
                del self._tasks[task_id]


class ConcurrencyLimit(Exception):
    pass


def _wire_callbacks(agent: Any, bus: TaskEventBus, session: AgentSession) -> Dict[str, Any]:
    """Attach per-task event + cost instrumentation to an agent; returns an unwire fn."""

    def stream(text: str) -> None:
        if text:
            bus.emit("text_chunk", {"text": text})

    def tool_start(tool_call_id: str, name: str = "", args: Any = None, *rest: Any) -> None:
        # Runtime signature: tool_start_callback(tc.id, name, args) — agent/tool_executor.py:446
        bus.emit("tool_start", {"tool": name, "call_id": tool_call_id, "args": _safe_args(args)})

    def tool_complete(tool_call_id: str, name: str = "", args: Any = None, result: Any = "", *rest: Any) -> None:
        # Runtime signature: tool_complete_callback(tc.id, name, args, result) — agent/tool_executor.py:719
        bus.emit(
            "tool_complete",
            {
                "tool": name,
                "call_id": tool_call_id,
                "output": result if isinstance(result, str) else str(result),
            },
        )

    def tool_progress(kind: str, *rest: Any) -> None:
        # Runtime signature: tool_progress_callback("tool.started"|"_thinking"|…, name, preview, args)
        name = rest[0] if rest else ""
        preview = rest[1] if len(rest) > 1 else ""
        bus.emit("tool_output", {"kind": kind, "tool": str(name), "output": str(preview)})

    def step(api_call_count: int = 0, prev_tools: Any = None, *rest: Any) -> None:
        # Runtime signature: step_callback(api_call_count, prev_tools) — agent/conversation_loop.py:512
        bus.emit("step", {"step": api_call_count, "prev_tools": _safe_args(prev_tools)})

    # NOTE: do NOT also set agent.stream_delta_callback = stream here. The delta
    # callback is delivered per-run via run_conversation(stream_callback=...) below;
    # registering it on both channels makes the runtime fire each delta twice,
    # producing doubled output ("ToTo build build ..."). Single channel only.
    agent.tool_start_callback = tool_start
    agent.tool_complete_callback = tool_complete
    agent.tool_progress_callback = tool_progress
    agent.step_callback = step

    compressor = agent.context_compressor
    original_update = compressor.update_from_response

    def metered_update(usage_dict: Dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        try:
            meter.record_llm_call(
                bus=bus,
                tenant_id=session.tenant_id,
                user_id=session.user_id,
                conversation_id=session.conversation_id,
                model=agent.model,
                provider=agent.provider,
                usage={
                    "input_tokens": usage_dict.get("input_tokens", usage_dict.get("prompt_tokens", 0)),
                    "output_tokens": usage_dict.get("output_tokens", usage_dict.get("completion_tokens", 0)),
                },
            )
        except Exception:
            logger.exception("cost metering failed (run continues)")
        return original_update(usage_dict, *args, **kwargs)

    compressor.update_from_response = metered_update

    def unwire() -> None:
        compressor.update_from_response = original_update
        agent.stream_delta_callback = None
        agent.tool_start_callback = None
        agent.tool_complete_callback = None
        agent.tool_progress_callback = None
        agent.step_callback = None

    return {"stream": stream, "unwire": unwire}


def _safe_args(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {k: _safe_args(v) for k, v in list(value.items())[:30]}
    if isinstance(value, (list, tuple)):
        return [_safe_args(v) for v in list(value)[:30]]
    return str(value)


pool = SessionPool()


def new_task_id() -> str:
    return f"task-{uuid.uuid4().hex[:16]}"
