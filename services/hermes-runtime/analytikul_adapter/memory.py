"""Org-memory integration: retrieval injection + the save_to_org_memory tool.

Before each run, the top-K org memories relevant to the user's message are
injected as a compact system block (lineage included, ~200 token budget).
The save_to_org_memory tool lets the agent persist durable facts for the whole
organization; task context (org/user/conversation) is resolved via task_id.
"""

from __future__ import annotations

import os
import json
import logging
import threading
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger("analytikul.memory")

MEMORY_URL = os.environ.get("MEMORY_SERVICE_URL", "http://memory-service:8012")
INJECT_LIMIT = 5
INJECT_CHAR_BUDGET = 800


def _internal_headers() -> dict:
    token = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    return {"x-internal-token": token} if token else {}

_task_context: Dict[str, Dict[str, str]] = {}
_lock = threading.Lock()


def register_task_context(task_id: str, *, org_id: str, user_id: str, conversation_id: str) -> None:
    with _lock:
        if len(_task_context) > 1000:
            _task_context.pop(next(iter(_task_context)))
        _task_context[task_id] = {
            "org_id": org_id,
            "user_id": user_id,
            "conversation_id": conversation_id,
        }


def clear_task_context(task_id: str) -> None:
    with _lock:
        _task_context.pop(task_id, None)


def build_memory_block(org_id: str, query: str) -> Optional[str]:
    """Top-K relevant org memories as a compact system block, or None."""
    try:
        res = requests.get(
            f"{MEMORY_URL}/memories/search",
            params={"q": query[:1000], "orgId": org_id, "limit": INJECT_LIMIT},
            headers=_internal_headers(),
            timeout=5,
        )
        res.raise_for_status()
        memories = res.json().get("memories", [])
    except Exception as exc:
        logger.warning("memory retrieval skipped: %s", exc)
        return None

    relevant = [m for m in memories if m.get("similarity", 0) > 0.35]
    if not relevant:
        return None

    used = 0
    lines = []
    for memory in relevant:
        content = memory["content"].strip()
        if used + len(content) > INJECT_CHAR_BUDGET:
            content = content[: max(INJECT_CHAR_BUDGET - used, 0)]
        if not content:
            break
        used += len(content)
        lines.append(f"- {content} (saved by {memory['source_user_id']}, id {memory['id']})")

    if not lines:
        return None
    return (
        "## Organization memory (shared knowledge saved by your team)\n"
        + "\n".join(lines)
        + "\nUse these facts when relevant. To save a new durable fact for the team, call save_to_org_memory."
    )


def _save_handler(args: Dict[str, Any], **kwargs: Any) -> str:
    task_id = kwargs.get("task_id")
    with _lock:
        ctx = _task_context.get(task_id or "", {})
    content = (args.get("content") or "").strip()
    if not content:
        return json.dumps({"status": "error", "message": "content is required"})
    if len(content) > 2000:
        return json.dumps({"status": "error", "message": "content too long (max 2000 chars)"})
    try:
        res = requests.post(
            f"{MEMORY_URL}/memories",
            json={
                "orgId": ctx.get("org_id", "default"),
                "content": content,
                "sourceUserId": ctx.get("user_id", "agent"),
                "sourceConversationId": ctx.get("conversation_id"),
                "sourceTaskId": task_id,
                "tags": args.get("tags") or [],
            },
            headers=_internal_headers(),
            timeout=10,
        )
        res.raise_for_status()
        memory_id = res.json().get("memory", {}).get("id")
        return json.dumps({"status": "saved", "memory_id": memory_id})
    except Exception as exc:
        logger.warning("save_to_org_memory failed: %s", exc)
        return json.dumps({"status": "error", "message": str(exc)})


def register_memory_tool() -> None:
    from tools.registry import registry

    registry.register(
        name="save_to_org_memory",
        toolset="planning",
        schema={
            "name": "save_to_org_memory",
            "description": (
                "Save a durable fact to the shared organizational memory so every teammate's "
                "agent can recall it later. Use for decisions, conventions, infrastructure facts, "
                "and preferences worth remembering — not transient task details."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The fact to remember, stated plainly and self-contained.",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional category tags (e.g. infra, decision, convention).",
                    },
                },
                "required": ["content"],
            },
        },
        handler=_save_handler,
        description="Save a durable fact to shared org memory",
        emoji="🧠",
    )
    logger.info("save_to_org_memory tool registered")
