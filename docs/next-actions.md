# Analytikul — Next Actions (prioritized)

## P0 — Finish the Open WebUI UI redesign (the active, interrupted task)
1. Ensure dev stack is up: Docker Desktop running → `docker compose up -d` → `npm run backend`
   (needs `client/dist`; run `npm run build:client` if missing) → `npm run frontend:dev` (:3090).
2. Verify Notes end-to-end in browser at :3090:
   - Sidebar: logo / New chat / Search / Notes / Workspace / Chats / account footer; collapse toggle.
   - Notes list: create note, time-grouped rows, search, pin, download .md, delete, List/Grid.
   - Editor (`/notes/:id`): WYSIWYG typing (`##`→heading inline), bubble toolbar on selection,
     undo/redo, word/char meta, autosave, AI Enhance/Summarize/Continue (cost shows in Costs tab).
3. Visual side-by-side against the two screenshots the user provided (notes list + open note).
   Match spacing/rounded/hover. Reference spec is in this session's exploration (and
   docs/adr/ADR-009).
4. Clean up now-unused old sidebar files if confirmed dead: `client/src/components/UnifiedSidebar/*`
   and the Notes link in `useUnifiedSidebarLinks.ts` (verify nothing else imports them first).
5. Lint (`npx eslint client/src/components/analytikul/**`), commit, `git push linuxg6 main`,
   run `scripts/deploy.sh` on linuxg6 (image build is SLOW — 20-40 min; watch container swap).
6. Verify on https://analytikul.ai and tell the user.

## P1 — Activate dormant production features (user has asked; needs their inputs)
- **Stripe (TEST mode first, per user's latest choice)**: user provides `sk_test_…`, two
  `price_…` (Pro/Team), `whsec_…` from a webhook to `https://analytikul.ai/api/analytikul/
  webhooks/stripe`. Set in `~/analytikul/.env`, `docker compose -f docker-compose.prod.yml up -d
  billing-service app`. Verify billing health `"stripe": true`.
- **Telegram**: user provides `TELEGRAM_BOT_TOKEN` from @BotFather → `.env` → restart
  gateway-service → link via `POST /api/analytikul/telegram/link-code` then `/link <code>`.
- **SES email**: domain `analytikul.ai` must be verified in AWS SES us-east-1 (3 DKIM CNAMEs in
  Cloudflare, gray cloud). SMTP creds already in prod `.env`; forgot-password works once verified.
  If SES still in sandbox, request production access before external signups.

## P2 — Housekeeping / hardening
- Change the test prod account password: `lacy@analytikul.ai` / `ChangeMe!Prod2026`
  (`ssh -t linuxg6 'docker exec -it analytikul-app npm run reset-password'`).
- Delete unused empty GitHub repo `phoenixtekk/Analytikul-One` (token lacks delete scope; user does it).
- Consider PR follow-up on tsdown fix #13700.

## P3 — Deferred features (future milestones)
- Notes phase 2: audio recording + Whisper transcription, real-time collaborative editing
  (Y.js), public share links/grants, folders/tags.
- Browser toolset enablement in adapter (Playwright Chromium installed but toolset gated off).
- Skill versioning/rollback UI. Admin panel (org/team/budget management UI). gVisor sandbox on prod.
- Remaining 15 messaging gateways (Slack/Discord/WhatsApp/… — same pattern as Telegram).
- OpenTelemetry + Grafana; Playwright E2E in CI; weekly upstream-diff CI.
