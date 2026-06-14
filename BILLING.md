# Analytikul — Billing & Payment Infrastructure

## Model
Hybrid BYOK SaaS (decided at planning, 2026-06-11):
- **Free / Pro / Team subscription tiers** — users bring their own provider API keys (BYOK).
  Platform fee covers the workspace, analytics, memory, gateways. High margin, zero inference COGS.
- **Optional managed credits wallet** — for users without keys: prepaid credits with a markup,
  drawn down per metered LLM call (the M3 analytics pipeline is the meter).

## Processor
**Polar** (Merchant of Record), active as of 2026-06-14 (`BILLING_PROVIDER=polar`). Polar is the
legal seller of record and absorbs chargeback, fraud, and sales-tax/VAT liability (~4%+40¢ vs
Stripe's ~2.9% — accepted as de-risking for a new AI SaaS). The Stripe module is retained behind
the same interface as a fallback/redundancy (`BILLING_PROVIDER=stripe`).

**Polar org**: Analytikul (`f87f8df7-edaf-4823-b279-152333560fdf`). **Products** (env on g3):
Pro Monthly `8c07831f…` / Annual `bc07a009…`, Team Monthly `62e2c177…` / Annual `7f49e04f…`.
**Webhook**: `https://analytikul.ai/api/analytikul/webhooks/polar` (endpoint `d5c73e23…`, secret in
`POLAR_WEBHOOK_SECRET`). Checkout path verified live 2026-06-14 (returns a real polar.sh checkout
URL). **Pending**: Lacy's KYC in Polar (identity, payout account, submit for review) before real
payouts; pricing-page checkout-button wiring + a 100%-discount-code end-to-end purchase test.

## Lock-in containment
- **Each processor lives in ONE module**: `services/billing-service/src/polar.js` (active) and
  `stripe.js` (fallback). Nothing else imports a processor SDK or touches its payload shapes.
  `BILLING_PROVIDER` selects which one handles checkout + webhooks.
- Entitlements use **processor-agnostic** fields (`billingCustomerId`, `billingSubscriptionId`);
  both modules emit the same internal events, so swapping processors touches one module only.
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
