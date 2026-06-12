"""Postgres store for gateway links and cron jobs."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras

PG_URI = os.environ.get(
    "GATEWAY_PG_URI", "postgresql://myuser:mypassword@vectordb:5432/mydatabase"
)

MIGRATION = """
CREATE SCHEMA IF NOT EXISTS gateway;

CREATE TABLE IF NOT EXISTS gateway.telegram_links (
  chat_id BIGINT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gateway.link_codes (
  code TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gateway.cron_jobs (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  message TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run TIMESTAMPTZ,
  last_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def connect():
    return psycopg2.connect(PG_URI)


def migrate() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(MIGRATION)


def query(sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    with connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return []
        return [dict(row) for row in cur.fetchall()]


def execute(sql: str, params: tuple = ()) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def resolve_telegram_link(chat_id: int) -> Optional[Dict[str, Any]]:
    rows = query("SELECT org_id, user_id FROM gateway.telegram_links WHERE chat_id = %s", (chat_id,))
    return rows[0] if rows else None


def claim_link_code(code: str, chat_id: int) -> Optional[Dict[str, Any]]:
    rows = query("SELECT org_id, user_id FROM gateway.link_codes WHERE code = %s", (code,))
    if not rows:
        return None
    execute("DELETE FROM gateway.link_codes WHERE code = %s", (code,))
    execute(
        """INSERT INTO gateway.telegram_links (chat_id, org_id, user_id) VALUES (%s, %s, %s)
           ON CONFLICT (chat_id) DO UPDATE SET org_id = EXCLUDED.org_id, user_id = EXCLUDED.user_id""",
        (chat_id, rows[0]["org_id"], rows[0]["user_id"]),
    )
    return rows[0]
