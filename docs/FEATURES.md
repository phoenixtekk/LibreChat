# Analytikul — Features

> Analytics-native AI workspace. LibreChat fork + Hermes Agent engine. Hosted at analytikul.ai.
> This file is updated whenever a feature is added, changed, or removed (house rule).

## Status legend
✅ shipped · 🚧 in progress · 📋 planned (milestone in parentheses)

## Inherited from LibreChat (✅ working in the fork at `upstream/v0-base`, LibreChat v0.8.6)
- Multi-provider chat: OpenAI, Anthropic, Google, Azure, AWS Bedrock, Groq, Mistral, OpenRouter, Ollama, custom endpoints — switchable mid-conversation
- Conversations: forking/branching, search (MeiliSearch), shareable links, import, presets
- Agents (LibreChat-style), MCP server support, OpenAPI Actions
- RAG file chat (pgvector RAG API), web search, code interpreter, artifacts, image generation
- Auth: local, OAuth2, SAML, LDAP, 2FA; multi-user isolation; roles/groups/ACL

## Analytikul platform
- ✅ (M1) Hermes Desktop look & feel: 8 paired light/dark skins (aurora/ember/verdant/slate × light/dark via the existing dark-mode toggle) × 6 accents (indigo/amber/emerald/rose/cyan/violet) — implemented as `--gray-*` ramp re-tints in `client/src/style.analytikul.css`; persisted in localStorage (`analytikul-skin`/`analytikul-accent`), applied as `data-skin`/`data-accent` on `<html>`
- ✅ (M1) Command palette (Ctrl/Cmd+K): new chat, toggle Preview Rail, dark/light switch, skin & accent switching — `client/src/components/analytikul/CommandPalette.tsx`, fully localized (`com_atk_*` keys)
- ✅ (M1) Composer history: ArrowUp/ArrowDown in the chat box cycles the last 50 sent messages (Esc restores draft) — `useComposerHistory.ts`
- ✅ (M1) Preview Rail shell with Preview/Files tabs; side rail on desktop, bottom sheet on mobile — `PreviewRail.tsx` (live renderers land in M2)
- ✅ (M1) `analytikul/no-hardcoded-color` ESLint rule (error) on `client/src/components/analytikul/**` — bans hex/rgb/hsl literals and Tailwind palette utilities; theme files are the only place hex is allowed
- ✅ (M1) Branding: app title "Analytikul" (index.html + APP_TITLE env)
- 🚧 (M2) Hermes Agent engine: 40+ tools (browser automation, terminal, sandboxed Python, vision, image gen, TTS, subagents, MoA, task planning) via `services/hermes-runtime` (pinned `484f484`, adapter health stub live)
- 📋 (M2) Agent observability: TraceViewer step tree with per-step tokens/cost/duration; versioned skills with diff + one-click rollback
- 📋 (M3) Analytics/FinOps core: cost per provider/model/user/team/conversation, budget alerts + hard limits, prompt ROI analytics, model-routing recommendations
- 📋 (M3) Organizational memory: team-shared pgvector memory with RLS isolation, source lineage, auto-injection (≤200 tokens)
- 📋 (M4) Managed messaging gateways: Telegram, Slack, Discord first; 16 platforms total — configured from settings, no VPS
- 📋 (M4) Cron-scheduled agent tasks with scheduler UI
- 📋 (M4) SaaS: orgs/teams/seats, Stripe (Free/Pro $29/Team $79+$15-seat), BYOK vault (AES-256-GCM), managed-credits wallet, admin panel

## Tooling & infrastructure
- ✅ Agency Agents installed repo-local at `.claude/agents/` (house rule §2, installed 2026-06-11)
- ✅ Monorepo scaffold: `services/{hermes-runtime,analytics,memory,billing,gateway}-service`, `packages/analytikul-shared` (typed agent/cost event contract)
- ✅ `docker-compose.override.yml` layers Analytikul services on the untouched upstream compose stack
- ✅ Upstream pins: LibreChat tag `upstream/v0-base` (788cc5a), Hermes Agent `484f484` (`services/hermes-runtime/ANALYTIKUL_PIN.md`)

## Fixes to upstream code
- **tsdown Windows build fix** (`packages/{client,api,data-provider,data-schemas}/tsdown.config.mjs`): upstream's `neverBundle` predicate used `!id.startsWith('/')` to detect project sources, which fails on Windows (`G:\…`), silently externalizing every module and emitting near-empty bundles with no `dist/style.css`. Replaced with `!path.isAbsolute(id)` — identical behavior on Linux, correct on Windows. Good candidate for an upstream PR.

## Notes workspace (Open WebUI parity — shipped 2026-06-12)
- ✅ `/notes` route: searchable note list (per-user pins first), markdown editor with formatting toolbar (bold/italic/heading/lists/tasks/code), live preview (react-markdown+GFM), word count, debounced autosave, export `.md`, delete, org-share toggle
- ✅ **AI actions** (Enhance / Summarize / Continue — selection-aware, replace-in-place): run as toolless metered agent calls through the adapter → BYOK keys, budgets (402), and cost dashboard all apply automatically
- ✅ **Agent tools**: `search_notes`, `view_note`, `write_note` registered in the Hermes registry, scoped to the acting user's own + org-shared notes (`analytikul_adapter/notes_tools.py`)
- ✅ Backend: `Note` Mongo model (`packages/data-schemas`), CRUD/search/pin/AI routes in `/api/analytikul/notes*`
- 📋 Deferred (phase 2): audio recording + transcription, real-time collaborative editing (Y.js), share links/grants beyond org-share, folders/tags
- Verification: created/typed/autosaved in browser; AI Enhance corrected a typo-filled note in place; agent created "Deployment Checklist" via `write_note` and it appeared in the list; search matched.

## M4 — Billing, gateways, production (LIVE 2026-06-12 at https://analytikul.ai)
- ✅ **Organization model** (plan/seats/credits/Stripe ids/settings) — entitlements live in our DB, never read from Stripe at runtime
- ✅ **BYOK vault**: AES-256-GCM encrypted provider keys (Postgres `billing.vault`, master key env-only), decrypt-per-request, masked display; Keys tab in Preview Rail; agent runs automatically prefer the user's vaulted key
- 🚧 **BYOK custom endpoints (2a, code-complete 2026-06-21)**: users register their own OpenAI-compatible endpoints (name/baseURL/key/models), stored in the `userendpoints` collection with the key encrypted at rest (encryptV2); every baseURL passes the SSRF guard (`packages/api/src/security/ssrf`, 16 tests incl. DNS-rebind) before storage. CRUD at `/api/analytikul/endpoints`; a per-request `applyUserEndpoints` merge splices them into `req.config.endpoints.custom` (cloned, never mutating the cache) so they appear ONLY in that user's picker and route at request time. UI: "My Endpoints" tab in the Keys panel. Pending: deploy to g3 + browser E2E
- ✅ **Stripe module** (one isolated file per BILLING.md): subscription + credits Checkout, webhook → normalized internal events → entitlements (dormant until `STRIPE_*` env set)
- ✅ **Managed Telegram gateway**: `/link <code>` account binding, per-user agent sessions, replies with agent results (dormant until `TELEGRAM_BOT_TOKEN` set)
- ✅ **Cron scheduler**: APScheduler + Postgres job store, CRUD API, verified firing real agent runs
- ✅ **Production**: docker-compose.prod.yml (only app exposed, 127.0.0.1:3180), deploy.sh with preflight+health checks, gen-prod-env.sh (fresh secrets), direct-SSH git deploy to linuxg6, Cloudflare tunnel route + www→apex redirect

## M4 verification record (2026-06-12)
Public E2E on https://analytikul.ai: registration + login + agent run completed `execute_code` (41×73=2993 ✓) with cost metering ($0.000987) through the tunnel. All 5 internal services healthy from inside the prod network. Vault roundtrip + BYOK-through-Express verified; cron fired a real agent run (`last_status: ok`); 402 budget path verified in M3. Deferred: Stripe test checkout (needs user's Stripe test keys), Telegram round-trip (needs bot token), Playwright E2E suite in CI.

## M3 — Analytics + organizational memory (shipped 2026-06-11)
- ✅ **analytics-service** (`services/analytics-service/`): Redis Streams consumer (`XREADGROUP` + `XAUTOCLAIM` crash recovery) → Postgres `analytics` schema (raw `cost_events` + `daily_rollup`), transaction-safe idempotent ingestion; REST: `/summary/{daily,models,users,conversations}`, `/events/recent`, `/summary/unpriced`, `/budgets` CRUD, `/budgets/check`
- ✅ **Budget enforcement**: per-user/org daily/monthly budgets (hard/soft); Express checks before every agent run → **402** with spend/limit detail when a hard budget is exhausted (fail-open if analytics is down)
- ✅ **AnalyticsDashboard** ("Costs" tab in Preview Rail + `Ctrl+K → Open cost dashboard`): 6 panels — 30-day overview stats, spend/day chart, spend by model, top conversations, recent calls, unpriced-models warning. Dependency-free SVG charts themed via CSS variables
- ✅ **memory-service** (`services/memory-service/`): `org_memory.memories` pgvector table with **Postgres RLS (FORCE) org isolation**, HNSW index, full lineage columns (source user/conversation/task, tags); local transformers.js embeddings (all-MiniLM-L6-v2, 384-dim — zero API cost, model cached in a volume)
- ✅ **Memory integration**: top-5 relevant memories (similarity > 0.35, ~200-token budget) injected as a system block before every agent run (`memory_injected` status event); `save_to_org_memory` agent tool registered into the Hermes registry with task-context lineage; "Memory" tab (list/save/delete with lineage display); Express proxy `/api/analytikul/memory`
- ✅ **Analytics proxy**: `/api/analytikul/analytics/:view` — JWT-gated, org-scoped, `users` view admin-only

## M3 verification record (2026-06-11)
Cross-user memory recall: user A's agent saved a fact via `save_to_org_memory` (conv A); user B's agent in conv B answered from it verbatim with `memory_injected` confirmed — the flagship test. Budget: $0.001 hard budget → HTTP 402 with spend detail; reset to $25 restored runs. Attribution: 12 calls across 2 models rolled up with correct per-model costs (haiku priced via prefix rule at $0.0000264 — hand-verified). Dashboard renders live rollup data (totals match Postgres); Memory tab lists entries with lineage. Consumer bug-fixes verified: pending-entry recovery (XAUTOCLAIM) recovered 5 stuck events; `COALESCE($n::numeric)` type fix.

## M2 — Agent engine + observability (shipped 2026-06-11)
- ✅ **Hermes agent adapter** (`services/hermes-runtime/analytikul_adapter/`): FastAPI with `/run`, `/stream/{task_id}` (SSE), `/cancel/{task_id}`, `/tools`, `/health`; per-conversation `AIAgent` session pool keyed `tenant:user:conversation` with 10-min idle eviction and per-user concurrency caps; Hermes memory disabled (`skip_memory`) — Analytikul services own persistence
- ✅ **Typed event stream**: `text_chunk | tool_start | tool_output | tool_complete | step | cost_event | status | done | error`, thread-safe bus with history replay + seq-deduped live tail
- ✅ **Cost metering**: wraps the runtime's canonical usage path (`context_compressor.update_from_response`); hot-reloadable `prices.yaml` (mtime check, no restart); every LLM call emits a `cost_event` to the stream AND to Redis Stream `analytikul:cost_events` with tenant/user/conversation/model attribution (M3 analytics consumer reads this)
- ✅ **Agent traces**: `AgentTrace` Mongo collection (steps, per-call costs, totals, final response, status incl. `cancelled`); `GET /api/analytikul/agent/traces/:conversationId`
- ✅ **Express SSE proxy** (`/api/analytikul/agent/*`): JWT-gated, per-user task ownership, env-default provider config (`AGENT_DEFAULT_*`), trace recording inline with streaming
- ✅ **Client**: `useAgentStream` hook (sse.js), TraceViewer (expandable tool steps, per-call cost rows, live cost/token counter), renderer registry (image / sandboxed-HTML iframe / JSON tree / ANSI-stripped terminal), Agent tab in Preview Rail (run/cancel/clear, auto-opens on run)
- ✅ **Sandbox posture (prod, 2026-06-21)**: agent code execution (`/exec` → `code_exec.py`) spawns a fresh ephemeral container per request under gVisor (`--runtime=runsc`) via a hardened docker-socket-proxy — `--network=none`, read-only rootfs, `--cap-drop=ALL`, `no-new-privileges`, hard memory/pids caps, non-root uid 10001, and a `volume-subpath` mount exposing only that task's workdir. Verified: code reports kernel `4.19.0-gvisor`, artifacts round-trip, network refused, timeouts kill at the deadline. Falls back to in-adapter subprocess when `TERMINAL_ENV=local` (dev)
- ⚠️ **Known gaps** (tracked for M3): browser toolset (`browser_navigate` etc.) is availability-gated off in the container — Playwright Chromium is installed but the toolset needs config enablement + verification; skill versioning/rollback UI not yet built; screenshots of tool output verified by renderer logic, not yet by a real browser-tool run

## M2 verification record (2026-06-11)
Live E2E with a real Anthropic key: agent task via UI and API completed `execute_code` (sandboxed Python, SHA-256 task — output independently verified); 2 cost events metered ($0.002397, 4 in/159 out tokens) and visible live in the TraceViewer counter ("250 tok · $0.0037" across the UI session); cancel mid-run returned `{"cancelled":true}` and terminated with `done/interrupted:true`; trace persisted to Mongo with full step sequence and cost totals; 3 attributed cost events in Redis Stream `analytikul:cost_events`; 17 tools live in `/tools`; error paths (bad base URL, bad key) stream cleanly and persist as `status:error` traces.

## M1 verification record (2026-06-11)
Verified interactively against the Vite dev client (:3090) proxying the Docker backend (:3080): registration/login; aurora default skin + indigo accent (computed `--gray-900: #0c0f1d`, `--surface-submit: #4f46e5`); all four dark ramps by computed value (slate `#0d0d0d`, verdant `#0e1411`, ember `#121110`); Ctrl+K palette open/filter/execute; dark↔light via palette with readable text in both; Preview Rail tabs + mobile bottom-sheet variant; composer history save/restore. Lint clean incl. the color rule (negative test confirmed the rule fires). Lighthouse run deferred to CI (M4).

## Deliberate deviations from the plan
- LibreChat internal npm package names (`librechat-data-provider`, `@librechat/*`) are **kept** rather than renamed to `@analytikul/*`: a mechanical rename would touch hundreds of upstream files and destroy upstream mergeability. Branding happens at the UI/config level (M1). New packages use the `@analytikul/*` scope.

## AiBox voice assistant — Amy (host-level, outside the web platform)
Runs on the AiBox host itself (systemd), not in the Analytikul containers. Full reference: [`docs/aibox-eyes.md`](aibox-eyes.md).
- ✅ Always-on wake-word assistant "Hey Amy" — SP92 speakerphone, faster-whisper STT, Ollama llama3, Piper TTS (Amy voice) — service `aigartha`
- ✅ **Always-on eyes (2026-08-02)**: OBSBOT Tiny USB gimbal camera, continuous 2 fps capture in tmpfs, motion-triggered scene descriptions via local `qwen2.5vl:7b` on CT200 — service `amy-eyes`, API on `127.0.0.1:8823`
- ✅ **Ambient awareness**: the cached room description is injected into Amy's system prompt every turn, so she knows what she is looking at at zero added latency
- ✅ **Live visual Q&A**: visual questions ("what do you see", "how many people are here", "what am I holding") send the current frame to the vision model — ~3.5 s round trip
- ✅ **Camera control by voice**: "look left/right/up/down", "look straight ahead", "look at the &lt;saved spot&gt;", "remember this spot as X" — pan ±130°, tilt ±90°
- ✅ **Room scan**: "look around the room" sweeps 5 positions, describes each, and speaks a condensed summary (~25 s)
- ✅ **Privacy switch**: "close your eyes" stops the capture process outright and releases the device (camera light goes out); "open your eyes" restores. Nothing is ever recorded to disk; no frame leaves the box
- 📋 Not enabled: proactive greeting when someone enters the room; face recognition (Amy describes people, does not identify them)

### Amy — web search + desktop hand-off (2026-08-02)
Full reference: [`docs/aibox-search-desktop.md`](aibox-search-desktop.md).
- ✅ **Web search by voice**: "search for X" / "look up X" / "google X" → self-hosted **SearXNG** (linuxg3:8080), spoken 1–3 sentence answer naming the top source (~2 s). No API key, no rate limit, query never hits a commercial search account
- ✅ **Remembers the top 5 links** from the last search for follow-up commands
- ✅ **"Pull that up on my computer"** → opens the page in the browser on the Windows desktop (`DESKTOP-ADMIN`); also "show me that", "open that", "open the second one", "pull up number two"
- ✅ **Desk bridge** (`amy-deskbridge`, port 8824): token-authenticated long-poll queue; `/open` is localhost-only, pollers restricted by token + CIDR, http(s)-only at both ends
- ✅ **Windows session agent**: PowerShell long-poller in the interactive logon session (autostarts at logon), so the browser window is always visible — SSH-launched browsers land in an invisible session
- 📋 Limits: remembered links are in-process (cleared on restart); answers come from search snippets, not full page text; single desktop target
