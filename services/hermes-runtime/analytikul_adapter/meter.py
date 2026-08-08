"""Cost meter: per-LLM-call cost events with a hot-reloadable price table.

Prices live in prices.yaml (per-million-token USD). The file's mtime is checked
on every lookup, so editing it takes effect without a restart. Every metered
call emits to the task's event bus and (best-effort) to the Redis Stream
`analytikul:cost_events` for the analytics-service consumer (M3).
"""

from __future__ import annotations

import os
import time
import logging
from typing import Any, Dict, Optional

import yaml

logger = logging.getLogger("analytikul.meter")

PRICES_PATH = os.path.join(os.path.dirname(__file__), "prices.yaml")
COST_STREAM = "analytikul:cost_events"
STREAM_MAXLEN = 100_000

_price_cache: Dict[str, Any] = {"mtime": 0.0, "table": {}}
_redis_client = None


def _load_prices() -> Dict[str, Dict[str, float]]:
    try:
        mtime = os.path.getmtime(PRICES_PATH)
    except OSError:
        return {}
    if mtime != _price_cache["mtime"]:
        with open(PRICES_PATH, encoding="utf-8") as f:
            _price_cache["table"] = yaml.safe_load(f) or {}
        _price_cache["mtime"] = mtime
        logger.info("price table reloaded (%d models)", len(_price_cache["table"]))
    return _price_cache["table"]


def lookup_price(model: str) -> Optional[Dict[str, float]]:
    table = _load_prices()
    if model in table:
        return table[model]
    short = model.split("/")[-1]
    if short in table:
        return table[short]
    for key, price in table.items():
        if key.endswith("*") and model.startswith(key[:-1]):
            return price
    return None


def _redis():
    global _redis_client
    if _redis_client is None:
        uri = os.environ.get("REDIS_URI")
        if not uri:
            return None
        import redis

        _redis_client = redis.Redis.from_url(uri, socket_connect_timeout=2)
    return _redis_client


def compute_cost(model: str, input_tokens: int, output_tokens: int) -> Optional[float]:
    price = lookup_price(model)
    if price is None:
        return None
    return round(
        input_tokens * price.get("input", 0) / 1_000_000
        + output_tokens * price.get("output", 0) / 1_000_000,
        8,
    )


def record_llm_call(
    *,
    bus,
    tenant_id: str,
    user_id: str,
    conversation_id: str,
    model: str,
    provider: str,
    usage: Dict[str, Any],
) -> Dict[str, Any]:
    """Build, emit, and persist one cost event. Returns the event payload."""
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    cost = usage.get("cost")
    if cost is None:
        cost = compute_cost(model, input_tokens, output_tokens)

    payload = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "model": model,
        "provider": provider,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": cost,
        "priced": cost is not None,
    }
    bus.emit("cost_event", payload)

    client = _redis()
    if client is not None:
        try:
            client.xadd(
                COST_STREAM,
                {k: str(v) for k, v in {**payload, "ts": time.time()}.items()},
                maxlen=STREAM_MAXLEN,
                approximate=True,
            )
        except Exception as exc:
            logger.warning("cost event not persisted to redis: %s", exc)
    return payload
