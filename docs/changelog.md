# Analytikul — Changelog

Commits are on `main`, based on LibreChat upstream. Newest first.
Deploy target: `git push linuxg6 main` → `scripts/deploy.sh` on linuxg6.

## Ops (no code) — 2026-06-14
- **Production migrated linuxg6 → linuxg3** (lift-and-shift: rebuild images on g3, dump/restore
  Mongo+Postgres with verified parity, Cloudflare cutover, g6 analytikul stack decommissioned).
  Deploy remote is now `git push linuxg3 main`; g3 tunnel `97dd7bda-…` (dashboard-managed).
- Live client hotfixes on prod (paste-as-rich-text + tight list spacing) via `docker cp` dist
  (commits `ffadb6b9f`, `100374393`) — baked into g3's image at build.

## Committed
- `bee0cb6bd` feat(hermes): toolset selector + model/provider picker in PreviewRail agent tab
  (26 toolsets, All/None, provider/model). run()→route→service→adapter forwards
  enabled_toolsets/disabled_toolsets/model/provider. Deploy: client dist + Node route file.
- `2b0a9dbcc` fix(search): on-page autofocused search input on /search (Meili confirmed live)
- `3d33e64dd` fix(models): restore full Agent Builder in Model drawer via ChatContext stub
- `cc3113fe9` feat(ui): OWUI-style Workspace Models page (`/workspace/models`) — grid of
  user agents as model cards (Edit/Duplicate/Delete), New Model, reuses Agent Builder via
  ModelBuilderDrawer (error-boundary fallback to /agents)
- `a54818b28` feat(ui): full OWUI-fidelity Controls panel (Valves/System Prompt/Advanced
  Params with complete param list + Add Custom Parameter)
- `e04f3973c` feat(ui): per-chat Controls drawer + Org Memory/Keys sidebar entries
- `586a8ed7c` fix(ui): dark-mode contrast (placeholder/cardStyle tokens) + Search spinner guard
- `7a43cb6de` / `59a1ba6f5` / `43ab7b325` style(landing): Agartha + hero-logo sizing/position passes

- `100374393` fix(notes): tight list spacing (OWUI parity) — scoped .atk-note-prose CSS
- `ffadb6b9f` fix(notes): paste markdown as rich text (handlePaste via marked)
- `c1b8e69ce` fix(notes): match Open WebUI text formatting (marked + no-escape Turndown) + toolbar
- `8fb5d3456` feat: Open WebUI parity for Notes + sidebar (faithful React rebuild) —
  **DEPLOYED to prod 2026-06-13** (image `9a62c2c4ead7`). OWUI-source-faithful list controls
  (viewOption/permission/display dropdowns), search restyle, editor trims (no back-chevron,
  no save text, `px-3.5`); kept AI actions + Share-with-org. Removed dead `UnifiedSidebar`
  subtree (`UnifiedSidebar.tsx`/`Sidebar.tsx`/`ExpandedPanel.tsx` + test) and
  `useUnifiedSidebarLinks.ts`; kept shared `ConversationsSection`.
- `ade692f2a` feat: Notes button in sidebar nav (discoverability) — prior prod deploy
- `880cf482c` feat: Notes workspace (Open WebUI parity) — editor, AI actions, agent tools
- `f98eef6dc` feat: public Stripe webhook forwarder (raw body) + Telegram link-code route
- `9d12b1d7d` docs: M4 verification record + production runbook (analytikul.ai live)
- `d90f055af` fix: mongo:4.4 for linuxg6 (no AVX; mongo>=5 SIGILLs)
- `d060eb948` fix: host-network builds for linuxg6 (default-bridge DNS broken at build time)
- `1a5bc8bf3` chore: add production env generator
- `e8678c8e3` chore: ignore __pycache__
- `100e9a19a` feat: M4 — billing (Stripe + BYOK vault), org schema, Telegram gateway, cron, prod artifacts
- `7776457be` chore: exclude vendored hermes-runtime from lint-staged/eslint; document drift
- `34a571e31` feat: Analytikul M0-M3 — fork scaffold, Hermes theming, agent engine, FinOps + org memory

## Upstream contribution
- danny-avila/LibreChat#13700 — tsdown Windows `neverBundle` fix (branch
  `fix/tsdown-windows-neverbundle`, worktree `G:\VisualStudioCode\analytikul-pr-tsdown`).
