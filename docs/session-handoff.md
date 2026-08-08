# Analytikul — Session Handoff (2026-06-13)

## Latest session (2026-06-13) — redesign shipped + host decommission
- **Open WebUI redesign DONE & DEPLOYED.** Reworked `NotesList.tsx`/`NoteEditor.tsx` to match
  open-webui source (controls-row dropdowns, search restyle, editor trims; kept AI + Share).
  Removed dead `UnifiedSidebar` subtree. Committed `8fb5d3456`, deployed to prod (image
  `9a62c2c4ead7`), analytikul.ai 200, verified end-to-end in browser. **Pending: user's visual
  pixel sign-off** vs `chat.analytikul.ai`.
- **Dev gotcha found:** local Docker `LibreChat` container and native `npm run backend` both bound
  :3080 → API calls split nondeterministically (404 vs 401). Fix: `docker stop LibreChat` so the
  native fork owns :3080.
- **linuxg6 decommission (owner-directed):** removed postiz/temporal + shopware
  (market.phoenixtekk.com) + mission/review services & dirs to free I/O (deploy's buildkit export
  was hanging on host overcommit). Left `memory.analytikul.ai` data + `globalsettings` alone.
  See current-state.md / open-issues.md.

---
## Prior session (2026-06-12)

## Executive Summary
Analytikul is **live in production at https://analytikul.ai** (host: linuxg6, Cloudflare tunnel).
Milestones M0–M4 are complete and verified: a LibreChat fork + vendored Hermes agent runtime,
restyled with Hermes Desktop's look, plus four shipped differentiators — FinOps cost analytics,
organizational memory, agent observability, and managed Telegram/cron gateways — with BYOK key
vault and (dormant) Stripe billing. A Notes feature shipped, and an **Open WebUI UI redesign of
Notes + the sidebar is IN PROGRESS** (built and rendering on the dev machine, NOT yet committed
or deployed — this is the active task to resume).

## Completed During This Session (and prior, cumulatively)
- M0–M4 in full (see current-state.md table). Production E2E verified (agent ran 41×73 via
  analytikul.ai with cost metering; cross-user org-memory recall; $0.001 budget → 402; Telegram
  link + cron fire; BYOK vault roundtrip).
- Notes workspace (Open WebUI parity v1): backend model + CRUD/search/pin/AI routes, agent tools,
  TipTap-based editor, AI Enhance/Summarize/Continue (metered). Deployed.
- Logo/favicons swapped to the user's brain-circuit logo (`client/public/assets/*` from
  `public/Alogo2.png`).
- SES SMTP configured in prod `.env` (pending SES domain verification by user).
- Stripe webhook forwarder + Telegram link-code route added and deployed.
- **This session's redesign (uncommitted):** new `NotesList.tsx`, `NoteEditor.tsx`, `time.ts`,
  `AnalytikulSidebar.tsx`; `Root.tsx` sidebar swap; routes split; old `NotesPage.tsx` removed.
- Full docs/ + ADR set written (this handoff).

## Current Focus
Finishing the Open WebUI redesign: verify Notes + sidebar end-to-end in the browser, visually
match the two screenshots the user provided, then commit + deploy to analytikul.ai. The redesign
renders (sidebar + list shells confirmed); data-flow + visual parity + deploy remain.

## Known Issues
- Redesign not committed/deployed → production still shows the OLD Notes UI (why the user said
  "I don't see Notes looking right").
- Docker Desktop on the Windows dev box crashed repeatedly this session, killing local Mongo and
  blocking verification. Recovery: start Docker Desktop → `docker compose up -d` → restart backend.
- linuxg6 image builds are slow (20-40 min); container swap only after full build. See open-issues.md.

## Recommended Next Actions (see next-actions.md for detail)
1. **P0**: verify the redesign in-browser, visual diff vs screenshots, commit, deploy, confirm live.
2. **P1**: activate Stripe (TEST mode — user's choice), Telegram, finish SES domain verification.
3. **P2**: change the test prod account password; tidy unused old `UnifiedSidebar` files.

## Important Decisions to Preserve (full detail in ADRs)
- Faithful React rebuild for Open WebUI look — do NOT switch to Svelte (ADR-009).
- Never edit vendored Hermes runtime; minimize upstream LibreChat edits — new files only (ADR-007).
- BYOK-first AI with Anthropic default, no `/v1` on the base URL (ADR-003).
- AES-256-GCM vault, env master key (ADR-004). Stripe isolated in one module (BILLING.md).
- Only the app container is publicly exposed; user manages all Cloudflare in the console (ADR-005).
- Apex-only serving (analytikul.ai), www→apex redirect.

## Risks
- Live billing = real money; verify in Stripe TEST first (user chose test until bank setup).
- gVisor sandboxing not yet on prod — agent code-exec isolation is container-level only.
- mongo:4.4 is EOL (forced by no-AVX hardware).
- Vendored runtime lint drift; upstream-diff discipline needed over time.

## Files of Interest (read these first)
- Routes: `api/server/routes/analytikul.js`, `api/server/index.js` (webhook mount).
- Backend logic: `packages/api/src/analytikul/{service,trace,vault,budget,types}.ts`.
- Adapter: `services/hermes-runtime/analytikul_adapter/{main,sessions,events,meter,memory,notes_tools}.py`.
- UI (active): `client/src/components/analytikul/notes/*`, `.../sidebar/AnalytikulSidebar.tsx`,
  `client/src/routes/{Root,index}.tsx`, `client/src/components/analytikul/AnalytikulProvider.tsx`.
- Services: `services/{analytics,memory,billing,gateway}-service/`.
- Ops: `docker-compose.prod.yml`, `scripts/{deploy,gen-prod-env}.sh`, `BILLING.md`,
  `services/hermes-runtime/ANALYTIKUL_PIN.md`.
- Existing docs: `docs/{FEATURES,ADMIN_DOCS,HELP_CENTER}.md` (per-milestone verification records).
