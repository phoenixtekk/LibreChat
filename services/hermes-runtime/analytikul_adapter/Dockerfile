# Analytikul Hermes adapter image — full Hermes runtime + FastAPI adapter.
# Build context is services/hermes-runtime (the runtime root), NOT this directory:
#   docker compose build hermes-adapter
# Dev sandbox posture: this container is the isolation boundary (TERMINAL_ENV=local
# inside the container, non-root user, no host mounts). Production (M4, Linux) adds
# gVisor runsc + per-task ephemeral containers via TERMINAL_ENV=docker.

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# docker CLI (client only, no daemon): needed when TERMINAL_ENV=docker so the
# adapter can spawn per-task sandboxed containers (gVisor runtime, on prod) by
# talking to a docker-socket proxy over TCP
# (DOCKER_HOST=tcp://docker-socket-proxy:2375). Debian's `docker.io` package
# ships the daemon (docker-init) but not the `docker` client binary on this
# base, so we install `docker-ce-cli` from Docker's official apt repo instead.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /runtime

# ── Heavy, source-INDEPENDENT layers FIRST so a code change (the COPY below) does
# ── not re-run them. Rebuilds after an edit then only re-run COPY + `pip install -e`.

# Runtime Python deps (pinned explicitly so they don't need the app source).
RUN uv pip install --system --no-cache \
    "fastapi>=0.115" "uvicorn[standard]>=0.30" "redis>=5" "anthropic>=0.39.0" "pymongo>=4.10"

# Playwright Chromium for the browser toolset (the heaviest layer). World-readable
# path since the service runs as non-root.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN uv pip install --system --no-cache playwright \
    && playwright install --with-deps chromium

# Web-dev + deploy toolchain for Analytikul Coder: Node/npm (Debian) + pnpm@9 (pnpm 10
# requires Node 22; Debian trixie ships Node 20) + openssh-client + rsync — so the agent
# can scaffold, build, push, and ssh/rsync-deploy a webapp like Claude Code. NodeSource's
# setup script started 403ing, hence Debian's packages.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client rsync nodejs npm \
    && npm install -g pnpm@9 \
    && rm -rf /var/lib/apt/lists/*

# ── App source LAST: only this + the editable install re-run when code changes.
COPY . .
RUN uv pip install --system --no-cache -e .

RUN useradd -m -u 10001 agent \
    && mkdir -p /data/hermes/sandboxes \
    && chown -R agent:agent /data/hermes /runtime
USER agent

ENV HERMES_HOME=/data/hermes \
    TERMINAL_ENV=local \
    TERMINAL_SANDBOX_DIR=/data/hermes/sandboxes \
    PYTHONUNBUFFERED=1

EXPOSE 8001
CMD ["uvicorn", "analytikul_adapter.main:app", "--host", "0.0.0.0", "--port", "8001"]
