"""Agent tools for the Notes workspace: search_notes, view_note, write_note.

Open WebUI-parity agentic note access. Tools resolve the acting user from the
task context (same mechanism as memory.py) and are scoped to that user's own
notes plus org-shared notes — an agent can never read another user's private
notes.
"""

from __future__ import annotations

import os
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict

logger = logging.getLogger("analytikul.notes")

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongodb:27017/LibreChat")

_client = None


def _notes():
    global _client
    if _client is None:
        from pymongo import MongoClient

        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=4000)
    return _client.get_default_database()["notes"]


def _ctx(kwargs: Dict[str, Any]) -> Dict[str, str]:
    from analytikul_adapter.memory import _task_context, _lock

    with _lock:
        return dict(_task_context.get(kwargs.get("task_id") or "", {}))


def _scope(ctx: Dict[str, str]) -> Dict[str, Any]:
    return {
        "$or": [
            {"user": ctx.get("user_id", "")},
            {"tenantId": ctx.get("org_id", "default"), "sharedWithOrg": True},
        ]
    }


def _search_notes(args: Dict[str, Any], **kwargs: Any) -> str:
    ctx = _ctx(kwargs)
    if not ctx:
        return json.dumps({"error": "no user context"})
    query = (args.get("query") or "").strip()
    mongo_filter = _scope(ctx)
    if query:
        pattern = re.escape(query)
        mongo_filter = {
            "$and": [
                mongo_filter,
                {"$or": [{"title": {"$regex": pattern, "$options": "i"}}, {"content": {"$regex": pattern, "$options": "i"}}]},
            ]
        }
    try:
        rows = list(
            _notes()
            .find(mongo_filter, {"title": 1, "updatedAt": 1})
            .sort("updatedAt", -1)
            .limit(20)
        )
        return json.dumps(
            {"notes": [{"id": str(r["_id"]), "title": r.get("title", "Untitled")} for r in rows]}
        )
    except Exception as exc:
        logger.warning("search_notes failed: %s", exc)
        return json.dumps({"error": str(exc)})


def _view_note(args: Dict[str, Any], **kwargs: Any) -> str:
    from bson import ObjectId

    ctx = _ctx(kwargs)
    if not ctx:
        return json.dumps({"error": "no user context"})
    try:
        row = _notes().find_one({"_id": ObjectId(str(args.get("note_id", ""))), **_scope(ctx)})
        if row is None:
            return json.dumps({"error": "note not found"})
        return json.dumps(
            {
                "id": str(row["_id"]),
                "title": row.get("title", "Untitled"),
                "content": (row.get("content") or "")[:32000],
            }
        )
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def _write_note(args: Dict[str, Any], **kwargs: Any) -> str:
    from bson import ObjectId

    ctx = _ctx(kwargs)
    if not ctx:
        return json.dumps({"error": "no user context"})
    title = (args.get("title") or "Untitled").strip()[:200]
    content = args.get("content") or ""
    note_id = args.get("note_id")
    now = datetime.now(timezone.utc)
    try:
        if note_id:
            result = _notes().update_one(
                {"_id": ObjectId(str(note_id)), "user": ctx.get("user_id", "")},
                {"$set": {"title": title, "content": content, "updatedAt": now}},
            )
            if result.matched_count == 0:
                return json.dumps({"error": "note not found or not owned by you"})
            return json.dumps({"status": "updated", "note_id": str(note_id)})
        inserted = _notes().insert_one(
            {
                "user": ctx.get("user_id", ""),
                "tenantId": ctx.get("org_id", "default"),
                "title": title,
                "content": content,
                "sharedWithOrg": False,
                "pinnedBy": [],
                "createdAt": now,
                "updatedAt": now,
            }
        )
        return json.dumps({"status": "created", "note_id": str(inserted.inserted_id)})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def register_notes_tools() -> None:
    from tools.registry import registry

    registry.register(
        name="search_notes",
        toolset="planning",
        schema={
            "name": "search_notes",
            "description": "Search the user's notes (and org-shared notes) by title/content. Returns ids and titles.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search text; empty lists recent notes."}},
            },
        },
        handler=_search_notes,
        description="Search user notes",
        emoji="📝",
    )
    registry.register(
        name="view_note",
        toolset="planning",
        schema={
            "name": "view_note",
            "description": "Read the full content of one of the user's notes by id (from search_notes).",
            "parameters": {
                "type": "object",
                "properties": {"note_id": {"type": "string"}},
                "required": ["note_id"],
            },
        },
        handler=_view_note,
        description="Read a note",
        emoji="📝",
    )
    registry.register(
        name="write_note",
        toolset="planning",
        schema={
            "name": "write_note",
            "description": "Create a new note for the user, or update one they own (pass note_id to update). Content is markdown.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string", "description": "Full markdown content of the note."},
                    "note_id": {"type": "string", "description": "Existing note id to update; omit to create."},
                },
                "required": ["title", "content"],
            },
        },
        handler=_write_note,
        description="Create or update a note",
        emoji="📝",
    )
    logger.info("notes tools registered (search_notes, view_note, write_note)")
