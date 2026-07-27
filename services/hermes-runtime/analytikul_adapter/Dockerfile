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
COPY . .
RUN uv pip install --system --no-cache -e . \
    && uv pip install --system --no-cache "fastapi>=0.115" "uvicorn[standard]>=0.30" "redis>=5"

# Playwright Chromium for the browser toolset (heavy layer, cached separately).
# Browsers go to a world-readable path since the service runs as non-root.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN uv pip install --system --no-cache playwright \
    && playwright install --with-deps chromium

# Provider extras (lazy deps in the runtime; required at run time)
RUN uv pip install --system --no-cache "anthropic>=0.39.0" "pymongo>=4.10"

# Web-dev + deploy toolchain for Analytikul Coder: Node/npm/pnpm (scaffold, install,
# build & run web apps) + openssh-client + rsync (push to GitHub over SSH / deploy to
# a Linux server) — so the agent can drive a local repo → build → push → deploy loop
# like Claude Code. Placed after the heavy Playwright layer so it stays cache-cheap.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client rsync \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

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
