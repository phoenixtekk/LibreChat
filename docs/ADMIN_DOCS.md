# Analytikul — Admin / Operator Documentation

## Architecture at a glance
- **app (api/ + client/)** — forked LibreChat: Express backend (:3080) + React/Vite client. Upstream files are never edited; Analytikul code lives in new files (`api/server/routes/analytikul/`, `client/src/components/analytikul/`).
- **services/hermes-runtime** — vendored Hermes Agent (pin: see `services/hermes-runtime/ANALYTIKUL_PIN.md`) + `analytikul_adapter` FastAPI bridge (:8001). Never exposed publicly.
- **services/analytics-service** (:8011), **memory-service** (:8012), **billing-service** (:8013), **gateway-service** (:8014) — internal services, health stubs as of M0.
- Backing stores (from upstream compose): MongoDB, MeiliSearch, pgvector Postgres (RAG API), Redis (optional).

## Local development (Windows host)
Requirements: Docker Desktop with WSL2 backend, Node 24+, npm 11+.

```bash
cp .env.example .env        # already done in repo bootstrap; replace secrets before any shared deploy
# Required additions to .env (gitignored, so each dev adds these):
#   UID=1000
#   GID=1000
#   COMPOSE_FILE=docker-compose.yml:docker-compose.analytikul.yml
#   COMPOSE_PATH_SEPARATOR=:    (needed on Windows, where the default separator is ';')
docker compose up -d        # upstream stack + Analytikul services via docker-compose.analytikul.yml
curl http://localhost:3080          # LibreChat app
curl http://localhost:8001/health   # Hermes adapter
curl http://localhost:8011/health   # analytics  (8012 memory, 8013 billing, 8014 gateway)
```

⚠️ The `.env` currently contains the **example** CREDS_KEY/JWT secrets — fine for local dev only.
Generate fresh values for any shared or production environment (`openssl rand -hex 32`).

## Environment variables (Analytikul-specific; grows per milestone)
| Var | Service | Purpose |
|---|---|---|
| `ANALYTICS_PORT` / `MEMORY_PORT` / `BILLING_PORT` | node services | health-stub ports (8011/8012/8013) |
| `ANALYTIKUL_VAULT_KEY` | billing-service (M4) | AES-256-GCM master key for BYOK vault — env only, never in DB |

Upstream LibreChat vars: see `.env.example` and https://www.librechat.ai/docs.

## Upstream sync procedure
- LibreChat: fork base tagged `upstream/v0-base` (788cc5a, v0.8.6); remote `upstream` points at danny-avila/LibreChat. `git fetch upstream && git merge upstream/main` — conflicts should be rare because Analytikul code is in new files only.
- Hermes Agent: vendored snapshot (no git history). Update procedure in `services/hermes-runtime/ANALYTIKUL_PIN.md`.

## Agent engine (M2)

### Environment variables (.env)
| Var | Purpose | Dev default |
|---|---|---|
| `HERMES_ADAPTER_URL` | Express → adapter base URL | `http://localhost:8001` (native backend) / `http://hermes-adapter:8001` (in Docker) |
| `AGENT_DEFAULT_PROVIDER` | provider when request omits one | `anthropic` |
| `AGENT_DEFAULT_MODEL` | model when request omits one | `claude-sonnet-4-6` |
| `AGENT_DEFAULT_BASE_URL` | provider base URL — **no `/v1` suffix for Anthropic** | `https://api.anthropic.com` |
| `AGENT_DEFAULT_API_KEY` | key used until BYOK vault ships (M4) | (secret) |
| `AGENT_IDLE_TTL_S` / `AGENT_MAX_CONCURRENT` / `AGENT_MAX_PER_USER` | adapter session/concurrency tuning | 600 / 8 / 2 |

### Pricing table
`services/hermes-runtime/analytikul_adapter/prices.yaml` — USD per 1M tokens, keys match model ids (trailing `*` = prefix). **Hot-reloaded on mtime change, no restart needed.** Unpriced models emit `cost_usd: null` / `priced: false`.

### Cost event pipeline
Adapter → Redis Stream `analytikul:cost_events` (capped ~100k entries) → analytics-service consumer (M3). Inspect: `docker exec analytikul-redis redis-cli XRANGE analytikul:cost_events - + COUNT 5`.

### Dev workflow (Windows)
The Docker `app` container runs the upstream image and does NOT include Analytikul backend routes. For development: `docker compose up -d` (services incl. adapter + redis; mongo/meili exposed on localhost via the overlay), `docker compose stop api`, then `npm run backend` natively + `npm run frontend:dev`. Requires `npm run build:packages` and `npm run build:client` after package changes.

### Sandbox posture
Dev: agent code exec runs inside the adapter container (non-root uid 10001, no host mounts, `TERMINAL_ENV=local`). Production (M4): gVisor runsc runtime + per-task ephemeral containers + `--network none` for code exec. The adapter port (8001) must NEVER be publicly proxied — only the Express backend talks to it.

## Analytics & memory (M3)

### Services
- **analytics-service** (:8011, node:24-alpine): consumes Redis Stream `analytikul:cost_events` into Postgres (`analytics` schema in the `vectordb` container's `mydatabase`). Env: `REDIS_URI`, `ANALYTICS_PG_URI`. Crash-safe: pending entries reclaimed via XAUTOCLAIM on startup.
- **memory-service** (:8012, node:24-bookworm-slim — glibc required by onnxruntime): pgvector `org_memory` schema with FORCE RLS; embedding model cached in the `embedder-models` volume (~25MB, downloaded on first start; first boot takes ~1 min).
- Express needs `ANALYTICS_SERVICE_URL` and `MEMORY_SERVICE_URL` (default `http://localhost:8011/8012` for native dev).

### Budgets
Admin-set via analytics-service directly (UI lands with the M4 admin panel):
`curl -X POST localhost:8011/budgets -d '{"userId":"<id-or-null-for-org>","period":"monthly","limitUsd":25,"hard":true}'`
Hard budgets block agent runs with 402; soft budgets only report. Budget check fails open if analytics-service is down.

### Memory injection tuning
`services/hermes-runtime/analytikul_adapter/memory.py`: `INJECT_LIMIT` (5), similarity floor (0.35), `INJECT_CHAR_BUDGET` (800 chars ≈ 200 tokens).

## Production deployment (M4 — linuxg6)
Production host: **linuxg6** (linuxg6.tekkdomains.com — confirmed reachable, Docker 29.1.3 installed, no pm2; we deploy with Docker). Pattern per house rules: Docker compose stack on linuxg6, app bound to `0.0.0.0:<free-port>` (port chosen after read-only recon of existing vhosts/ports), exposed via Cloudflare → Apache reverse proxy to analytikul.ai. Only the app port is proxied; hermes-runtime and internal services stay on the private Docker network.

### Cloudflare DNS (user action, timed to M4)
- **Now (prep):** make sure the `analytikul.ai` zone exists in the Cloudflare account and the registrar's nameservers point at Cloudflare — nameserver changes are the only slow step (can take hours).
- **At M4 deploy:** exact records will be surfaced then; expected shape:
  - `A analytikul.ai → <linuxg6 public IP>` (proxied/orange cloud)
  - `CNAME www → analytikul.ai` (proxied)
- TLS: Cloudflare edge cert + origin cert (or Let's Encrypt via Virtualmin) on the Apache vhost.

## Troubleshooting
- **Containers unhealthy on first boot**: check `docker compose logs api`; most common cause is a missing/els-corrupted `.env`.
- **Hermes adapter 404 on /run**: expected before M2 — only `/health` and `/tools` exist.
