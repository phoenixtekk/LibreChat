# Analytikul Hermes adapter image — full Hermes runtime + FastAPI adapter.
# Build context is services/hermes-runtime (the runtime root), NOT this directory:
#   docker compose build hermes-adapter
# Dev sandbox posture: this container is the isolation boundary (TERMINAL_ENV=local
# inside the container, non-root user, no host mounts). Production (M4, Linux) adds
# gVisor runsc + per-task ephemeral containers via TERMINAL_ENV=docker.

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep curl ca-certificates \
    # docker CLI: needed when TERMINAL_ENV=docker so the adapter can spawn
    # per-task sandboxed containers (gVisor runtime, on prod) via a
    # docker-socket proxy. Does NOT include the daemon — talks to the proxy
    # over TCP (DOCKER_HOST=tcp://docker-socket-proxy:2375).
    docker.io \
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
