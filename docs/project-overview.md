# Analytikul — Project Overview

**Live at: https://analytikul.ai** (production since 2026-06-12; **migrated to host linuxg3 on
2026-06-14** — was linuxg6; see current-state.md / ADR-005)

## What it is
Analytikul is an **analytics-native AI workspace SaaS** — a fork of LibreChat (MIT) with the
Hermes Agent runtime (MIT, Nous Research) embedded as its agent engine, restyled with Hermes
Desktop's look and feel, and extended with differentiators no competitor ships natively.

Owner: Lacy (lacy@intuneexperts.com / GitHub `phoenixtekk`). Dev machine: Windows 11 at
`G:\VisualStudioCode\Analytikul-One`. Production: linuxg6 via Cloudflare tunnel.

## Positioning (from planning research, 2026-06)
"FinOps + observability for AI teams — multi-provider chat is the interface; analytics is the
product." Competitive white space identified: cross-provider cost attribution, team/org memory,
agent observability, managed gateways. ChatGPT Teams / Claude Teams / LibreChat / Open WebUI all
lack these natively.

## The four v1 differentiators (ALL shipped)
1. **Analytics/FinOps core** — every LLM call metered (cost/tokens/model/user/conversation),
   Redis Streams → Postgres rollups, 6-panel Costs dashboard, hard/soft budgets with HTTP 402
   enforcement, hot-reloadable price table.
2. **Organizational memory** — pgvector store under Postgres RLS, local embeddings (no API key),
   lineage on every fact, top-5 relevant memories injected into every agent run,
   `save_to_org_memory` agent tool. Verified cross-user: a fact saved by user A is recalled by
   user B's agent.
3. **Agent observability** — typed event stream (`text_chunk`/`tool_start`/`tool_complete`/
   `cost_event`/…), live TraceViewer with per-call costs, traces persisted to Mongo per
   conversation.
4. **Managed gateways + scheduling** — Telegram bot gateway (link codes → per-user agent
   sessions), APScheduler cron jobs firing real agent runs. No VPS setup required (vs Hermes).

## Additional shipped capabilities
- **Hermes Desktop look**: 8 paired skins × 6 accents (CSS-variable ramp re-tints), command
  palette (Ctrl+K), composer history, Preview Rail (Agent/Preview/Costs/Memory/Keys/Files tabs).
- **Notes workspace** (Open WebUI parity): markdown notes, AI Enhance/Summarize/Continue
  (metered through the agent engine), agent tools `search_notes`/`view_note`/`write_note`,
  pins/search/export/org-share. UI redesign to exact Open WebUI look is IN PROGRESS (see
  current-state.md).
- **BYOK vault**: AES-256-GCM encrypted provider keys; agent runs prefer the user's key.
- **Billing**: Stripe (one isolated module per BILLING.md), subscription + credits checkout,
  webhook → internal events → own entitlement store. Dormant until Stripe keys are set.

## Business model (decided)
Hybrid BYOK SaaS: Free/Pro/Team subscription tiers with users bringing their own provider keys
(high margin), plus an optional managed-credits wallet with markup. Stripe direct (low-risk B2B
SaaS); see BILLING.md at repo root for processor isolation rules.

## Hard rules (standing decisions — do not violate)
- **Never edit vendored Hermes runtime** (`services/hermes-runtime/`, pinned `484f484`); the
  adapter wraps its public API only.
- **Minimize upstream LibreChat edits** — new code in new files (`client/src/components/
  analytikul/`, `packages/api/src/analytikul/`, `api/server/routes/analytikul.js`); upstream
  remote retained for merges.
- **No hardcoded colors** in Analytikul components (custom ESLint rule enforces; theme CSS files
  are the only place hex is allowed).
- **Site serves on the APEX only** — `https://analytikul.ai`, www 301-redirects to apex.
- **Lacy manages all Cloudflare changes in the web console** — never edit DNS/tunnel config;
  hand them exact records instead.
- **Payments**: all Stripe calls in `services/billing-service/src/stripe.js` only.
