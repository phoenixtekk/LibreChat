"""Scheduled agent tasks: APScheduler firing cron jobs stored in Postgres."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from agent import run_agent_task
from store import execute, query

logger = logging.getLogger("gateway.cron")

scheduler = BackgroundScheduler()


def _fire(job_id: int) -> None:
    rows = query("SELECT * FROM gateway.cron_jobs WHERE id = %s AND enabled", (job_id,))
    if not rows:
        return
    job = rows[0]
    logger.info("cron job %s (%s) firing", job_id, job["name"])
    status = "ok"
    try:
        run_agent_task(
            org_id=job["org_id"],
            user_id=job["user_id"],
            conversation_id=f"cron-{job_id}",
            message=job["message"],
        )
    except Exception as exc:
        logger.exception("cron job %s failed", job_id)
        status = f"error: {exc}"[:300]
    execute(
        "UPDATE gateway.cron_jobs SET last_run = %s, last_status = %s WHERE id = %s",
        (datetime.now(timezone.utc), status, job_id),
    )


def _schedule(job: dict) -> None:
    job_key = f"cron-{job['id']}"
    if scheduler.get_job(job_key):
        scheduler.remove_job(job_key)
    if job["enabled"]:
        scheduler.add_job(
            _fire,
            CronTrigger.from_crontab(job["schedule"]),
            args=[job["id"]],
            id=job_key,
            misfire_grace_time=300,
        )


def reload_jobs() -> int:
    jobs = query("SELECT * FROM gateway.cron_jobs")
    for job in jobs:
        _schedule(job)
    for scheduled in scheduler.get_jobs():
        if not any(f"cron-{job['id']}" == scheduled.id for job in jobs):
            scheduler.remove_job(scheduled.id)
    return len([job for job in jobs if job["enabled"]])


def start_cron() -> None:
    scheduler.start()
    count = reload_jobs()
    logger.info("cron scheduler started (%d active jobs)", count)
