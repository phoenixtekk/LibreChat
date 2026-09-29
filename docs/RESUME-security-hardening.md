# ▶ RESUME HERE — Security Hardening + Launch Readiness

**Paused:** 2026-06-14. Read this first to restart the effort. Detail lives in
`docs/open-issues.md` (§ "Security audit 2026-06-14" + "Round 2") and `FEATURES.md`
(§ "Security hardening"). This file is the ordered work order.

## State at pause
- **Branch:** `security/internal-svc-hardening` — working tree CLEAN, all work committed.
  - `eb84a5939` — agent RCE toolset floor (Node) + Polar webhook replay fix **(this one IS on prod)**
  - `aa377d2e7` — internal-service auth + 127.0.0.1 binding; billing/gateway/runtime hardening
  - `f7214cd26` — tenant isolation, hybrid billing cap, analytics/webhook hardening
- **CRITICAL GAP:** `main` is at `eb84a5939`. The two hardening commits are **NOT merged to main
  and NOT deployed to prod.** Production (g3) is still running the pre-hardening code + docker-cp
  hotfixes. So prod does NOT yet have: internal-svc token auth, tenant isolation, the hybrid
  billing cap, webhook idempotency, fail-closed budget, etc. They exist only in the branch.

## Resume steps (in order)
1. **Review + merge** `security/internal-svc-hardening` → `main` (read the two commits' diffs first).
2. **New prod env required** — regenerate with `scripts/gen-prod-env.sh` and add to g3
   `~/analytikul/.env` (back up .env first):
   - `INTERNAL_SERVICE_TOKEN` (32-byte hex) — **all services must share it or cross-calls 401.**
   - `CHECK_BALANCE=true`, `START_BALANCE` (free-tier grant), `PLAN_CREDIT_GRANT_PRO/TEAM`.
   - Confirm the billing service compose `environment:` block passes `INTERNAL_SERVICE_TOKEN`
     (and that the Node app + gateway + hermes-adapter all get it).
3. **Deploy the WHOLE stack** (not just the app) so every service picks up the token + new code.
   ⚠️ **Deploy-fragility (see memory `deploy-fragility-warning`):** the app's dist + api are baked
   into the image and `docker cp` hotfixes get wiped by `--force-recreate`. The DURABLE fix is to
   **rebuild the app image from current source** (sync g3 `~/analytikul` working tree to the merged
   HEAD first — `git push` only updates the bare repo, not the checkout). Do the image rebuild here.
4. **Run the tenant backfill once on prod:**
   `MONGO_URI=… node scripts/analytikul-backfill-tenant.mjs` (re-keys `'default'` notes/traces to
   owners). Re-key Postgres org-memory/analytics `orgId='default'` rows too if any shared data.
5. **Verify:** internal services 401 without the token; webhook still flips an org to paid; free-tier
   chat is capped (CHECK_BALANCE); app + landing + marketing pages + chat all healthy.
6. **Credentials hygiene:** change the weak prod admin password (`lacy@analytikul.ai`); rotate the
   Polar token + Gemini key that were pasted in chat.

## STILL NOT DONE after the branch deploys (the remaining audit + feature-complete list)
Priority order for the next pass:
1. **gVisor sandboxing** of the agent runtime (`TERMINAL_ENV=docker` + runsc + container hardening)
   — required to SAFELY re-enable terminal/code_execution (currently floored). Until then, agent
   code-exec isolation = container boundary only (OK for trusted users, not untrusted signups).
2. **CORS allowlist** (replace wildcard `cors()` at `api/server/index.js`) + **security headers**
   (helmet: CSP/HSTS/XFO/nosniff). *(Webhook forwarders are already rate-limited.)*
3. **`npm audit`** — CRITICAL `protobufjs` (RCE) + high `grpc-js`/`onnxruntime` at root; add
   `overrides` or bump. (billing-service deps clean.)
4. **Per-route rate limiting** on `/api/analytikul` (`/agent/run`, `/notes/ai`) beyond the webhook
   limiter.
5. **Finish billing self-serve:** your Polar KYC (identity/payout/review); wire pricing-page
   buttons → checkout; 100%-discount-code end-to-end test.
6. **Feature-complete (non-security):** pre-select Gemini Flash default (librechat.yaml modelSpec);
   Ollama llama3 in picker (#20) + GPU fix (#21); Files tab (rail stub); `ADMIN_DOCS.md` runbook;
   automated DB backups + basic monitoring; SES production access (currently sandbox).

## One-line restart prompt
> "Resume the security-hardening effort: review/merge branch `security/internal-svc-hardening`,
> deploy the whole stack to g3 via an image rebuild with the new `INTERNAL_SERVICE_TOKEN` +
> CHECK_BALANCE env, run the tenant backfill, verify, then continue with gVisor sandboxing, CORS +
> headers, and npm audit. See docs/RESUME-security-hardening.md."
