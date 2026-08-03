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

## Production deployment (LIVE since 2026-06-12 — linuxg6)

**https://analytikul.ai** serves from linuxg6 via the Cloudflare tunnel (`Linuxg6-AI` connector, dashboard-managed). Routing: tunnel "Published application route" `analytikul.ai → http://localhost:3180` (added by Lacy in the Cloudflare console — ALL Cloudflare changes are made in the console, never in config files). www → apex 301 redirect active. Only the app is exposed (127.0.0.1:3180); all other services live on the private compose network.

### Layout on linuxg6
- Bare repo: `~/analytikul.git` (push target; local remote name `linuxg6`)
- Working copy: `~/analytikul`; production env: `~/analytikul/.env` (chmod 600, generated by `scripts/gen-prod-env.sh` — all secrets regenerated, never reuse dev values)
- Stack: `docker compose -f docker-compose.prod.yml` (12 containers, `analytikul-*` names)

### Deploy procedure
```
# from dev machine
git push linuxg6 main
ssh linuxg6 'cd ~/analytikul && git pull --ff-only && APP_DIR=$HOME/analytikul bash scripts/deploy.sh'
```
`deploy.sh` does preflight (env secrets, port 3180 ownership), builds app + adapter, rolls the stack, and health-checks everything.

### linuxg6 quirks (hard-won)
- **No AVX CPU** → `mongo:4.4` pinned (mongo ≥5 exits 132/SIGILL).
- **Default-bridge DNS is broken at docker BUILD time** → both `build:` sections use `network: host`. Runtime networking (compose network/embedded DNS) is fine.
- A Docker daemon restart fixes missing `DOCKER-FORWARD` iptables chains but bounces every container on the box (other production sites!) — get approval first.
- The host also runs an unrelated older LibreChat (`librechat-*`, port 3080, ai.analytikul.ai) — never touch it.

### Not yet enabled in production (set in ~/analytikul/.env then `docker compose -f docker-compose.prod.yml up -d`)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM` — checkout stays 503 until set
- `TELEGRAM_BOT_TOKEN` — Telegram gateway disabled until set

## Troubleshooting
- **Containers unhealthy on first boot**: check `docker compose logs api`; most common cause is a missing/els-corrupted `.env`.
- **Hermes adapter 404 on /run**: expected before M2 — only `/health` and `/tools` exist.

## AiBox voice assistant + camera (host services)
Two systemd services on the AiBox host (`ai` / 192.168.166.168), both `enabled` and `Restart=always`:
- **`aigartha`** — the "Hey Amy" voice assistant (`/opt/voice/assistant.py`, log `/opt/voice/assistant.log`)
- **`amy-eyes`** — always-on vision + gimbal control (`/opt/voice/eyes/eyes.py`, log `/opt/voice/eyes/eyes.log`, API `127.0.0.1:8823`)

Camera: OBSBOT Tiny on `/dev/video0` (pan ±130°, tilt ±90°, zoom 0–100). Vision model `qwen2.5vl:7b`
on CT200 Ollama. Frames live only in tmpfs (`/run/amy-eyes/`) and are never written to disk.

**Voice tuning** (`/opt/voice/voice.conf`, re-read on every utterance — no restart needed):
`/opt/voice/setvoice.sh <jarvis|ryan|amy|lacy>` picks the voice; `/opt/voice/setspeed.sh <scale>` sets speaking
speed: `setspeed.sh <length-scale> [sentence-silence] [noise-w]` (**lower = faster**; currently **0.72 / 0.10 / 0.8**,
about 21% faster than the 0.9 default with half the pause between sentences). Each script rewrites only its own key.
`AIBOX_LEAD_MS` (default **400**) pads silence onto the front of every utterance — the SP92 wakes slowly and
swallows the first word without it; `AIBOX_TAIL_S` (0.25) guards the tail.

Health / restart / tuning knobs / troubleshooting: **[`docs/aibox-eyes.md`](aibox-eyes.md)**.
Source of truth for both services is `services/aibox-voice/` in this repo — deploy with `scp` + `systemctl restart`.

### Amy web search + desktop hand-off
Third host service **`amy-deskbridge`** (`/opt/voice/deskbridge.py`, port **8824**, log `/opt/voice/deskbridge.log`)
queues URLs for the Windows agent at `%LOCALAPPDATA%\AmyBridge` (autostarts at logon). Search goes to the
self-hosted **SearXNG on linuxg3:8080**.

⚠️ `/opt/voice/bridge.token` (and the matching `token.txt` on the desktop) is a **credential** — it lets a
caller make that workstation open web pages. Never commit or publish it; rotate with `openssl rand -hex 32`
plus a re-run of `install-amy-bridge.ps1`.

Details, API, security model, and troubleshooting: **[`docs/aibox-search-desktop.md`](aibox-search-desktop.md)**.
