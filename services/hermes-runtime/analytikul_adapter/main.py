"""Analytikul agent adapter — internal-only FastAPI service wrapping the Hermes runtime.

Endpoints (never publicly proxied; only the Express backend talks to this):
  POST /run                 start an agent task, returns {task_id}
  GET  /stream/{task_id}    SSE: replay history then live events until done/error
  POST /cancel/{task_id}    interrupt a running task
  GET  /tools               live tool catalog from the Hermes registry
  GET  /health              liveness + pinned runtime version
"""

from __future__ import annotations

import os
import sys
import asyncio
import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analytikul_adapter.events import TaskEventBus
from analytikul_adapter.sessions import ConcurrencyLimit, new_task_id, pool

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("analytikul.adapter")

HERMES_PIN = "484f484c25bc89fbddc73f1d80410e99e6133fd5"
STREAM_IDLE_TIMEOUT_S = 120

app = FastAPI(title="analytikul-hermes-adapter", version="0.3.0")


@app.on_event("startup")
def _register_tools() -> None:
    try:
        from analytikul_adapter.memory import register_memory_tool

        register_memory_tool()
    except Exception:
        logger.exception("save_to_org_memory registration failed (runs continue without it)")


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    tenant_id: str = "default"
    user_id: str
    conversation_id: str
    model: str = ""
    provider: str = "openrouter"
    api_key: str = ""
    base_url: str = "https://openrouter.ai/api/v1"
    enabled_toolsets: Optional[List[str]] = None
    disabled_toolsets: Optional[List[str]] = None


@app.get("/health")
def health():
    return {"status": "ok", "adapter": "0.2.0", "hermes_pin": HERMES_PIN}


@app.get("/tools")
def tools():
    try:
        from model_tools import get_tool_definitions

        definitions = get_tool_definitions(quiet_mode=True)
        return {
            "tools": [
                {
                    "name": d["function"]["name"],
                    "description": (d["function"].get("description") or "")[:200],
                }
                for d in definitions
                if d.get("function")
            ]
        }
    except Exception as exc:
        logger.exception("tool catalog unavailable")
        raise HTTPException(status_code=503, detail=f"tool registry error: {exc}")


@app.post("/run")
async def run(req: RunRequest):
    api_key = req.api_key or os.environ.get("AGENT_DEFAULT_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="no API key: pass api_key or set AGENT_DEFAULT_API_KEY")

    loop = asyncio.get_running_loop()
    task_id = new_task_id()
    bus = TaskEventBus(task_id=task_id, loop=loop)

    try:
        session = await asyncio.to_thread(
            lambda: pool.get_or_create(
                tenant_id=req.tenant_id,
                user_id=req.user_id,
                conversation_id=req.conversation_id,
                model=req.model,
                provider=req.provider,
                api_key=api_key,
                base_url=req.base_url,
                enabled_toolsets=req.enabled_toolsets,
                disabled_toolsets=req.disabled_toolsets,
            )
        )
        if session.active_task_id is not None:
            raise HTTPException(status_code=409, detail="a task is already running in this conversation")
        pool.start_task(session, req.message, bus)
    except ConcurrencyLimit as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("failed to start task")
        raise HTTPException(status_code=500, detail=str(exc))

    pool.reap_finished()
    return {"task_id": task_id}


@app.get("/stream/{task_id}")
async def stream(task_id: str):
    bus = pool.get_bus(task_id)
    if bus is None:
        raise HTTPException(status_code=404, detail="unknown task_id")

    async def generate():
        # Replay history, then drain live events; every event is in both history
        # and the queue, so skip queued events at or below the replayed seq.
        replayed_seq = 0
        for event in list(bus.history):
            replayed_seq = event["seq"]
            yield bus.sse_format(event)
            if event["type"] in ("done", "error"):
                return
        while True:
            try:
                event = await asyncio.wait_for(bus.queue.get(), timeout=STREAM_IDLE_TIMEOUT_S)
            except asyncio.TimeoutError:
                if bus.done.is_set():
                    return
                yield ": keep-alive\n\n"
                continue
            if event["seq"] <= replayed_seq:
                continue
            yield bus.sse_format(event)
            if event["type"] in ("done", "error"):
                return

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/cancel/{task_id}")
def cancel(task_id: str):
    if not pool.cancel(task_id):
        raise HTTPException(status_code=404, detail="no running task with that id")
    return {"cancelled": True, "task_id": task_id}
