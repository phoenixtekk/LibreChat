# Analytikul — OpenClaw ops helper

A minimal internal service that holds the docker socket **scoped to exactly one container**
(`analytikul-openclaw`) so `analytikul-app` never needs socket access. It powers the OpenClaw
**manage panel** (status / start / stop / restart / logs).

- Network: `analytikul_default`; listens on `:9099` (internal only, not published).
- Auth: `X-Internal-Token` == `INTERNAL_SERVICE_TOKEN` (shared with the other microservices).
- Only operates on `OPS_CONTAINER` (default `analytikul-openclaw`) — no arbitrary docker access.

## Run (on CT201)
```bash
docker run -d --name analytikul-openclaw-ops --network analytikul_default --restart unless-stopped --user 0 \
  -e INTERNAL_SERVICE_TOKEN="$TOK" -e OPS_CONTAINER=analytikul-openclaw \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/analytikul/openclaw-ops/ops.mjs:/app/ops.mjs:ro \
  node:24-alpine node /app/ops.mjs
```

## API
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/status` | — | `{name,status,running,health,startedAt,image}` |
| POST | `/action` | `{action: start\|stop\|restart}` | `{ok,action,dockerStatus}` |
| GET | `/logs?tail=N` | — | `{logs}` |
