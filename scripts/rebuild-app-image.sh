#!/bin/bash
# Rebuild analytikul-app image from current source on g3 so all the hotfixes
# (CSP, CORS, rate-limit, internal-token, agent RCE floor, npm overrides, etc)
# are BAKED IN — eliminates the docker-cp fragility.
set -euo pipefail
cd ~/analytikul
ts=$(date +%Y%m%d-%H%M%S)

# 1. Stash the librechat.yaml (gitignored; not in the bare repo; can't lose it).
if [ -f librechat.yaml ]; then
  cp librechat.yaml "/tmp/librechat.yaml.preserve.$ts"
  echo "[1/7] librechat.yaml preserved"
else
  echo "[1/7] no librechat.yaml in working tree (will fetch from running container)"
  docker cp analytikul-app:/app/librechat.yaml "/tmp/librechat.yaml.preserve.$ts" 2>/dev/null || true
fi

# 2. Sync working tree to the pushed HEAD.
git fetch origin marketing/analytics-tracking
echo "[2/7] working tree at: $(git rev-parse --short HEAD)"
git reset --hard origin/marketing/analytics-tracking
echo "[2/7] now at:          $(git rev-parse --short HEAD)"

# 3. Restore librechat.yaml (still gitignored after the reset).
if [ -f "/tmp/librechat.yaml.preserve.$ts" ]; then
  cp "/tmp/librechat.yaml.preserve.$ts" librechat.yaml
  echo "[3/7] librechat.yaml restored ($(wc -l < librechat.yaml) lines)"
fi

# 4. Snapshot the current image so we can roll back instantly if needed.
OLD_IMAGE=$(docker inspect analytikul-app --format '{{.Image}}')
docker tag "$OLD_IMAGE" "analytikul-app:rollback-$ts" 2>/dev/null && \
  echo "[4/7] rollback tag created: analytikul-app:rollback-$ts" || \
  echo "[4/7] rollback tag could not be set; rolling back would require redeploy"

# 5. Build the new image (slow — ~15-40 min on g3 by past observation).
#    Logs to /tmp/atk-build.$ts.log for later inspection.
echo "[5/7] BUILD starting at $(date) — this will take 15-40 min"
BUILD_LOG="/tmp/atk-build.$ts.log"
if docker compose -p analytikul -f docker-compose.prod.yml build app > "$BUILD_LOG" 2>&1; then
  echo "[5/7] BUILD SUCCEEDED at $(date) (log: $BUILD_LOG)"
else
  echo "[5/7] BUILD FAILED at $(date) — see $BUILD_LOG"
  tail -40 "$BUILD_LOG"
  exit 1
fi

# 6. Swap container to new image. recreate wipes the docker-cp'd librechat.yaml;
#    we copy it back in before restarting.
echo "[6/7] swapping container to the new image"
docker compose -p analytikul -f docker-compose.prod.yml up -d --force-recreate --no-deps app 2>&1 | tail -3
sleep 8
if [ -f librechat.yaml ]; then
  docker cp librechat.yaml analytikul-app:/app/librechat.yaml
  docker restart analytikul-app > /dev/null
  echo "[6/7] librechat.yaml restored into container + app restarted"
fi

# 7. Health check.
sleep 12
STATUS=$(docker ps --filter name=analytikul-app --format '{{.Status}}')
echo "[7/7] status: $STATUS"
docker logs --tail 6 analytikul-app 2>&1 | grep -iE 'readiness|listening|error' | tail -3 || true

echo "DONE. Rollback if needed: docker tag analytikul-app:rollback-$ts analytikul-app:latest && docker compose -p analytikul -f docker-compose.prod.yml up -d --force-recreate --no-deps app"
