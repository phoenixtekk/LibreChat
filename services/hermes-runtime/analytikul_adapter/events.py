"""Typed event stream between a running agent task and its SSE consumers.

One TaskEventBus per task_id. The Hermes runtime fires synchronous callbacks
from a worker thread; the FastAPI SSE generator consumes from an asyncio-safe
queue. Events follow the @analytikul/shared contract:
text_chunk | tool_start | tool_output | tool_complete | step | cost_event |
status | done | error
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

MAX_QUEUE = 2000
MAX_PAYLOAD_CHARS = 64_000


@dataclass
class TaskEventBus:
    task_id: str
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(MAX_QUEUE))
    history: List[Dict[str, Any]] = field(default_factory=list)
    done: threading.Event = field(default_factory=threading.Event)
    seq: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def emit(self, event_type: str, payload: Optional[Dict[str, Any]] = None) -> None:
        """Thread-safe emit from runtime callbacks (worker thread) to the SSE loop."""
        with self._lock:
            self.seq += 1
            event = {
                "type": event_type,
                "seq": self.seq,
                "ts": time.time(),
                "task_id": self.task_id,
                **(payload or {}),
            }
        event = _truncate(event)
        self.history.append(event)
        self.loop.call_soon_threadsafe(self._put, event)
        if event_type in ("done", "error"):
            self.done.set()

    def _put(self, event: Dict[str, Any]) -> None:
        try:
            self.queue.put_nowait(event)
        except asyncio.QueueFull:
            pass

    def sse_format(self, event: Dict[str, Any]) -> str:
        return f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"


def _truncate(event: Dict[str, Any]) -> Dict[str, Any]:
    for key in ("text", "output", "result"):
        value = event.get(key)
        if isinstance(value, str) and len(value) > MAX_PAYLOAD_CHARS:
            event[key] = value[:MAX_PAYLOAD_CHARS]
            event[f"{key}_truncated"] = True
    return event
