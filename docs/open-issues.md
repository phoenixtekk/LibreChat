# Analytikul — Open Issues & Technical Debt

## Active blockers / in-flight
- **(MOSTLY DONE 2026-06-27) Memory Phase 1 — Daily Logs DEPLOYED.** Engine (`d204f1df9`) +
  app-side (`e06bf49d3`, app image `ddee6c42`) live: 15-min observer (dirty-queue, vLLM Qwen 2.5
  extraction, injection-contained), tz-aware idempotent consolidation, bounded backfill; activity hook
  (performCleanup → non-blocking `/observer/dirty`); `/api/analytikul/daily-logs` proxy; Daily Logs UI
  (sidebar nav + `/daily-logs` list + `/daily-logs/:date` markdown viewer). Verified on prod (SPA 200,
  proxy authed 200 with real backfilled log). **REMAINING:** (b) retrieval injection — adapter
  `memory.py` build_memory_block (needs user_id plumbing) to inject the latest daily-log recap into new
  chats (separate hermes-adapter rebuild); then Phases 2–4 (semantic/procedural/graph+decay). Refinement:
  backfilled episodes are dated at backfill time; importance scoring still default 0.5 (Phase 4).
- **(RESOLVED 2026-06-26) Memory: Phase 0 + org-RLS-bypass fix deployed (`21e426570`).** The 4-layer
  memory engine + Daily Logs design is approved (ADR-010, `docs/memory-architecture.md`, Backend
  Architect-reviewed). Phase 0 shipped: memory-service refactored to a two-role model (admin `myuser`
  for DDL/cross-user; least-privilege `memory_rt` NOBYPASSRLS for all per-tenant queries), new `memory`
  schema (episodes/daily_logs/facts/procedures/observer_queue/…), per-user `app.user_id` RLS, and
  `/episodes` + `/daily-logs` + `/observer/dirty` endpoints. **This also closed a latent CRITICAL: the
  org memory-service relied on RLS that the bootstrap superuser bypassed → org isolation was a no-op
  (latent only because 0 rows). Now enforced (verified on prod: orgA search ≠ orgB).** Audited
  analytics/billing/gateway — SAFE (explicit `WHERE org_id` filters). **NEXT = Phase 1 (Daily Logs):**
  15-min observer + extraction + consolidation + UI panel, plus the deferred `vllm_default` compose
  attachment for memory-service.
- **(RESOLVED 2026-06-23) Durable app deploy.** Rebuilt the `analytikul-app` image from
  `marketing/analytics-tracking` HEAD on linuxg3 (`docker compose build app`) so all code (sandbox,
  2a BYOK + polish, the merged security hardening) is now BAKED — no longer docker-cp hotfixes.
  Recreated, restored `librechat.yaml` + `vllm_default` bridge, verified end-to-end (public 200, all
  5 modelSpecs, 2a CRUD/guard/SSRF/auto-detect, gVisor /exec). Rollback image kept as
  `analytikul-app:rollback-pre-rebuild`. A `--force-recreate` now only needs yaml + vLLM-bridge
  re-applied (see [[deploy-fragility-warning]]).
- **Security hardening — LIVE (audit memory was stale).** CORS allowlist, security headers
  (HSTS/XFO/CSP/nosniff), per-route rate limiting, and internal-service `x-internal-token` are all
  deployed; the token is enforced on ALL services. (RESOLVED 2026-06-23) hermes-adapter token is now ENABLED:
  `require_internal_or_bearer` (accepts x-internal-token OR `Authorization: Bearer`) on `/exec` +
  `/v1/code/run`, app sets `LIBRECHAT_CODE_API_KEY=INTERNAL_SERVICE_TOKEN`, token added to adapter
  compose env; baked into both images. Verified: /exec no-auth→401, bearer→200, code-exec works.
  (RESOLVED 2026-06-24) protobufjs CRITICAL — migrated memory-service `@xenova/transformers@2.17.2`
  → `@huggingface/transformers@4.2.0` (`4bf3bb842`). `onnx-proto`/protobufjs 6.x gone; protobufjs now
  7.6.4 (patched), `npm audit` → 0 vulnerabilities. `dtype: 'q8'` pins the same int8 quantized
  all-MiniLM-L6-v2, so embeddings are behavior-equivalent (prod had 0 stored rows anyway). Verified on
  the prod base image + live save/search. (App-side protobufjs 7.5.8 via `@google/genai`/OTel-grpc is a
  separate patched-7.x tree, not the CRITICAL.)
  (RESOLVED 2026-06-24) g3 `docker-compose.prod.yml` infra (gVisor socket-proxy, readonly-fix, adapter
  token, hardening env) is now COMMITTED to the repo (`72ee20939`, all `${VAR}` refs, no literal
  secrets).
  (RESOLVED 2026-06-25) `analytikul-memory` now enforces `INTERNAL_SERVICE_TOKEN` (`99f09d76b`): added
  the env to its compose block. Both callers (app `internalHeaders()`, adapter `_internal_headers()`)
  already send `x-internal-token`; gateway doesn't call memory. Verified: token hash identical across
  app/adapter/memory, unauthenticated → 401, valid-token save/search → 201/200, wrong-token → 401, no
  caller regression.

- **(RESOLVED 2026-06-13)** Open WebUI redesign — committed `8fb5d3456`, deployed (image
  `9a62c2c4ead7`), verified end-to-end in browser. Only the user's visual pixel sign-off vs
  `chat.analytikul.ai` remains (preview screenshot tool times out on this SPA).

## linuxg6 host capacity (ops)
- **Resource overcommit caused buildkit export hangs.** During the redesign deploy the host ran
  2 Minecraft servers (`/home/lacy/cobblemon`, `/home/lacy/cobbleverse`, up to ~14G heap combined)
  + Elasticsearch/temporal + shopware + 2 LibreChat stacks + analytikul + the image build. I/O
  contention (~13% PSI) hung `docker compose build`'s image-export step twice; killing the wedged
  build + shedding load let it complete. NOT hardware: dmesg clean (no OOM/disk errors); the lone
  reboot (18:16) was a clean shutdown; D-state `systemd-udevd`/`usb_hub` threads = benign virtual
  -ATAPI (IPMI) probe, just inflate load average. **Lesson: deploy when the host is quiet, or shed
  load first.** Decommissioning postiz/temporal/shopware/mission/review (see current-state.md)
  freed significant headroom.
- **Cobblemon/Cobbleverse Minecraft servers** remain (owner's) — largest steady consumers now.

## Environment fragility (dev machine)
- **Docker Desktop instability on Windows dev box** — crashed/stopped 3+ times this session.
  Each crash drops the localhost port maps for Mongo (27017) and Meili (7700), and the native
  `npm run backend` dies with `ECONNREFUSED ::1:27017` / mongoMeili `fetch failed`. Recovery:
  start Docker Desktop → `docker compose up -d` → restart backend. Not a code bug.
- **Port 3080 EADDRINUSE** — orphaned backend processes accumulate; kill all listeners on 3080
  before restarting (PowerShell `Get-NetTCPConnection -LocalPort 3080`).
- JWT ~15-min expiry breaks long-running curl test scripts mid-run — re-login in the script.

## Production
- **Slow image builds on linuxg6** (no AVX, modest CPU): app image ~20-40 min; `npm run frontend`
  step dominates. Container swap sometimes appears not to happen until the build fully finishes —
  watch `docker inspect analytikul-app --format '{{.Image}}'` change, not just deploy log "done".
- **Docker daemon restart bounces ALL containers** on the shared host (other production sites).
  Needed once to recreate missing `DOCKER-FORWARD` iptables chains. Always get user approval.
- mongoMeili `fetch failed` warnings at startup are noise when Meili isn't reachable yet; not fatal.

## Known cosmetic / deferred
- Vendored `services/hermes-runtime/**` JS/TS carries prettier/eslint drift from the initial
  commit (before the lint filter existed). Python runtime untouched. Documented in ANALYTIKUL_PIN.md.
- PDF export of notes not implemented (only .md). Open WebUI parity for audio/collab/share-links
  deferred to phase 2.
- Old `UnifiedSidebar` component tree now unused after sidebar swap but not yet deleted.

## Security audit 2026-06-14 (branch `security/internal-svc-hardening`) — DEPLOY ACTION REQUIRED
Fixed in code (see FEATURES.md → Security hardening): internal services bound to `127.0.0.1` +
shared-token auth; billing webhook idempotency / paid-amount credits / Polar fail-closed /
creds fail-fast; non-overridable runtime toolset floor; Telegram link-code entropy+expiry+atomic
claim; budget fail-closed for platform-key runs; notes regex escape.
- **REQUIRED before/at next deploy:** add `INTERNAL_SERVICE_TOKEN` to prod `.env` (32-byte hex;
  `gen-prod-env.sh` now emits it) and redeploy the **whole** stack so all services share it. If
  it's set on only some services, cross-service calls 401. Until set, services log a warning and
  stay open (loopback binding still protects them).

## Round 2 fixes (2026-06-14, same branch) — tenant isolation, hybrid billing, cleanup
- **Tenant isolation:** routes no longer collapse un-tenanted users into a shared `'default'`
  org — scope is now `tenantId || userId` (`tenantOf()`), so solo users are isolated and orgs
  still share. `applyTenantIsolation` added to the Note model (defense-in-depth). **Run the
  backfill once on prod:** `MONGO_URI=… node scripts/analytikul-backfill-tenant.mjs` (re-keys
  existing `'default'` notes/traces to each owner). Postgres org-memory/analytics rows keyed by
  `orgId='default'` are separate — re-key them too if you have shared org data (prod had ~none).
  To turn on the framework's hard fail-closed mode later, set `TENANT_ISOLATION_STRICT=true`
  **after** confirming the tenant-context middleware runs on all Note/Trace request paths.
- **Analytics:** raw `events`/`unpriced` views are now admin-only (like `users`); aggregate cost
  views stay open to org members.
- **Webhook forwarders:** rate-limited (120/min/IP) to stop unauthenticated amplification.
- **Hybrid billing (chosen model):** `CHECK_BALANCE=true` + `START_BALANCE` (free-tier grant) in
  `gen-prod-env.sh`; paid plans top up balance via the webhook (`PLAN_CREDIT_GRANT_PRO/TEAM` →
  `entitlements.grantPlanBalance`). NOTE: native-chat is platform-paid+capped for all tiers;
  **true BYOK for paid users currently applies to the agent path (vault)**. Native-chat per-user
  BYOK needs a LibreChat endpoint-override (deferred — `ANTHROPIC_API_KEY=user_provided` is
  all-or-nothing per endpoint and conflicts with a platform-paid free tier).
- **2a BYOK user-defined custom endpoints — IN PROGRESS.** Lets each user register their own
  OpenAI-compatible endpoints that appear ONLY in their picker. Foundation shipped: SSRF guard
  (`packages/api/src/security/ssrf`). Data layer DONE + builds clean (2026-06-21):
  `packages/data-schemas/src/schema/userEndpoint.ts` (userId/name/baseURL/`apiKey` encrypted via
  encryptV2 + `select:false`/models/tenantId, unique `{userId,name}`), model + `createUserEndpointMethods`
  (list/get/create/update/delete + `resolveUserEndpoints` which returns decrypted keys for runtime
  only), registered in the schema/models/methods barrels and exposed through `createMethods`.
  CRUD API DONE (2026-06-21): added to `api/server/routes/analytikul.js` under `/api/analytikul/endpoints`
  (GET list / POST / PUT :id / DELETE :id), authed + rate-limited by the existing router middleware,
  calling the data-schemas methods via `~/models`. Every create/update runs `baseURL` through
  `validateUrl()` (now exported from `@librechat/api`) before storage; invalid-ObjectId ids → 404,
  duplicate names → 409. SSRF Jest suite DONE: `packages/api/src/security/ssrf/validator.spec.ts`,
  16 tests incl. DNS-rebinding (re-resolve flips public→link-local), split-horizon multi-record,
  CGNAT/docker-bridge/metadata IP classes — all passing. `packages/api` + `data-schemas` rebuilt.
  CONFIG MERGE DONE (2026-06-21): a single seam handles picker + routing because `getEndpointsConfig`,
  `loadConfigModels`, and `getCustomEndpointConfig` all read `req.config.endpoints.custom`. New helper
  `api/server/services/Config/userEndpoints.js` `applyUserEndpoints(appConfig, req)` clones appConfig
  (never mutates the cached global) and splices the user's `resolveUserEndpoints()` entries into
  `endpoints.custom` ({name, apiKey, baseURL, models:{default,fetch:false}, modelDisplayLabel}),
  skipping names that collide with global yaml endpoints. Wired into `configMiddleware`
  (`middleware/config/app.js`); `configMiddleware` ALSO added to the `/api/endpoints` and `/api/models`
  routes (they only had requireJwtAuth) so the picker's two data sources see the merged config. Unit
  tested (`userEndpoints.spec.js`, 6 tests: clone-not-mutate, collision skip, graceful DB-failure).
  Perf note: this adds one indexed `resolveUserEndpoints` query per request on configMiddleware routes
  (chat/agents/endpoints/models) — fine for now; add a short per-user cache if it shows up hot.
  UI DONE (2026-06-21): `KeysPanel.tsx` now has internal "Keys" / "My Endpoints" tabs; new
  `client/src/components/analytikul/EndpointsPanel.tsx` does add/list/delete against
  `/api/analytikul/endpoints` (mirrors the `KeysPanel`/`OrgMemoryPanel` fetch pattern), surfaces the
  server's SSRF rejection message on a bad URL, and uses `com_atk_endpoints_*` locale keys (added to
  `en/translation.json`). Typechecks clean.
  2a is SHIPPED + verified on prod (2026-06-22). Deployed via docker-cp: data-schemas + packages/api
  `dist/index.cjs`, the 5 `api/server/**` JS files, and client dist, then `docker restart analytikul-app`.
  Authenticated E2E (minted JWT for the admin user) passed: SSRF gate rejects `http://redis:6379`
  (400), create→list→delete work, the endpoint appears in BOTH `/api/endpoints` and `/api/models`
  (picker merge live), the API key is NOT leaked to the client, and the picker routes still 200 (no
  regression from the added configMiddleware). NOTE: the literal "send a chat through it" step needs a
  REAL provider key (the user's, entered in the UI) — routing config is in place (getCustomEndpointConfig
  reads the same merged req.config.endpoints.custom) but a live LLM call was not exercised with the
  dummy key. REMAINING (optional): inline edit in the UI (currently add/delete; edit = delete + re-add);
  a short per-user resolve cache if configMiddleware shows hot.
  MINOR follow-up: `validator.ts` `resolveAllWithTimeout` leaks a 3s `setTimeout` (no `clearTimeout`
  when the DNS promise wins the race) — harmless but trips Jest's open-handle warning; clear it.
- **Dead code:** `useUnifiedSidebarLinks.ts` was already removed; `ConversationsSection` is still
  in use by `AnalytikulSidebar` (kept).

## Security / ops to confirm before scale
- Test prod account `lacy@analytikul.ai` has a known weak password from chat — change it.
- gVisor sandboxing: DONE — true per-task isolation is LIVE on linuxg3 (2026-06-21).
  `analytikul_adapter/code_exec.py` now spawns a fresh ephemeral container per request via the
  docker-socket-proxy when `TERMINAL_ENV=docker`: `--runtime=runsc` (from
  `TERMINAL_DOCKER_EXTRA_ARGS`), `--network=none`, `--read-only` rootfs, `--cap-drop=ALL`,
  `--security-opt no-new-privileges`, hard `--memory`/`--pids-limit`, non-root `--user 10001`,
  and a `--mount volume-subpath` that exposes ONLY this task's workdir (a subdir of the shared
  `analytikul_hermes-home` volume) — sibling tasks and the adapter home are not visible. Verified
  end-to-end via `/exec`: code reports kernel `4.19.0-gvisor`, artifacts round-trip, network is
  refused, infinite loops are killed at the timeout (exit 124). The in-adapter `_run_subprocess`
  path remains only as the `TERMINAL_ENV=local` dev fallback. The fix is baked into the adapter
  image (durable across recreate), not docker-cp'd.
  Two infra prerequisites that bit us getting here (both fixed): (1) the adapter image must
  install `docker-ce-cli` from Docker's apt repo, NOT Debian's `docker.io` (which ships no client
  binary) — in `analytikul_adapter/Dockerfile`; (2) `tecnativa/docker-socket-proxy:0.3.0` must
  NOT run with `read_only: true` — it writes `/usr/local/etc/haproxy/haproxy.cfg` at boot and
  crash-loops otherwise (fixed in g3 compose and `scripts/activate-gvisor-sandbox.sh`).
  FOLLOW-UP (minor): the `/exec` proxy still passes `files: []` (LibreChat file-ref handoff TODO),
  so artifacts are returned in the response but input files from LibreChat aren't yet bridged.
- SES likely in sandbox mode — only sends to verified addresses until production access granted.
- Stripe/Telegram tokens not yet set in prod (features dormant, return 503/disabled).
