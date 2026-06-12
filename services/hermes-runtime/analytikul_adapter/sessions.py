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
    ) -> AgentSession:
        self._evict_idle()
        key = self._key(tenant_id, user_id, conversation_id)
        with self._lock:
            session = self._sessions.get(key)
            if session is not None:
                session.last_used = time.time()
                return session

            from run_agent import AIAgent

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
                enabled_toolsets=enabled_toolsets,
                disabled_toolsets=disabled_toolsets or ["messaging", "homeassistant", "computer_use"],
            )
            session = AgentSession(
                key=key,
                tenant_id=tenant_id,
                user_id=user_id,
                conversation_id=conversation_id,
                agent=agent,
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
        wired = _wire_callbacks(agent, bus, session)
        memory.register_task_context(
            bus.task_id,
            org_id=session.tenant_id,
            user_id=session.user_id,
            conversation_id=session.conversation_id,
        )
        try:
            bus.emit("status", {"state": "running", "model": agent.model})
            memory_block = memory.build_memory_block(session.tenant_id, message)
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

    agent.stream_delta_callback = stream
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
