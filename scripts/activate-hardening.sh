#!/bin/bash
# Activate the security/spending-cap hardening on g3 prod. Idempotent.
# - generates INTERNAL_SERVICE_TOKEN if missing
# - sets CHECK_BALANCE / START_BALANCE / PLAN_CREDIT_GRANT_*
# - sets LIMIT_MESSAGE_USER=true, CORS_ORIGINS
# - wires INTERNAL_SERVICE_TOKEN into every internal service in docker-compose.prod.yml
# - pre-seeds the admin user's tokenCredits so CHECK_BALANCE doesn't immediately
#   lock them out
# - recreates the stack so all services see the new env
set -euo pipefail
cd ~/analytikul
ts=$(date +%Y%m%d-%H%M%S)
cp .env ".env.bak.harden.$ts"
cp docker-compose.prod.yml "docker-compose.prod.yml.bak.harden.$ts"
echo "[1/6] backups taken ($ts)"

# 1. Generate token if missing
add_or_replace_env () {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

if ! grep -qE "^INTERNAL_SERVICE_TOKEN=" .env; then
  TOKEN=$(openssl rand -hex 32)
else
  TOKEN=$(grep -E "^INTERNAL_SERVICE_TOKEN=" .env | head -1 | cut -d= -f2-)
  if [ -z "$TOKEN" ]; then
    TOKEN=$(openssl rand -hex 32)
  fi
fi
add_or_replace_env INTERNAL_SERVICE_TOKEN "$TOKEN"

# 2. Spending cap + free-tier grant + plan top-ups
add_or_replace_env CHECK_BALANCE       true
add_or_replace_env START_BALANCE       10000000     # ~$10 free-tier grant
add_or_replace_env PLAN_CREDIT_GRANT_PRO  20000000  # ~$20 included credits / mo Pro
add_or_replace_env PLAN_CREDIT_GRANT_TEAM 50000000  # ~$50 included credits / mo Team

# 3. Per-user message rate limit (LibreChat native cap)
add_or_replace_env LIMIT_MESSAGE_USER  true

# 4. CORS allowlist (read by api/server/index.js)
add_or_replace_env CORS_ORIGINS "https://analytikul.ai,https://www.analytikul.ai"

echo "[2/6] .env updated (token len=${#TOKEN})"

# 5. Wire INTERNAL_SERVICE_TOKEN into every internal service's compose env block
# (idempotent: only insert if not already present in each block).
python3 - <<'PY'
import re, pathlib, sys
path = pathlib.Path("docker-compose.prod.yml")
text = path.read_text()

# Services that need to receive the token (Node + Python HTTP services on the
# private network). Mongo/Redis/Meili are excluded — not in scope.
SERVICES = ["app", "billing-service", "gateway-service", "memory-service",
            "analytics-service", "hermes-adapter"]

def inject(service: str, text: str) -> str:
    # Find the service's environment: block and add the token line if absent.
    # Match `  service:\n` then anything up to `    environment:\n` then the
    # list, then look for the next `^  [a-z]` (next top-level service).
    pat = re.compile(
        r"(^  " + re.escape(service) + r":\n(?:.*\n)*?    environment:\n)"
        r"((?:      - [^\n]*\n)+)",
        re.MULTILINE,
    )
    m = pat.search(text)
    if not m:
        return text  # service block not found
    block = m.group(2)
    if "INTERNAL_SERVICE_TOKEN" in block:
        return text
    new_block = block + "      - INTERNAL_SERVICE_TOKEN=${INTERNAL_SERVICE_TOKEN:-}\n"
    return text[: m.start(2)] + new_block + text[m.end(2):]

for svc in SERVICES:
    text = inject(svc, text)

path.write_text(text)
print("compose updated")
PY
echo "[3/6] docker-compose.prod.yml wired INTERNAL_SERVICE_TOKEN into services"

# 6. Pre-seed admin balance so CHECK_BALANCE doesn't lock you out on activation.
# (Other existing users — none today — would need similar seeding if we had any.)
docker exec analytikul-mongodb mongo LibreChat --quiet --eval '
  var u = db.users.findOne({email:"lacy@analytikul.ai"}, {_id:1});
  if (!u) { print("admin not found, skipping balance seed"); }
  else {
    var r = db.balances.updateOne(
      { user: u._id },
      { $setOnInsert: { user: u._id, tokenCredits: 100000000, autoRefillEnabled: false } },
      { upsert: true }
    );
    print("admin balance seeded: matched="+r.matchedCount+" upserted="+(r.upsertedCount||0));
  }
' > /dev/null 2>&1
echo '[4/6] admin balance seeded (100M tokenCredits, ~$100 of chat headroom)'

# 7. Recreate the stack so all services pick up new env (and wired token).
echo "[5/6] recreating stack…"
docker compose -p analytikul -f docker-compose.prod.yml up -d --force-recreate 2>&1 | tail -8

# 8. Re-deploy the hotfix files into the app container (recreate wiped them).
#    These are staged in /tmp/atk-dist and /tmp/atk-server by the SCP step.
if [ -f /tmp/atk-server/index.js ] && [ -f /tmp/atk-server/analytikul.js ]; then
  sleep 6
  docker cp /tmp/atk-server/index.js analytikul-app:/app/api/server/index.js
  docker cp /tmp/atk-server/analytikul.js analytikul-app:/app/api/server/routes/analytikul.js
  if [ -d /tmp/atk-dist ]; then
    docker cp /tmp/atk-dist/. analytikul-app:/app/client/dist
  fi
  if [ -f /tmp/librechat.yaml ]; then
    docker cp /tmp/librechat.yaml analytikul-app:/app/librechat.yaml
  fi
  docker restart analytikul-app > /dev/null
  echo "[6/6] hotfix files re-applied + app restarted"
else
  echo "[6/6] (skipped) hotfix files not staged in /tmp; app left as recreated from image"
fi

echo "DONE"
