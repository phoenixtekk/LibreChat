# Analytikul — Open Issues & Technical Debt

## Active blockers / in-flight
- **Open WebUI redesign uncommitted & unverified end-to-end** — new Notes UI + sidebar render
  but data-flow + visual parity not confirmed; not committed, not deployed. Production still
  shows the OLD Notes UI (root cause of "I don't see Notes looking right").

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

## Security / ops to confirm before scale
- Test prod account `lacy@analytikul.ai` has a known weak password from chat — change it.
- gVisor sandboxing NOT yet on production (agent code-exec isolation = container boundary only).
  Fine for trusted users; harden before untrusted multi-tenant signups.
- SES likely in sandbox mode — only sends to verified addresses until production access granted.
- Stripe/Telegram tokens not yet set in prod (features dormant, return 503/disabled).
