# Analytikul — Open Issues & Technical Debt

## Active blockers / in-flight
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
- **Not auto-fixed (need a product decision):** the `tenantId == 'default'` shared-tenant
  fallback (un-tenanted users share one org for notes/memory/analytics — assign real tenantIds
  + `TENANT_ISOLATION_STRICT=true`); per-user vs per-org visibility of `/analytics` events and
  `/memory` delete; edge webhook signature pre-verification + rate-limiting.

## Security / ops to confirm before scale
- Test prod account `lacy@analytikul.ai` has a known weak password from chat — change it.
- gVisor sandboxing NOT yet on production (agent code-exec isolation = container boundary only).
  Fine for trusted users; harden before untrusted multi-tenant signups.
- SES likely in sandbox mode — only sends to verified addresses until production access granted.
- Stripe/Telegram tokens not yet set in prod (features dormant, return 503/disabled).
