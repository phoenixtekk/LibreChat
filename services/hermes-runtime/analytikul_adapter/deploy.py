"""Analytikul Coder — first-class Deploy.

A *deterministic* deploy routine (NOT LLM-improvised): it takes a built project
folder in the workspace and ships it to one of the linuxg fleet servers under
pm2, then surfaces the exact Cloudflare route the operator must add (we can't
edit Cloudflare without a token). This encapsulates the manually-proven
scaffold→push→deploy loop as a reliable, repeatable action.

Flow:
  1. detect app type (static | node | next) from the project
  2. rsync source to <server>:~/deploys/<project>  (source only — build on server)
  3. on the server: npm ci + npm run build (node/next), then pm2 start on a
     live-picked free port (Next binds 0.0.0.0 per fleet rules; others 127.0.0.1)
  4. curl-verify the app answers locally, pm2 save
  5. emit the Cloudflare route (canonical www.) for the operator to wire up

Security: the deploy runs shell over SSH against production, so every caller
input is validated to a strict charset and the target server is allow-listed to
the known fleet. Nothing here trusts free-form text.

Progress streams over the shared TaskEventBus (event types: status | log |
done | error), so the same /stream/{task_id} SSE endpoint the agent uses drives
the Deploy panel too.
"""

from __future__ import annotations

import os
import re
import json
import shlex
import asyncio
import logging
import subprocess
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Tuple

from analytikul_adapter.events import TaskEventBus
from analytikul_adapter.sessions import new_task_id, pool, resolve_workspace_cwd

logger = logging.getLogger("analytikul.deploy")

_deploy_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="deploy")

# Allow-list the fleet: deploy only targets a known linuxg host. (SSH host alias
# is staged from the mounted ~/.ssh — see main._configure_ssh.)
_SERVER_RE = re.compile(r"^linuxg[1-6]$")
# Safe DNS label / project charset — blocks shell metacharacters outright.
_LABEL_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")
_DOMAIN_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$")
_APP_TYPES = {"auto", "static", "node", "next"}

SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]


class DeployError(Exception):
    """Validation / precondition failure — surfaced to the caller as 400."""


def _validate(*, workspace: str, server: str, domain: str, subdomain: str, app_type: str) -> None:
    if not workspace or not _LABEL_RE.match(workspace):
        raise DeployError(f"invalid project name {workspace!r} (letters, digits, hyphens)")
    if not _SERVER_RE.match(server or ""):
        raise DeployError(f"invalid server {server!r} — must be one of linuxg1..linuxg6")
    if domain and not _DOMAIN_RE.match(domain):
        raise DeployError(f"invalid domain {domain!r}")
    if subdomain and not _LABEL_RE.match(subdomain):
        raise DeployError(f"invalid subdomain {subdomain!r}")
    if app_type not in _APP_TYPES:
        raise DeployError(f"invalid app_type {app_type!r}")


def start_deploy(
    *,
    workspace: str,
    server: str,
    domain: str = "",
    subdomain: str = "",
    app_type: str = "auto",
    user_id: str = "deploy",
) -> str:
    """Validate, register a task bus, kick off the deploy in a worker thread."""
    workspace = (workspace or "").strip()
    server = (server or "").strip()
    domain = (domain or "").strip().lower()
    subdomain = (subdomain or "").strip().lower()
    app_type = (app_type or "auto").strip().lower()
    _validate(workspace=workspace, server=server, domain=domain, subdomain=subdomain, app_type=app_type)

    cwd = resolve_workspace_cwd(workspace)
    if not cwd:
        raise DeployError("no workspace root configured (WORKSPACE_ROOT unset)")
    if not os.path.isdir(cwd):
        raise DeployError(f"project folder does not exist: {workspace}")

    loop = asyncio.get_event_loop()
    task_id = new_task_id()
    bus = TaskEventBus(task_id=task_id, loop=loop)
    pool.register_bus(bus, user_id=user_id)
    _deploy_executor.submit(
        _run_deploy,
        bus,
        cwd=cwd,
        project=workspace,
        server=server,
        domain=domain,
        subdomain=subdomain,
        app_type=app_type,
    )
    return task_id


# ── shell helpers ────────────────────────────────────────────────────────────

def _status(bus: TaskEventBus, message: str) -> None:
    bus.emit("status", {"message": message})
    logger.info("[deploy] %s", message)


def _log(bus: TaskEventBus, line: str) -> None:
    for ln in str(line).rstrip("\n").split("\n"):
        bus.emit("log", {"line": ln})


def _run(bus: TaskEventBus, argv, cwd: Optional[str] = None, timeout: int = 600) -> Tuple[int, str]:
    """Run a local command, streaming combined output as log events."""
    _log(bus, f"$ {' '.join(shlex.quote(a) for a in argv)}")
    try:
        proc = subprocess.Popen(
            argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
    except FileNotFoundError as exc:
        _log(bus, f"command not found: {exc}")
        return 127, ""
    out_lines = []
    assert proc.stdout is not None
    for line in proc.stdout:
        out_lines.append(line)
        _log(bus, line)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        _log(bus, f"! timed out after {timeout}s")
        return 124, "".join(out_lines)
    return proc.returncode, "".join(out_lines)


def _ssh(bus: TaskEventBus, server: str, script: str, timeout: int = 600) -> Tuple[int, str]:
    """Run a bash script on the server over stdin (avoids arg-quoting hazards)."""
    argv = ["ssh", *SSH_OPTS, server, "bash -s"]
    _log(bus, f"[ssh {server}] running {len(script.splitlines())}-line script")
    try:
        proc = subprocess.run(
            argv, input=script, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        _log(bus, f"! ssh timed out after {timeout}s")
        return 124, ""
    if proc.stdout:
        _log(bus, proc.stdout)
    return proc.returncode, proc.stdout or ""


# ── app-type detection ───────────────────────────────────────────────────────

def _detect_app_type(cwd: str) -> Tuple[str, str]:
    """Return (app_type, static_subdir). static_subdir is relative to cwd for the
    static case (the folder that holds index.html)."""
    pkg_path = os.path.join(cwd, "package.json")
    if os.path.isfile(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as fh:
                pkg = json.load(fh)
        except Exception:
            pkg = {}
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        scripts = pkg.get("scripts", {})
        if "next" in deps:
            return "next", ""
        if "start" in scripts:
            return "node", ""
        # a build-only static site (vite/cra) — treat as node build then serve dist
        if "build" in scripts:
            return "node", ""
    # static: find the dir with index.html
    for sub in ("", "public", "dist", "build", "out"):
        if os.path.isfile(os.path.join(cwd, sub, "index.html")):
            return "static", sub
    return "static", ""


# ── main routine ─────────────────────────────────────────────────────────────

def _run_deploy(bus: TaskEventBus, *, cwd, project, server, domain, subdomain, app_type) -> None:
    try:
        remote_dir = f"deploys/{project}"
        pm2_name = f"atk-{project}"

        # 1. detect
        static_subdir = ""
        if app_type == "auto":
            app_type, static_subdir = _detect_app_type(cwd)
            _status(bus, f"Detected app type: {app_type}"
                         + (f" (static dir: {static_subdir or '.'})" if app_type == "static" else ""))
        elif app_type == "static":
            _, static_subdir = _detect_app_type(cwd)

        # 2. reachability
        _status(bus, f"Checking SSH to {server}…")
        code, _ = _ssh(bus, server, "hostname; whoami")
        if code != 0:
            raise DeployError(f"cannot ssh to {server} (exit {code})")

        # 3. rsync source to the server
        _status(bus, f"Copying project to {server}:~/{remote_dir} …")
        _ssh(bus, server, f"mkdir -p ~/{remote_dir}")
        src = cwd.rstrip("/\\") + "/"
        if app_type == "static" and static_subdir:
            src = os.path.join(cwd, static_subdir).rstrip("/\\") + "/"
        rsync_argv = [
            "rsync", "-az", "--delete",
            "--exclude", ".git", "--exclude", "node_modules",
            "--exclude", ".next", "--exclude", "dist", "--exclude", ".env",
            "-e", "ssh " + " ".join(SSH_OPTS),
            src, f"{server}:{remote_dir}/",
        ]
        code, _ = _run(bus, rsync_argv)
        if code != 0:
            raise DeployError(f"rsync failed (exit {code})")

        # 4. pick a free port on the server (recon live, per fleet rules)
        _status(bus, "Selecting a free port on the server…")
        port = _pick_free_port(bus, server)
        _status(bus, f"Using port {port}")

        # 5. build (node/next) + start under pm2
        if app_type in ("node", "next"):
            _status(bus, "Installing dependencies + building on the server (npm ci && npm run build)…")
            build_script = _build_script(remote_dir)
            code, _ = _ssh(bus, server, build_script, timeout=900)
            if code != 0:
                raise DeployError(f"remote build failed (exit {code})")

        _status(bus, f"Starting the app under pm2 as '{pm2_name}'…")
        start_script = _start_script(app_type, remote_dir, pm2_name, port, static_subdir)
        code, out = _ssh(bus, server, start_script)
        if code != 0:
            raise DeployError(f"pm2 start failed (exit {code})")

        # 6. verify it answers
        _status(bus, "Verifying the app responds locally…")
        code, out = _ssh(bus, server, _verify_script(port))
        http_code = out.strip().split()[-1] if out.strip() else "000"
        ok = http_code.startswith("2") or http_code.startswith("3")
        if not ok:
            _status(bus, f"⚠ App started but local check returned HTTP {http_code} "
                         f"(it may need a moment, or a runtime env var). Check pm2 logs {pm2_name}.")

        # 7. surface the Cloudflare route (canonical www. per fleet rules)
        host = _canonical_host(domain, subdomain)
        cloudflare_route = None
        if host:
            cloudflare_route = f"{host} → http://localhost:{port}"

        bus.emit("done", {
            "ok": True,
            "server": server,
            "app_type": app_type,
            "port": port,
            "pm2_name": pm2_name,
            "remote_dir": f"~/{remote_dir}",
            "local_url": f"http://127.0.0.1:{port}/  (on {server})",
            "http_code": http_code,
            "host": host,
            "cloudflare_route": cloudflare_route,
            "summary": (
                f"Deployed '{project}' ({app_type}) to {server} on port {port} under pm2 "
                f"'{pm2_name}'."
            ),
        })
        _status(bus, f"✅ Deployed to {server}:{port} under pm2 '{pm2_name}'.")
    except DeployError as exc:
        bus.emit("error", {"message": str(exc)})
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI, never hang
        logger.exception("deploy failed")
        bus.emit("error", {"message": f"deploy failed: {exc}"})


def _pick_free_port(bus: TaskEventBus, server: str) -> int:
    """Ask the server which candidate ports are free, pick the first."""
    candidates = list(range(8100, 8140))
    probe = (
        "for p in " + " ".join(str(p) for p in candidates) + "; do "
        "ss -tlnH | grep -q \":$p \" || { echo $p; break; }; done"
    )
    code, out = _ssh(bus, server, probe)
    for tok in out.split():
        if tok.isdigit():
            return int(tok)
    # fallback: nothing parsed — use a high port unlikely to collide
    return 8137


def _build_script(remote_dir: str) -> str:
    return f"""set -e
cd ~/{remote_dir}
export PATH="$HOME/.nvm/versions/node/*/bin:$PATH" 2>/dev/null || true
command -v npm >/dev/null || {{ echo "npm not found on server"; exit 1; }}
npm ci 2>/dev/null || npm install
if npm run | grep -qE '^  build'; then npm run build; else echo "(no build script — skipping)"; fi
"""


def _start_script(app_type: str, remote_dir: str, pm2_name: str, port: int, static_subdir: str) -> str:
    common = f"""set -e
cd ~/{remote_dir}
command -v pm2 >/dev/null || npm install -g pm2
pm2 delete {shlex.quote(pm2_name)} 2>/dev/null || true
"""
    if app_type == "static":
        serve_dir = static_subdir or "."
        # pm2's built-in static server; --spa so client routes fall back to index.html.
        body = f"pm2 serve {shlex.quote(serve_dir)} {port} --name {shlex.quote(pm2_name)} --spa\n"
    elif app_type == "next":
        # Fleet rule: Next.js must bind 0.0.0.0 (middleware-rewrite proxy breaks on 127.0.0.1).
        body = (
            f"HOSTNAME=0.0.0.0 PORT={port} pm2 start npm --name {shlex.quote(pm2_name)} "
            f"-- run start\n"
        )
    else:  # node
        body = (
            f"PORT={port} pm2 start npm --name {shlex.quote(pm2_name)} -- run start\n"
        )
    return common + body + "pm2 save 2>/dev/null || true\n"


def _verify_script(port: int) -> str:
    return (
        f"sleep 2; curl -s -o /dev/null -w 'HTTP %{{http_code}}' "
        f"http://127.0.0.1:{port}/ || echo 'HTTP 000'"
    )


def _canonical_host(domain: str, subdomain: str) -> str:
    if not domain:
        return ""
    if subdomain:
        return f"{subdomain}.{domain}"
    # Canonical www. per fleet rules (apex should 308→www).
    if domain.startswith("www."):
        return domain
    return f"www.{domain}"
