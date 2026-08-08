# Analytikul — Future Session Startup Prompt

Paste/follow this at the start of any new Claude Code session on this project.

## Bootstrap sequence (do this BEFORE writing any code)
1. **Read all of `/docs`** in this order: `project-overview.md`, `architecture.md`,
   `current-state.md`, `open-issues.md`, `next-actions.md`, `changelog.md`.
2. **Read all ADRs** in `/docs/adr/` (ADR-001 … ADR-009). These are binding decisions.
3. **Read `/docs/session-handoff.md`** for the latest state and the active task.
4. **Read the existing house docs**: `FEATURES.md`, `ADMIN_DOCS.md`, `HELP_CENTER.md`, `BILLING.md`,
   and `services/hermes-runtime/ANALYTIKUL_PIN.md`.
5. **Check the auto-memory** at the project memory dir (MEMORY.md + linked files) — it records
   locked product decisions, GitHub tooling, the deploy model, and the "ask-don't-assume" rule.

## Reconstruct & validate (do this next)
6. **Summarize your understanding** of: what Analytikul is, the four differentiators, the
   fork/vendor rules, the deploy model, and what the active in-progress task is.
7. **Validate against code** — confirm the docs match reality before trusting them:
   - `git log --oneline -12` and `git status` (is the Open WebUI redesign committed yet?).
   - `ls client/src/components/analytikul/{notes,sidebar}/` — confirm the new components exist.
   - Verify production is alive: `curl -I https://analytikul.ai` (expect 200) and
     `ssh linuxg3 'docker ps --format "{{.Names}}\t{{.Status}}" | grep analytikul-'`.
     (**Production host is linuxg3 since 2026-06-14** — migrated off linuxg6.)
   - Confirm which commit prod runs vs `git log` HEAD (dev may be ahead/uncommitted).
8. **Only then begin development**, starting from `next-actions.md` P0 unless the user redirects.

## Hard rules (never violate — from the ADRs and memory)
- Never edit vendored `services/hermes-runtime/` (pinned `484f484`); wrap via the adapter only.
- Minimize upstream LibreChat edits — put new code in `*/analytikul/*` and new files.
- No hardcoded colors in Analytikul client components (ESLint enforces).
- Site serves on the APEX only (https://analytikul.ai); www→apex redirect.
- The user manages ALL Cloudflare changes in the web console — surface exact records, never edit
  DNS/tunnel config. Do not create/push new GitHub repos without explicit naming (use SSH push to
  linuxg6: `git push linuxg6 main`).
- All Stripe calls stay in `services/billing-service/src/stripe.js`.
- When the user states they "have" something (a key, an account), ASK how they want to hand it
  off — don't assume the workflow.

## Dev environment quickstart
- Start Docker Desktop (Windows dev box), then `docker compose up -d` (uses COMPOSE_FILE overlay
  in `.env`). If the backend fails with ECONNREFUSED 27017, Docker dropped Mongo's port map —
  restart the stack.
- Build packages after TS changes: `npm run build:packages`; build client: `npm run build:client`.
- Run backend natively: `npm run backend` (needs `client/dist`). Frontend dev: `npm run frontend:dev`
  (:3090, proxies to :3080). Use the preview_* tools to verify UI.
- Provider key + secrets are in `.env` (gitignored). Anthropic base URL has NO `/v1`.

## Deploy (production host = linuxg3)
`git push linuxg3 main` → `ssh linuxg3 'cd ~/analytikul && git pull --ff-only && APP_DIR=$HOME/analytikul bash scripts/deploy.sh'`.
Full image builds are SLOW on g3 too (Docker data-root on the slow `/data` disk; `npm prune`
30-45 min) — see architecture.md. **For client-only changes, prefer the hotfix path** (build
client locally → scp `client/dist` → `docker cp` into `analytikul-app:/app/client/dist` →
`docker restart analytikul-app`); avoids the full rebuild. Get user approval before any Docker
daemon restart (bounces other sites on the shared host).
