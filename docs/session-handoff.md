<!-- session-version: 2 -->
<!-- pending-session-title: Analytikul-One v2 -->

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

**Git:** branch `feature/analytikul-coder`, HEAD `cc5ca8101`. Tree is **DIRTY** from prior sessions
(landing/features/pricing/index html, AnalytikulSidebar, AgentPanel, aibox-voice, coder-bridge,
coder-desktop; new chatai.html, Analytikul/DesktopApp images, voice enroll/deskbridge files) —
uncommitted. **This session's work was server-side, NOT in git** (below).

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

**Open / next focus:**
- **Notes image paste/import (ON HOLD).** Owner asked to paste/import screenshots into Notes.
  Mapped it: TipTap editor `client/src/components/analytikul/notes/NoteEditor.tsx` has no image
  extension; needs `@tiptap/extension-image` + drop/paste handlers + an upload endpoint
  (`api/server/routes/analytikul.js`, save via LibreChat file strategy → `/images/...`). Markdown
  round-trip (turndown/marked) already handles `![](url)`. Owner **dismissed** the scope/storage
  question — resume once they pick scope (Notes editor) + storage (server-upload vs base64).
- Decisions pending: make `wan5b` the default video model? build Higgsfield? commit the dirty tree?

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
