#!/bin/bash
# Additive stand-up of the Hermes v0.21.5 Bot Mode gateway on CT201 (the AiBox prod host).
#
# Runs FROM the dev box. It is ADDITIVE and STOPS BEFORE the prod swap: it brings up the NEW
# `hermes-gateway` service without recreating `app` or `hermes-adapter`, so live prod is untouched.
# Making the Bots UI reachable in the live app (app rebuild + force-recreate with HERMES_GATEWAY_URL)
# is the separate, owner-gated prod-swap step printed at the end.
#
# Prereqs: this machine reaches linuxg6 + `ai` (jump); /opt/analytikul is the AiBox source tree
# (git-archive of feature/analytikul-coder); docker-compose.aibox.yml carries the hermes-gateway
# service (committed to the repo). Deploy model per docs/HANDOFF-aibox-2026-08-02.md.
set -euo pipefail

JUMP=(ssh -o BatchMode=yes -o ConnectTimeout=20 -J linuxg6 ai)
BRANCH="feature/analytikul-coder"

echo "==> [1/6] pre-flight"
"${JUMP[@]}" 'pct exec 201 -- bash -lc "test -d /opt/analytikul && docker compose version >/dev/null && echo host-ok"' \
  | grep -q host-ok || { echo "FATAL: CT201 / /opt/analytikul not ready"; exit 1; }
git rev-parse --verify "$BRANCH" >/dev/null || { echo "FATAL: branch $BRANCH missing"; exit 1; }

echo "==> [2/6] syncing v0.21.5 source to /opt/analytikul (git archive -> tar)"
git archive "$BRANCH" services/hermes-runtime docker-compose.aibox.yml \
  | "${JUMP[@]}" 'pct exec 201 -- tar -x -C /opt/analytikul'
echo "    synced services/hermes-runtime + docker-compose.aibox.yml"

echo "==> [3/6] remote: provision token, rebuild image, bring up gateway, verify"
REMOTE=$(cat <<'REMOTE_EOF'
set -euo pipefail
cd /opt/analytikul
ENV=.env.aibox
# 1. Provision HERMES_GATEWAY_TOKEN (generate once; never printed).
if ! grep -qE '^HERMES_GATEWAY_TOKEN=' "$ENV" 2>/dev/null; then
  TOK=$(openssl rand -hex 24 2>/dev/null || head -c24 /dev/urandom | xxd -p | tr -d '\n')
  printf '\nHERMES_GATEWAY_TOKEN=%s\n' "$TOK" >> "$ENV"
  echo "    provisioned HERMES_GATEWAY_TOKEN in $ENV"
else
  echo "    HERMES_GATEWAY_TOKEN already set"
fi
# 2. Tag a rollback of the current hermes image, then rebuild at v0.21.5.
if docker image inspect analytikul-hermes:coder >/dev/null 2>&1; then
  docker tag analytikul-hermes:coder analytikul-hermes:rollback-$(date +%Y%m%d%H%M%S)
  echo "    tagged rollback of analytikul-hermes:coder"
fi
echo "    building analytikul-hermes:coder from services/hermes-runtime (v0.21.5)…"
docker build -t analytikul-hermes:coder -f services/hermes-runtime/analytikul_adapter/Dockerfile services/hermes-runtime
# 3. Bring up ONLY the new gateway (additive; does not recreate app/hermes-adapter).
docker compose -p analytikul -f docker-compose.aibox.yml up -d --no-deps hermes-gateway
sleep 5
# 4. Verify.
echo "    --- gateway container ---"
docker ps --filter name=analytikul-hermes-gateway --format '{{.Names}} {{.Status}}'
echo "    --- hermes runtime self-check (profile list) ---"
docker exec analytikul-hermes-gateway python -m hermes_cli.main profile list 2>&1 | head -5 || echo "    (profile list failed — inspect logs)"
echo "    --- dashboard HTTP on :9119 ---"
docker exec analytikul-hermes-gateway sh -lc 'command -v curl >/dev/null && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9119/ || echo "(no curl in image; check logs)"' 2>&1 | head -1
echo "    --- last 20 log lines ---"
docker logs --tail 20 analytikul-hermes-gateway 2>&1 | sed 's/^/      /'
echo "REMOTE-DONE"
REMOTE_EOF
)
printf '%s' "$REMOTE" | base64 -w0 \
  | "${JUMP[@]}" 'pct exec 201 -- bash -lc "base64 -d | bash"'

echo "==> [4/6] verify prod app + adapter were NOT recreated (still live on old image)"
"${JUMP[@]}" 'pct exec 201 -- bash -lc "docker ps --filter name=analytikul-app --filter name=analytikul-hermes-adapter --format \"{{.Names}} {{.Status}}\""'

echo "==> [5/6] gateway stand-up complete (ADDITIVE — prod untouched)."
echo "==> [6/6] NEXT (owner-gated prod swap, NOT done here):"
cat <<'NEXT'
    To make the Bots UI reachable in the LIVE app, on CT201 in /opt/analytikul:
      1) sync api/ + client/ too:   git archive feature/analytikul-coder api client | (into /opt/analytikul)
      2) rebuild the app image:     docker build -t analytikul-app:coder -f Dockerfile .   (tag a rollback first)
      3) recreate the app:          docker compose -p analytikul -f docker-compose.aibox.yml up -d --force-recreate app
      4) verify the running image id changed AND GET /api/analytikul/bots/health -> {configured:true, reachable:true}
    (Also recreate hermes-adapter to move the agent runtime to v0.21.5 — smoke-test an agent run first.)
NEXT
