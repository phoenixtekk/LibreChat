"""Analytikul gateway-service — managed messaging gateways + cron scheduler.

M4 ships Telegram (long-polling) + APScheduler cron; further platforms (Slack,
Discord, WhatsApp, …) follow the same pattern: a link table mapping platform
identity → Analytikul user, and run_agent_task() per inbound message.
Internal-only: the Express backend proxies user-facing CRUD.
"""

from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from cron import reload_jobs, start_cron
from store import execute, migrate, query
from telegram import start_telegram, telegram_enabled

logging.basicConfig(level="INFO")

app = FastAPI(title="analytikul-gateway", version="0.2.0")


@app.on_event("startup")
def startup() -> None:
    migrate()
    start_cron()
    start_telegram()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "gateway-service", "telegram": telegram_enabled()}


class LinkCodeRequest(BaseModel):
    org_id: str = "default"
    user_id: str


@app.post("/telegram/link-code")
def create_link_code(req: LinkCodeRequest) -> dict:
    code = secrets.token_hex(4)
    execute(
        "INSERT INTO gateway.link_codes (code, org_id, user_id) VALUES (%s, %s, %s)",
        (code, req.org_id, req.user_id),
    )
    return {"code": code, "instructions": f"Send /link {code} to the Analytikul Telegram bot"}


class CronJobRequest(BaseModel):
    org_id: str = "default"
    user_id: str
    name: str = Field(min_length=1, max_length=120)
    schedule: str = Field(min_length=9, max_length=120, description="crontab expression")
    message: str = Field(min_length=1, max_length=8000)
    enabled: bool = True


@app.get("/cron")
def list_jobs(org_id: str = "default", user_id: Optional[str] = None) -> dict:
    if user_id:
        jobs = query(
            "SELECT * FROM gateway.cron_jobs WHERE org_id = %s AND user_id = %s ORDER BY id",
            (org_id, user_id),
        )
    else:
        jobs = query("SELECT * FROM gateway.cron_jobs WHERE org_id = %s ORDER BY id", (org_id,))
    return {"jobs": jobs}


@app.post("/cron")
def create_job(req: CronJobRequest) -> dict:
    from apscheduler.triggers.cron import CronTrigger

    try:
        CronTrigger.from_crontab(req.schedule)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid cron expression: {exc}")
    rows = query(
        """INSERT INTO gateway.cron_jobs (org_id, user_id, name, schedule, message, enabled)
           VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
        (req.org_id, req.user_id, req.name, req.schedule, req.message, req.enabled),
    )
    reload_jobs()
    return {"id": rows[0]["id"]}


@app.delete("/cron/{job_id}")
def delete_job(job_id: int, org_id: str = "default", user_id: Optional[str] = None) -> dict:
    scope = "id = %s AND org_id = %s" + (" AND user_id = %s" if user_id else "")
    params = (job_id, org_id, user_id) if user_id else (job_id, org_id)
    deleted = execute(f"DELETE FROM gateway.cron_jobs WHERE {scope}", params)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="job not found")
    reload_jobs()
    return {"deleted": True}


@app.patch("/cron/{job_id}/toggle")
def toggle_job(job_id: int, org_id: str = "default") -> dict:
    updated = execute(
        "UPDATE gateway.cron_jobs SET enabled = NOT enabled WHERE id = %s AND org_id = %s",
        (job_id, org_id),
    )
    if updated == 0:
        raise HTTPException(status_code=404, detail="job not found")
    reload_jobs()
    return {"toggled": True}
