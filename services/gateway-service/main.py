"""Analytikul gateway-service — M0 health stub.

M4 wraps Hermes gateway/platforms/ with multi-tenant routing (Telegram, Slack, Discord,
WhatsApp, Signal, Matrix, email, SMS, etc.) plus APScheduler cron with a MongoDB job store.
"""

from fastapi import FastAPI

app = FastAPI(title="Analytikul Gateway Service", version="0.0.1")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "gateway-service"}
