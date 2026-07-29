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
import secrets
import logging
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analytikul_adapter.events import TaskEventBus
from analytikul_adapter.sessions import ConcurrencyLimit, new_task_id, pool

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("analytikul.adapter")

HERMES_PIN = "484f484c25bc89fbddc73f1d80410e99e6133fd5"
STREAM_IDLE_TIMEOUT_S = 120

INTERNAL_TOKEN = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
if not INTERNAL_TOKEN:
    logger.warning(
        "INTERNAL_SERVICE_TOKEN unset — adapter endpoints are unauthenticated. Set it in prod."
    )


def _configure_git() -> None:
    """Analytikul Coder M3: set git identity + a GitHub credential store from env so
    the agent can `git push` over HTTPS. No-op when GITHUB_TOKEN is unset. The token
    is written to ~/.git-credentials (mode 600), never into git config args."""
    import subprocess

    name = os.environ.get("GIT_AUTHOR_NAME", "Analytikul Coder")
    email = os.environ.get("GIT_AUTHOR_EMAIL", "coder@analytikul.local")
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    try:
        subprocess.run(["git", "config", "--global", "user.name", name], check=False)
        subprocess.run(["git", "config", "--global", "user.email", email], check=False)
        subprocess.run(["git", "config", "--global", "init.defaultBranch", "main"], check=False)
        # Bind-mounted workspaces may have a different owner uid than the agent user.
        subprocess.run(["git", "config", "--global", "--replace-all", "safe.directory", "*"], check=False)
        if token:
            cred_path = os.path.join(os.path.expanduser("~"), ".git-credentials")
            with open(cred_path, "w", encoding="utf-8") as fh:
                fh.write(f"https://x-access-token:{token}@github.com\n")
            os.chmod(cred_path, 0o600)
            subprocess.run(["git", "config", "--global", "credential.helper", "store"], check=False)
            logger.info("git credential store configured for github.com push")
    except Exception:
        logger.warning("git configuration failed", exc_info=True)


def _configure_ssh() -> None:
    """Analytikul Coder M3: stage a read-only mounted ~/.ssh (at /ssh-host) into the
    agent's home with strict 600/700 perms so it can ssh/rsync-deploy to a Linux
    server (SSH refuses lax-perm keys). No-op when /ssh-host is absent."""
    import shutil

    src = "/ssh-host"
    if not os.path.isdir(src):
        return
    dst = os.path.join(os.path.expanduser("~"), ".ssh")
    try:
        os.makedirs(dst, exist_ok=True)
        for name in os.listdir(src):
            s = os.path.join(src, name)
            if os.path.isfile(s):
                d = os.path.join(dst, name)
                shutil.copyfile(s, d)
                os.chmod(d, 0o600)
        os.chmod(dst, 0o700)
        logger.info("staged SSH credentials into %s for deploy", dst)
    except Exception:
        logger.warning("ssh staging failed", exc_info=True)


_configure_git()
_configure_ssh()


def require_internal(x_internal_token: Optional[str] = Header(default=None)) -> None:
    """Reject callers without the shared internal token (enforced when configured).

    Critical: this runtime executes agent tools and falls back to the platform key.
    It must never trust an unauthenticated caller. /health is the only open route.
    """
    if INTERNAL_TOKEN and not (
        x_internal_token and secrets.compare_digest(x_internal_token, INTERNAL_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="unauthorized")


def require_internal_or_bearer(
    x_internal_token: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> None:
    """Like require_internal, but also accepts the token as `Authorization: Bearer`.

    The main-chat code-exec path is LibreChat's bundled tool calling /exec via
    LIBRECHAT_CODE_BASEURL; it sends the token as a bearer (LIBRECHAT_CODE_API_KEY),
    not x-internal-token. Internal service callers still use x-internal-token.
    Either carrying the shared token is accepted (constant-time compared)."""
    if not INTERNAL_TOKEN:
        return
    candidates = []
    if x_internal_token:
        candidates.append(x_internal_token)
    if authorization and authorization.lower().startswith("bearer "):
        candidates.append(authorization[7:].strip())
    for candidate in candidates:
        if secrets.compare_digest(candidate, INTERNAL_TOKEN):
            return
    raise HTTPException(status_code=401, detail="unauthorized")


PROTECTED = [Depends(require_internal)]
CODE_PROTECTED = [Depends(require_internal_or_bearer)]

app = FastAPI(title="analytikul-hermes-adapter", version="0.3.0")


@app.on_event("startup")
def _register_tools() -> None:
    try:
        from analytikul_adapter.memory import register_memory_tool

        register_memory_tool()
    except Exception:
        logger.exception("save_to_org_memory registration failed (runs continue without it)")
    try:
        from analytikul_adapter.notes_tools import register_notes_tools

        register_notes_tools()
    except Exception:
        logger.exception("notes tools registration failed (runs continue without them)")


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
    # Analytikul Coder: project folder under WORKSPACE_ROOT the agent should work in
    # (e.g. "my-app" -> /workspace/my-app). Empty -> the default project.
    workspace: Optional[str] = None
    # Permission mode: plan | manual | accept_edits | auto | bypass (default plan).
    permission_mode: str = "plan"


@app.get("/health")
def health():
    return {"status": "ok", "adapter": "0.2.0", "hermes_pin": HERMES_PIN}


@app.get("/tools", dependencies=PROTECTED)
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


@app.post("/run", dependencies=PROTECTED)
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
                workspace=req.workspace,
                permission_mode=req.permission_mode,
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


class RespondRequest(BaseModel):
    request_id: str
    decision: str  # allow | deny | always


@app.post("/respond/{task_id}", dependencies=PROTECTED)
async def respond(task_id: str, req: RespondRequest):
    """Deliver a UI permission decision to a blocked approval requester."""
    from analytikul_adapter.sessions import resolve_approval

    if not resolve_approval(task_id, req.request_id, req.decision):
        raise HTTPException(status_code=404, detail="no pending approval for that request")
    return {"ok": True}


class DeployRequest(BaseModel):
    # Project folder under WORKSPACE_ROOT to deploy (e.g. "my-app").
    workspace: str = Field(min_length=1, max_length=64)
    # Target fleet server — allow-listed to linuxg1..linuxg6 in deploy.py.
    server: str = Field(min_length=1, max_length=16)
    # Optional public hostname bits — surfaced as a Cloudflare route (we can't
    # edit Cloudflare without a token, so the operator wires the route).
    domain: str = ""
    subdomain: str = ""
    # auto | static | node | next
    app_type: str = "auto"
    user_id: str = "deploy"


@app.post("/deploy", dependencies=PROTECTED)
async def deploy(req: DeployRequest):
    """Deterministically build+ship a workspace project to a fleet server under
    pm2, then surface the Cloudflare route. Returns {task_id}; progress streams
    over the shared /stream/{task_id} SSE endpoint (status | log | done | error)."""
    from analytikul_adapter.deploy import start_deploy, DeployError

    try:
        task_id = start_deploy(
            workspace=req.workspace,
            server=req.server,
            domain=req.domain,
            subdomain=req.subdomain,
            app_type=req.app_type,
            user_id=req.user_id,
        )
    except DeployError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("failed to start deploy")
        raise HTTPException(status_code=500, detail=str(exc))
    pool.reap_finished()
    return {"task_id": task_id}


@app.get("/stream/{task_id}", dependencies=PROTECTED)
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


@app.post("/cancel/{task_id}", dependencies=PROTECTED)
def cancel(task_id: str):
    if not pool.cancel(task_id):
        raise HTTPException(status_code=404, detail="no running task with that id")
    return {"cancelled": True, "task_id": task_id}


@app.post("/v1/code/run", dependencies=CODE_PROTECTED)
def code_run(body: dict):
    """One-shot code execution. Body shape mirrors
    packages/api/src/tools/codeExec/hermesProvider.ts. See code_exec.py for
    isolation model, resource caps, and language support."""
    from analytikul_adapter.code_exec import run_code

    return run_code(body)


# Map @librechat/agents short language codes -> our run_code language names.
_LC_LANG_MAP = {"py": "python", "python": "python", "sh": "bash", "bash": "bash"}


@app.post("/exec", dependencies=CODE_PROTECTED)
def code_exec_proxy(body: dict):
    """LibreChat-compatible code exec endpoint. Translates @librechat/agents'
    POST /exec request shape into the Hermes-internal shape understood by
    run_code(), then maps the response back. This is what gets pointed at
    by LIBRECHAT_CODE_BASEURL so the main chat's bash_tool / execute_code
    transparently runs on Hermes.

    Unsupported languages (anything other than py/python/sh/bash on this
    node) are rejected with a clear stderr message so the LLM gets a
    coherent failure instead of a 500."""
    import uuid as _uuid
    from analytikul_adapter.code_exec import run_code

    raw_lang = (body.get("lang") or "").lower()
    internal_lang = _LC_LANG_MAP.get(raw_lang)
    if internal_lang is None:
        return {
            "stdout": "",
            "stderr": (
                f"Language {raw_lang!r} is not available on this Hermes node. "
                f"Supported: {', '.join(sorted(set(_LC_LANG_MAP.values())))}. "
                "Use one of those, or ask an admin to add the runtime."
            ),
            "files": [],
            "session_id": body.get("session_id") or _uuid.uuid4().hex,
            "exit_code": 1,
        }

    args = body.get("args") or []
    code = body.get("code") or ""
    if isinstance(args, list) and args:
        if internal_lang == "bash":
            code = f"{code}\n" + " ".join(args)
        else:
            code = code + "\n" + "\n".join(f"# arg: {a}" for a in args)

    internal_body = {
        "language": internal_lang,
        "code": code,
        "timeout_ms": body.get("timeout_ms", 30_000),
        "memory_mb": body.get("memory_mb", 512),
        "stdin": body.get("stdin") or "",
        "files": [],  # LibreChat file-ref handoff TODO — needs /files bridge
        "user_id": body.get("user_id"),
        "conversation_id": body.get("conversation_id") or body.get("session_id"),
    }
    result = run_code(internal_body)

    files_out = []
    for art in result.get("artifacts") or []:
        files_out.append(
            {
                "name": art.get("path"),
                "path": art.get("path"),
                "content_b64": art.get("content_b64") or "",
                "size": art.get("size", 0),
            }
        )

    return {
        "stdout": result.get("stdout", ""),
        "stderr": result.get("stderr", ""),
        "files": files_out,
        "session_id": body.get("session_id") or _uuid.uuid4().hex,
        "exit_code": result.get("exit_code", 1),
    }
