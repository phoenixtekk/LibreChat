# Analytikul — Current State (as of 2026-06-13)

## Milestones: M0–M4 COMPLETE and live in production
| Milestone | Status | Verified |
|---|---|---|
| M0 Fork & scaffold | ✅ | stack boots, /health 200 |
| M1 Rebrand + Hermes theming | ✅ | 8 skins, palette, Preview Rail, logo/favicons |
| M2 Agent engine + observability | ✅ | live agent run, trace, cost counter, cancel |
| M3 Analytics + org memory | ✅ | per-model attribution, $0.001 budget→402, cross-user memory recall |
| M4 Billing + gateways + deploy | ✅ | analytikul.ai live, BYOK vault, Telegram, cron fired, prod E2E |

Production verified 2026-06-12: registered + logged in + ran agent (41×73=2993) through
https://analytikul.ai with cost metering. All 5 internal services healthy.

## DONE & DEPLOYED — Open WebUI UI redesign (2026-06-13)
Notes + sidebar rebuilt to match Open WebUI (faithful React rebuild, NOT Svelte — ADR-009).
**Committed `8fb5d3456`, deployed to prod (image `9a62c2c4ead7`), analytikul.ai 200.**
Reference spec mined from the actual open-webui source (Notes.svelte / NoteEditor.svelte):
- List: search restyle + controls row with viewOption (All / Created by you / Shared with you),
  conditional permission (Write / Read Only), and display (List / Grid) dropdowns — OWUI classes,
  Analytikul theme tokens. Pin = inline icon, no separate Pinned section (OWUI parity). Titles
  keep `capitalize` (OWUI parity).
- Editor: removed back-chevron, trimmed meta to `<date> · N words M characters` (no save text),
  "Title" placeholder, `px-3.5`. Kept AI Enhance/Summarize/Continue + Share-with-org (differentiators).
- Verified end-to-end in browser (create/editor/autosave/persist/search/grid/pin/dropdowns).
- Dead `UnifiedSidebar` subtree removed (kept shared `ConversationsSection`).
- **Remaining: user's visual pixel sign-off** vs `chat.analytikul.ai` (preview screenshot tool
  times out on this SPA; user compares directly).

### Earlier (pre-2026-06-13) — this section was the in-progress redesign, now superseded

**Built this session (committed? NO — uncommitted on dev machine):**
- `client/src/components/analytikul/notes/NotesList.tsx` — Open WebUI list: "Notes <count>",
  pill search, +New Note, time-grouped rows (Today/Yesterday/Previous 7/30 days/month/year),
  ⋯ menu (pin/download .md/delete), List/Grid toggle. ✅ renders.
- `client/src/components/analytikul/notes/NoteEditor.tsx` — TipTap v3 WYSIWYG (StarterKit,
  TaskList, Link, Placeholder, tiptap-markdown), bubble toolbar, undo/redo, word/char meta line,
  600ms autosave, AI Enhance/Summarize/Continue. Route `/notes/:noteId`.
- `client/src/components/analytikul/notes/time.ts` — Open WebUI time bucketing.
- `client/src/components/analytikul/sidebar/AnalytikulSidebar.tsx` — single collapsible Open
  WebUI sidebar (logo, New chat, Search, Notes, Workspace, Chats, account footer). ✅ renders,
  swapped into `client/src/routes/Root.tsx` (replaced `UnifiedSidebar`).
- Old `notes/NotesPage.tsx` DELETED; routes split into list + editor in `routes/index.tsx`.
- TipTap deps installed; three TipTap-v3 API fixes applied.

**NOT yet done on the redesign:**
- End-to-end data-flow verification (was blocked repeatedly by Docker Desktop restarting on the
  dev machine, killing local Mongo). Sidebar + list shells verified rendering; notes data flow
  and editor not yet confirmed in-browser this session.
- Visual side-by-side against the provided screenshots.
- **Not committed, not deployed.** Production still runs the previous Notes UI (the simpler
  NotesPage, two-part sidebar) — which is why the user "doesn't see" the new look yet.
- `useUnifiedSidebarLinks.ts` still has the older Notes nav-link addition; the new sidebar
  supersedes the old `UnifiedSidebar` but the old files remain in the tree (unused now).

## Production vs dev divergence (IMPORTANT)
In sync: prod runs commit `8fb5d3456` (image `9a62c2c4ead7`), the Open WebUI redesign. Local HEAD
== prod HEAD. The deploy was painful: linuxg6 was resource-overcommitted at the time (2 Minecraft
servers cobblemon/cobbleverse + Elasticsearch/temporal + shopware + 2 LibreChat stacks + the
build), so buildkit's image export hung on I/O contention twice. Shedding load (decommissioning
the services below) dropped I/O enough for the export + container swap to complete. NOT a hardware
fault (dmesg clean, no OOM/disk errors; the one reboot 18:16 was a clean shutdown).

## Decommissioned on linuxg6 this session (per owner) — frees host resources
Removed (containers + volumes + dirs): **postiz/temporal stack** (temporal, temporal-elasticsearch,
temporal-postgresql, postiz, postiz-postgres, postiz-redis) and **shopware_market**
(`market.phoenixtekk.com`, incl. 836M MariaDB data); **mission-control.service**
(mission.analytikul.ai) and **review-dashboard/review-watcher** (review.analytikul.ai) — units +
app dirs. **Left alone (owner): `memory.analytikul.ai`** (memory-dashboard stopped+disabled, data
dir `/home/lacy/.openclaw/workspace/memory` preserved) and **`globalsettings.analytikul.ai`**
(:9092, untouched). Tunnel ingress entries for the removed hosts remain in `/etc/cloudflared/
config.yml` — owner removes via Cloudflare console.

## Environment notes
- Dev: Windows, Docker Desktop (has restarted/crashed several times this session — when it dies,
  local Mongo/Meili port maps drop and the native backend fails with ECONNREFUSED 27017; fix:
  start Docker Desktop, `docker compose up -d`, restart `npm run backend`).
- Native backend needs `client/dist` built (`npm run build:client`) AND `npm run build:packages`
  after package changes.
- Production secrets in `~/analytikul/.env` on linuxg6 (chmod 600, separate from dev).
