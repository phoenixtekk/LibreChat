# Analytikul — Architecture

## Monorepo layout (LibreChat fork + Analytikul additions)
```
api/                      Express backend (legacy JS — keep edits thin)
  server/routes/analytikul.js     ← ALL Analytikul routes (agent, notes, keys, memory, analytics, telegram)
  server/index.js                 ← + Stripe webhook raw-body forwarder (mounted before JSON parser)
client/                   React SPA (Vite + Tailwind + Recoil + React Query)
  src/components/analytikul/      ← ALL Analytikul UI (provider, palette, rail, dashboards, notes/, sidebar/)
  src/style.analytikul.css        ← skins/accents (the only hex-allowed client file)
packages/
  api/src/analytikul/             ← TS backend logic (adapter client, SSE proxy, traces, vault, budget)
  data-schemas/src/{schema,models}/  ← + agentTrace, organization, note models
  analytikul-shared/              ← typed event contract, tier limits
services/
  hermes-runtime/                 ← VENDORED Hermes Agent (pin 484f484) — never edit, except:
    analytikul_adapter/           ← OUR adapter (FastAPI :8001): main/sessions/events/meter/memory/notes_tools
  analytics-service/              ← Node :8011 — Redis Streams consumer → Postgres rollups + budgets API
  memory-service/                 ← Node :8012 — pgvector org memory, RLS, local transformers.js embeddings
  billing-service/                ← Node :8013 — AES-256-GCM BYOK vault + Stripe module + entitlements
  gateway-service/                ← Python :8014 — Telegram gateway + APScheduler cron
docker-compose.analytikul.yml     ← dev overlay (COMPOSE_FILE in .env layers it on upstream compose)
docker-compose.prod.yml           ← production stack (only app exposed: 127.0.0.1:3180)
scripts/deploy.sh                 ← prod deploy (preflight → build → up → health)
scripts/gen-prod-env.sh           ← fresh-secret production .env generator
```

## Data flow — an agent run
1. Client `POST /api/analytikul/agent/run` (JWT) → Express checks **budget** (analytics-service
   `/budgets/check`, 402 if hard-exceeded) and resolves the user's **vaulted BYOK key**
   (billing-service `/vault/key`, env fallback).
2. Express → adapter `POST /run` → SessionPool gets/creates an `AIAgent` per
   `{tenant}:{user}:{conversation}` (10-min idle eviction, per-user concurrency cap). Before the
   run, top-5 **org memories** are fetched (memory-service) and injected as a system block.
3. Run executes on a worker thread; callbacks emit typed events onto a TaskEventBus. **Cost
   metering** wraps `agent.context_compressor.update_from_response` (the single point all
   canonical usage flows through) → emits `cost_event` to the bus AND `XADD` to Redis Stream
   `analytikul:cost_events`.
4. Client opens `GET /api/analytikul/agent/stream/:taskId` → Express pipes the adapter's SSE
   (history replay + live tail, seq-deduped) while a TraceRecorder accumulates events → persists
   an `AgentTrace` Mongo doc on done/error.
5. analytics-service `XREADGROUP`s the stream (XAUTOCLAIM crash recovery) → Postgres
   `analytics.cost_events` + `analytics.daily_rollup` (transactional, idempotent by stream id).

## Stores
| Store | Used for |
|---|---|
| MongoDB (`LibreChat` db) | LibreChat data + `agenttraces`, `organizations`, `notes` |
| Postgres/pgvector (`mydatabase`) | schemas: `analytics` (events/rollups/budgets), `org_memory` (RLS FORCE, HNSW), `billing` (vault), `gateway` (links/cron) |
| Redis | Stream `analytikul:cost_events` (maxlen ~100k) |
| MeiliSearch | upstream message search |

## Key implementation notes / gotchas
- **Tool registration** (`tools/registry.py register()`): pass the INNER function schema
  (`{name, description, parameters}`) — the registry adds the `{"type":"function"}` wrapper.
  Double-wrapping silently hides parameters from the model.
- **Toolless runs**: `enabled_toolsets: []` is FALSY in the runtime → enables everything. Use
  `['todo']` for minimal-tool utility runs (Notes AI does this).
- **Anthropic base URL**: `https://api.anthropic.com` — NO `/v1` suffix (runtime appends paths).
- **tsdown Windows fix**: all four `packages/*/tsdown.config.mjs` use `path.isAbsolute(id)` in
  `neverBundle` (upstream PR: danny-avila/LibreChat#13700). Without it, Windows builds emit
  near-empty bundles.
- **lint-staged** filters `services/hermes-runtime/**` (`.husky/lint-staged.config.js`);
  eslint ignores it too. JS/TS under the vendored tree carries cosmetic formatting drift from the
  initial commit (see `services/hermes-runtime/ANALYTIKUL_PIN.md`) — Python runtime untouched.
- **TipTap v3** (client notes editor): `BubbleMenu` imports from `@tiptap/react/menus`;
  `setContent(content, { emitUpdate: false })`; no `tippyOptions`.
- **SSE auth**: client uses `sse.js` with `Authorization: Bearer` header (see `useAgentStream`).
- JWTs expire ~15 min — curl test scripts must re-login.

## Production topology (linuxg6)
Cloudflare (dashboard-managed tunnel `4623e38d-…`, route `analytikul.ai → http://localhost:3180`,
www→apex 301) → `analytikul-app` container (127.0.0.1:3180→3080) → internal compose network
(adapter/analytics/memory/billing/gateway/mongo4.4/pgvector/redis/meili/rag). No other ports
exposed. Deploy: `git push linuxg6 main` then run `scripts/deploy.sh` on the host
(`~/analytikul`, bare repo `~/analytikul.git`).

**linuxg6 quirks**: no AVX CPU → `mongo:4.4` pinned; docker default-bridge DNS broken at BUILD
time → `build.network: host` in prod compose; image builds are SLOW (20-40 min for the app);
the host also runs an unrelated LibreChat (`librechat-*`, :3080, ai.analytikul.ai) — never touch.
