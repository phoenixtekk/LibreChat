# Analytikul — Changelog

Commits are on `main`, based on LibreChat upstream. Newest first.
Deploy target: `git push linuxg6 main` → `scripts/deploy.sh` on linuxg6.

## Uncommitted (dev, in progress) — 2026-06-12
- Open WebUI UI redesign: `notes/NotesList.tsx`, `notes/NoteEditor.tsx` (TipTap v3),
  `notes/time.ts`, `sidebar/AnalytikulSidebar.tsx`; `Root.tsx` sidebar swap; routes split;
  old `notes/NotesPage.tsx` removed. NOT committed/deployed yet.

## Committed
- `ade692f2a` feat: Notes button in sidebar nav (discoverability) — **last deployed to prod**
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
