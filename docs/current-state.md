# Analytikul — Current State (as of 2026-06-12)

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

## IN PROGRESS — Open WebUI UI redesign (the active task)
User wants Notes + sidebar to look/work **exactly** like Open WebUI (screenshots provided).
Decision: faithful React rebuild (NOT switching to Open WebUI's Svelte frontend — that would
lose all Analytikul differentiators). Reference spec mined from open-webui repo.

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
The last SUCCESSFUL production deploy = commit `ade692f2a` (Notes button in old sidebar). The
container swap for that build completed (`container swapped, app: HTTP 200`). The Open WebUI
redesign is **dev-only, uncommitted**. Next deploy will ship it.

## Environment notes
- Dev: Windows, Docker Desktop (has restarted/crashed several times this session — when it dies,
  local Mongo/Meili port maps drop and the native backend fails with ECONNREFUSED 27017; fix:
  start Docker Desktop, `docker compose up -d`, restart `npm run backend`).
- Native backend needs `client/dist` built (`npm run build:client`) AND `npm run build:packages`
  after package changes.
- Production secrets in `~/analytikul/.env` on linuxg6 (chmod 600, separate from dev).
