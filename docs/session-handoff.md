<!-- session-version: 2 -->
<!-- pending-session-title: -->

# Analytikul — Session Handoff

> **FIRST ACTION (fresh session):** set your session title from the `pending-session-title`
> marker above (use `mcp__ccd_session_mgmt__set_session_title` if available, else ask the owner
> to rename the tab), then **clear that marker** so the next rotation sets a fresh name. Read this
> Working-state block first — it supersedes the stale host references in `session-startup-prompt.md`.

## Working state — 2026-09-20 (rotated v1 → v2)

**⚠ Infra correction (supersedes `session-startup-prompt.md`'s "linuxg3"):** production runs in
**CT201 (docker-in-LXC) on the "ai" Proxmox host** — `ssh ai` → `sudo pct exec 201 -- docker ...`.
Config: `/opt/analytikul/librechat.aibox.yaml` (bind-mounted → `/app/librechat.yaml`); `docker
restart analytikul-app` reloads it; `docker commit analytikul-app analytikul-app:coder` bakes
container hotfixes (WIPED by force-recreate — memory: deploy-fragility-warning). Comfy media on
**CT202** (192.168.166.183). Ollama hosts: **AI Box CT200** (192.168.166.182) + **AISERVER**
(192.168.166.158). Apex `analytikul.ai` canonical (200).

**Git:** branch `feature/analytikul-coder`, HEAD `b5c2a024f` (+ pending doc/handoff edits). 7 commits
this session, **none pushed, none deployed**: `b5af39362` client rebrand + landing Desktop section +
sidebar restyle; `281f58444` coder-bridge phantom-folder fix; `286ff8664` aibox-voice barge-in/speaker-
verify; `f6fc6707f` Notes image paste/drop; `7d353e9ca` **Hermes re-vendor v0.16→v0.21.5**;
`b5c2a024f` **Bots surface + hermes-gateway + broker (S2/S3)**.

**Hermes Bot Mode work (2026-09-29) — see `docs/hermes-botmode-integration-plan.md` +
`docs/hermes-0.21.5-rpc-and-adapter-map.md`:**
- Owner decisions: native Analytikul surface (path C), update to v0.21.5, **admin-only first**, full arc.
- **S1 done:** re-vendored `services/hermes-runtime/` to v0.21.5 (tag `v2026.9.24`, commit `f97608f`),
  adapter ported (low-risk — all hooked symbols compatible), `HERMES_PIN` bumped, `ANALYTIKUL_PIN.md`
  updated, `website/` dropped. py_compile clean. **NOT runtime-verified** (needs container rebuild).
- **S2/S3 done:** `hermes-gateway` compose service (Hermes dashboard `:9119`, internal, own volume);
  `api/server/hermesBots.js` WS JSON-RPC broker + `/api/analytikul/bots/rpc`+`/bots/health` (admin);
  `Bots` rail tab → `BotsPanel` (roster/create/describe). Frontend typechecks clean.
- **Bot Mode = a Hermes profile** (`profiles.*`, `message_agent`, `groups.*` rooms, `cron.manage`)
  over the **tui_gateway WS `/api/ws`**. The deployed `analytikul-openclaw` is `openclaw:2026.7.1-2`
  (pre-Bot-Mode) — hence the new gateway from our own tree.
- **S4/S5 BUILT + pushed** (`0919dd870`): routines (`cron.manage`), rooms (`groups.*` list/create/
  state/log), poll-based bot chat (`session.resume`+`prompt.submit`), org-shared toggle, per-bot
  provider pin — all against **source-read** v0.21.5 return shapes. Deferred (needs live gateway):
  chat token-streaming (broker SSE relay), user-injected room msgs (`groups.send` payload), per-bot
  FinOps data feed.

**⚠ DEPLOY TOPOLOGY CORRECTION (2026-09-29 pre-flight) — supersedes the plan doc's prod.yml refs:**
Prod on CT201 runs from the **host-only `docker-compose.aibox.yml`** (+ `.env.aibox`), and
`/opt/analytikul` is a **git-archive of `feature/analytikul-coder`, NOT a git repo** (no `git pull`).
Deploy = copy files into `/opt/analytikul` → `docker build -t analytikul-hermes:coder` /
`analytikul-app:coder` → `docker compose -p analytikul -f docker-compose.aibox.yml up -d
--force-recreate <svc>` (force-recreate RACES the build — verify the running image id changed).
`docker-compose.prod.yml` (build-based) is NOT what prod uses. **Now reconciled:** the authoritative
`docker-compose.aibox.yml` is vendored into the repo with the `hermes-gateway` service added.

**DEPLOY WINDOW — RUN 2026-10-04 (additive stand-up; prod untouched throughout).**
`scripts/standup-hermes-gateway.sh` ran; uncovered + fixed a chain of real issues, gateway now UP:
- **hermes-gateway is UP** (`analytikul-hermes-gateway`, image `analytikul-hermes:coder` = v0.21.5),
  stable (`restarts=0`), serving `:9119` (HTTP 302 → auth login). PROD app+adapter untouched (Up 6 days).
- **Fixed (committed `9429b60d5`):** root `.gitignore` `*.d.ts` silently dropped 7 hand-written vendored
  source `.d.ts` (incl. `web/src/plugins/sdk.d.ts`) → git-archive never shipped them → gateway web build
  failed. Un-ignored under `services/hermes-runtime/**`.
- **Gateway config learned the hard way:** `hermes dashboard` needs `--skip-build` (serve headless; web
  dist builds to `hermes_cli/web_dist`) + `init:true`; a **non-loopback bind REQUIRES an auth provider**
  (`--insecure` does NOT bypass). Configured the **basic** provider via `.env.aibox` env
  (`HERMES_DASHBOARD_BASIC_AUTH_USERNAME=analytikul`, `_PASSWORD=<=HERMES_GATEWAY_TOKEN>`, `_SECRET`).
  Chowned the `aibox-hermes-gateway` volume to uid 10001 (hosted-rooms sqlite write perms).
- **⚠ REMAINING before the Bots UI works E2E:**
  1. **Broker auth handshake.** The dashboard WS (`/api/ws`) auth is browser-style **login → ws-ticket**,
     NOT the simple Bearer the broker (`api/server/hermesBots.js`) sends. The broker must POST basic-auth
     creds → get a session/ws-ticket → connect `/api/ws` with it. This is the key remaining integration.
  2. **Rooms-db perm** — 1 residual `sqlite3.OperationalError` after chown; confirm when groups.* used
     (durable fix: chown `/data/hermes-gateway` in the image Dockerfile, not just the live volume).
  3. **Prod swap (gated):** rebuild+recreate `app` with `HERMES_GATEWAY_URL` + the bots routes, then
     `hermes-adapter` → v0.21.5 (smoke-test an agent run first).
  Gateway left running (stable, internal-only). `--skip-build` dist currently builds at image/first-run;
  durable optimization: bake `hermes_cli/web_dist` in the Dockerfile.

**Shipped this session (server-side, verified live):**
- **qwen3-coder web-search crash FIXED.** `qwen3-coder:30b` leaks XML tool calls in Ollama
  streaming (never structured) → agents converter hit `undefined.role`. Patched the
  `@librechat/agents` OpenAI converter (marker `[atk-patch]`, drops null msgs) in `analytikul-app`,
  baked into `analytikul-app:coder`. **For local web search/tools use `qwen3-vl:30b`, not coder.**
  (memory: analytikul-ollama-toolcalls)
- **ComfyUI video FIXED (CT202).** `get_video` no longer crashes on a dead/expired 404; bridge
  `job_status` now recovers completed jobs from disk. Edited `/opt/comfy-mcp/mcp_server.py` +
  `/opt/comfy-bridge/app.py` (.bak kept), services restarted; fresh test render succeeded E2E.
  WAN 14B is slow ~7min / OOM-prone; `wan5b` is the lighter option (offered as default, NOT
  approved). (memory: analytikul-comfy-video)
- **qwen3.8:27b enabled on AISERVER.** Added `AISERVER` custom endpoint (→192.168.166.158:11434,
  `max_tokens:2000` reasoning floor) + "Qwen 3.8 27B — fast" preset to the CT201 config;
  restarted + verified; server-inventory updated.
- **Higgsfield** integration: feasibility confirmed (public async job API, fits the comfy-MCP
  pattern); NO build — awaiting owner decisions on cost/data-egress/key model.

**Shipped this session (2026-09-20 v2):**
- **wan5b is now the DEFAULT video model** (owner-approved). CT202 `app.py`+`mcp_server.py`
  defaults flipped, `.bak-wan5b` kept, both services restarted + verified. 14B is opt-in via
  `hq=True`. (memory: analytikul-comfy-video)
- **Notes image paste/drop — BUILT (server-upload, Notes + chat).** Owner picked server-upload +
  "Notes + chat composer". New `POST /api/analytikul/notes/image` (multer→file-strategy saveBuffer
  →`/images/<userId>/`, png/jpeg/gif/webp, 10 MB, auth-gated); NoteEditor registers
  `@tiptap/extension-image` (pinned 3.26.1 to match core) + paste/drop upload+insert. Chat composer
  already supports image paste/drop natively (LibreChat `useTextarea`/dropzone) — no change. Typechecks
  clean; **NOT yet deployed** (needs `analytikul-app` image rebuild — deploy-fragility-warning).
- Reviewed + committed the whole v1 dirty tree (4 commits, above).

**Open / next focus:**
- **Deploy decision:** rebuild+deploy `analytikul-app:coder` image to ship the Notes image feature
  (and the committed rebrand/sidebar UI) to prod, then verify E2E in browser. Not done unprompted.
- **Push** `feature/analytikul-coder` (5 commits ahead, unpushed).
- Pre-existing: `NoteEditor.tsx` has 170 pre-existing prettier errors (committed non-clean; my
  changes added 0) — separate cleanup if desired.
- **Higgsfield** — still ON HOLD (owner deferred; awaiting cost/data-egress/key decisions).
- FEATURES.md / HELP_CENTER.md / wiki entry for the Notes image feature — pending deploy.

---

## History (2026-06-13 and earlier)

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
