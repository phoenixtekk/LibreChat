#!/usr/bin/env bash
# Analytikul production deploy — runs ON the production host (linuxg6).
#   ssh linuxg6 'bash -s' < scripts/deploy.sh        (first time: clone manually, see below)
# or on the host: cd /opt/analytikul && bash scripts/deploy.sh
#
# Prereqs (one-time, documented in docs/ADMIN_DOCS.md):
#   1. Repo at /opt/analytikul (git clone from the fork remote)
#   2. /opt/analytikul/.env populated from .env.example + production secrets
#      (JWT secrets regenerated, ANALYTIKUL_VAULT_KEY, AGENT_DEFAULT_API_KEY,
#       MEILI_MASTER_KEY, POSTGRES_PASSWORD, STRIPE_*, TELEGRAM_BOT_TOKEN)
#   3. Cloudflare tunnel ingress: analytikul.ai -> http://127.0.0.1:3180
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/analytikul}"
COMPOSE="docker compose -f docker-compose.prod.yml"

cd "$APP_DIR"

echo "==> pulling latest"
git pull --ff-only

echo "==> preflight"
[ -f .env ] || { echo "ERROR: $APP_DIR/.env missing"; exit 1; }
grep -q '^ANALYTIKUL_VAULT_KEY=.\{64\}$' .env || { echo "ERROR: ANALYTIKUL_VAULT_KEY missing/invalid in .env"; exit 1; }
grep -q '^POSTGRES_PASSWORD=..*' .env || { echo "ERROR: POSTGRES_PASSWORD missing in .env"; exit 1; }
if ss -tln | grep -q ':3180 '; then
  docker ps --format '{{.Names}} {{.Ports}}' | grep -q 'analytikul-app' || {
    echo "ERROR: port 3180 is taken by something other than analytikul-app"; exit 1; }
fi

echo "==> building (app + adapter)"
$COMPOSE build --pull app hermes-adapter

echo "==> rolling up"
$COMPOSE up -d

echo "==> waiting for health"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3180/health 2>/dev/null; then
    echo "app healthy on 127.0.0.1:3180"
    break
  fi
  [ "$i" = 60 ] && { echo "ERROR: app failed health check"; $COMPOSE logs --tail 50 app; exit 1; }
  sleep 5
done

for svc in hermes-adapter:8001 analytics-service:8011 memory-service:8012 billing-service:8013 gateway-service:8014; do
  host="${svc%%:*}"; port="${svc##*:}"
  docker exec analytikul-app sh -c "wget -qO- http://${host}:${port}/health" >/dev/null 2>&1 \
    && echo "  ${host} ok" || echo "  WARNING: ${host} health check failed (docker compose logs ${host})"
done

echo "==> done. Public check: curl -I https://analytikul.ai"
