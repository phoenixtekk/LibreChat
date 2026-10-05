"""Run an agent task via the adapter and collect the final response (sync)."""

from __future__ import annotations

import os
import json
import logging
from typing import Optional

import requests

logger = logging.getLogger("gateway.agent")

ADAPTER_URL = os.environ.get("HERMES_ADAPTER_URL", "http://hermes-adapter:8001")
RUN_TIMEOUT_S = int(os.environ.get("GATEWAY_RUN_TIMEOUT_S", "300"))


def _internal_headers() -> dict:
    token = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    return {"x-internal-token": token} if token else {}


def run_agent_task(
    *,
    org_id: str,
    user_id: str,
    conversation_id: str,
    message: str,
    api_key: Optional[str] = None,
) -> str:
    """Start a run and consume its SSE stream until done; returns the final text."""
    payload = {
        "message": message,
        "tenant_id": org_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "model": os.environ.get("AGENT_DEFAULT_MODEL", ""),
        "provider": os.environ.get("AGENT_DEFAULT_PROVIDER", "anthropic"),
        "base_url": os.environ.get("AGENT_DEFAULT_BASE_URL", "https://api.anthropic.com"),
        "api_key": api_key or os.environ.get("AGENT_DEFAULT_API_KEY", ""),
    }
    headers = _internal_headers()
    res = requests.post(f"{ADAPTER_URL}/run", json=payload, headers=headers, timeout=30)
    res.raise_for_status()
    task_id = res.json()["task_id"]

    with requests.get(
        f"{ADAPTER_URL}/stream/{task_id}", stream=True, headers=headers, timeout=RUN_TIMEOUT_S
    ) as stream:
        stream.raise_for_status()
        for line in stream.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if event["type"] == "done":
                return event.get("final_response") or "(no response)"
            if event["type"] == "error":
                raise RuntimeError(event.get("message") or "agent error")
    raise RuntimeError("stream ended without a terminal event")
