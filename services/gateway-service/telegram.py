"""Managed Telegram gateway: long-polling bot routing messages to agent runs.

Linking: a user generates a one-time code in the Analytikul UI, then sends
`/link <code>` to the bot. After that, every message they send runs through
their own agent session (conversation `tg-<chat_id>`), and the agent's final
response is sent back. No VPS or self-hosting required — this is the managed
version of what Hermes makes users set up themselves.
"""

from __future__ import annotations

import os
import logging
import threading

import requests

from agent import run_agent_task
from store import claim_link_code, resolve_telegram_link

logger = logging.getLogger("gateway.telegram")

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
API = f"https://api.telegram.org/bot{TOKEN}"
MAX_REPLY_CHARS = 4000


def telegram_enabled() -> bool:
    return bool(TOKEN)


def _send(chat_id: int, text: str) -> None:
    for chunk_start in range(0, len(text), MAX_REPLY_CHARS):
        requests.post(
            f"{API}/sendMessage",
            json={"chat_id": chat_id, "text": text[chunk_start : chunk_start + MAX_REPLY_CHARS]},
            timeout=15,
        )


def _handle_message(chat_id: int, text: str) -> None:
    if text.startswith("/start"):
        _send(chat_id, "Welcome to Analytikul. Link your account: open Analytikul → Keys tab → Telegram, then send /link <code> here.")
        return
    if text.startswith("/link"):
        parts = text.split()
        link = claim_link_code(parts[1].strip(), chat_id) if len(parts) > 1 else None
        _send(chat_id, "Linked! Send me any task." if link else "Invalid or expired code.")
        return

    link = resolve_telegram_link(chat_id)
    if link is None:
        _send(chat_id, "Not linked yet — send /link <code> (get a code in the Analytikul app).")
        return

    _send(chat_id, "Working on it…")
    try:
        reply = run_agent_task(
            org_id=link["org_id"],
            user_id=link["user_id"],
            conversation_id=f"tg-{chat_id}",
            message=text,
        )
        _send(chat_id, reply)
    except Exception as exc:
        logger.exception("telegram task failed")
        _send(chat_id, f"Task failed: {exc}")


def _poll_loop() -> None:
    offset = 0
    logger.info("telegram long-polling started")
    while True:
        try:
            res = requests.get(
                f"{API}/getUpdates", params={"timeout": 50, "offset": offset}, timeout=60
            )
            for update in res.json().get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message") or {}
                chat_id = (message.get("chat") or {}).get("id")
                text = message.get("text")
                if chat_id and text:
                    threading.Thread(
                        target=_handle_message, args=(chat_id, text), daemon=True
                    ).start()
        except Exception as exc:
            logger.warning("telegram poll error: %s", exc)
            import time

            time.sleep(5)


def start_telegram() -> None:
    if not telegram_enabled():
        logger.info("telegram gateway disabled (TELEGRAM_BOT_TOKEN not set)")
        return
    threading.Thread(target=_poll_loop, daemon=True).start()
