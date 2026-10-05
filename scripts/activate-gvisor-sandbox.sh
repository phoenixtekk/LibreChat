#!/bin/bash
# Wire the Hermes adapter to spawn per-task containers via a docker-socket
# proxy under the gVisor runtime. Prereqs:
#   - scripts/install-gvisor.sh has been run (runsc + daemon.json updated)
#   - working tree is at the latest commit (Dockerfile has docker.io)
set -euo pipefail
cd ~/analytikul
ts=$(date +%Y%m%d-%H%M%S)
cp docker-compose.prod.yml "docker-compose.prod.yml.bak.gvisor.$ts"
echo "[1/5] compose backed up ($ts)"

# 1. Inject docker-socket-proxy service + rewire hermes-adapter, idempotently.
python3 - <<'PY'
import pathlib, re
p = pathlib.Path("docker-compose.prod.yml")
text = p.read_text()

PROXY_SERVICE = """  docker-socket-proxy:
    container_name: analytikul-docker-proxy
    image: tecnativa/docker-socket-proxy:0.3.0
    restart: always
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - NETWORKS=1
      - POST=1
      - DELETE=1
      - EXEC=1
      - VOLUMES=1
      # Locked-off: prevent the adapter from creating new privileged daemons,
      # touching docker config / build cache, or starting swarm.
      - SWARM=0
      - SERVICES=0
      - BUILD=0
      - CONFIGS=0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    read_only: true
    tmpfs:
      - /run
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    security_opt:
      - no-new-privileges:true

"""

# Insert proxy service before the first existing service block, if not present.
if "docker-socket-proxy:" not in text:
    m = re.search(r"^services:\s*\n", text, re.MULTILINE)
    if not m:
        raise SystemExit("no services: anchor")
    text = text[: m.end()] + PROXY_SERVICE + text[m.end():]
    print("docker-socket-proxy service added")
else:
    print("docker-socket-proxy already present")

# Inject the new env vars + depends_on into the hermes-adapter block,
# idempotently.
ENV_LINES = [
    "      - TERMINAL_ENV=docker",
    "      - DOCKER_HOST=tcp://docker-socket-proxy:2375",
    '      - TERMINAL_DOCKER_EXTRA_ARGS=["--runtime=runsc"]',
]
pat = re.compile(
    r"(^  hermes-adapter:\n(?:.*\n)*?    environment:\n)"
    r"((?:      - [^\n]*\n)+)",
    re.MULTILINE,
)
m = pat.search(text)
if not m:
    raise SystemExit("hermes-adapter env block not found")
block = m.group(2)
for line in ENV_LINES:
    key = line.strip().split("=", 1)[0].lstrip("- ")
    if key + "=" in block:
        continue
    block += line + "\n"
text = text[: m.start(2)] + block + text[m.end(2):]
print("hermes-adapter env vars set")

# Add docker-socket-proxy to depends_on of hermes-adapter.
pat2 = re.compile(
    r"(^  hermes-adapter:\n(?:.*\n)*?    depends_on:\n)((?:      - [^\n]*\n)+)",
    re.MULTILINE,
)
m2 = pat2.search(text)
if m2:
    deps = m2.group(2)
    if "docker-socket-proxy" not in deps:
        deps += "      - docker-socket-proxy\n"
        text = text[: m2.start(2)] + deps + text[m2.end(2):]
        print("hermes-adapter depends_on updated")

p.write_text(text)
PY
echo "[2/5] docker-compose.prod.yml patched"

# 2. Rebuild the hermes-adapter image (Dockerfile now installs docker.io).
echo "[3/5] rebuilding hermes-adapter image (a few minutes)"
docker compose -p analytikul -f docker-compose.prod.yml build hermes-adapter 2>&1 | tail -3

# 3. Bring up the proxy + recreate the adapter.
echo "[4/5] starting docker-socket-proxy + recreating hermes-adapter"
docker compose -p analytikul -f docker-compose.prod.yml up -d --no-deps docker-socket-proxy
docker compose -p analytikul -f docker-compose.prod.yml up -d --force-recreate --no-deps hermes-adapter

# 4. Smoke test: spawn a small alpine via the proxy with runsc.
sleep 10
echo "[5/5] smoke test: docker run via proxy under runsc"
docker exec analytikul-hermes-adapter \
  sh -c 'DOCKER_HOST=tcp://docker-socket-proxy:2375 docker run --rm --runtime=runsc alpine:3 uname -r' \
  || (echo "smoke test FAILED — see adapter logs"; docker logs --tail 20 analytikul-hermes-adapter; exit 1)
echo "DONE — gVisor sandbox active for agent runs"
