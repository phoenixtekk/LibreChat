# Analytikul — Billing & Payment Infrastructure

## Model
Hybrid BYOK SaaS (decided at planning, 2026-06-11):
- **Free / Pro / Team subscription tiers** — users bring their own provider API keys (BYOK).
  Platform fee covers the workspace, analytics, memory, gateways. High margin, zero inference COGS.
- **Optional managed credits wallet** — for users without keys: prepaid credits with a markup,
  drawn down per metered LLM call (the M3 analytics pipeline is the meter).

## Processor
**Stripe**, direct (not a Merchant of Record). Rationale per the standing payment rules:
B2B SaaS subscriptions + prepaid credits are low-risk (low chargeback exposure, no regulated
category), so a direct processor is appropriate. Revisit toward an MoR (Paddle/Polar) only if
chargeback rate or category risk changes.

## Lock-in containment
- **All Stripe calls live in ONE module**: `services/billing-service/src/stripe.js`.
  Nothing else imports the Stripe SDK or touches Stripe payload shapes.
- Webhooks are normalized into internal events (`checkout_completed`, `subscription_updated`,
  `payment_failed`) before any app logic sees them — `services/billing-service/src/events.js`.
- Entitlements (plan, seats, credits) are stored on our own `Organization` Mongo collection,
  never read live from Stripe. Swapping processors = reimplementing one module + replaying
  entitlements; no app-layer changes.
- **No Clerk Billing or similar processor-coupled entitlement layers are used.**

## Keys & secrets
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — env only, never committed (.env is gitignored).
- **BYOK vault**: customer provider keys are AES-256-GCM encrypted at rest in Postgres
  (`billing.vault`), master key `ANALYTIKUL_VAULT_KEY` in env only. Keys are decrypted
  per-request by the internal vault endpoint, never cached, never logged, never sent to the
  client after creation (masked display only).
- PCI scope: Stripe Checkout (hosted) only. No card data ever touches our servers or logs.

## Migration path (if ever needed)
1. Entitlements already live in our DB — no Stripe dependency for runtime authorization.
2. Stand up the new processor implementation of `stripe.js`'s interface (`createCheckout`,
   `handleWebhook`, `cancelSubscription`).
3. Stored cards cannot be exported freely (PCI) — coordinate a Stripe→processor transfer;
   expect involuntary churn from re-authorization. Migrate lowest-risk cohort first.

## Operational notes
- Keep payouts frequent once live; warn Stripe before launch-day volume spikes.
- Refund promptly and keep a support contact at checkout to hold chargebacks down.
