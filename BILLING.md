# Analytikul — Billing & Payment Infrastructure

## Model
Hybrid BYOK SaaS (decided at planning, 2026-06-11):
- **Free / Pro / Team subscription tiers** — users bring their own provider API keys (BYOK).
  Platform fee covers the workspace, analytics, memory, gateways. High margin, zero inference COGS.
- **Optional managed credits wallet** — for users without keys: prepaid credits with a markup,
  drawn down per metered LLM call (the M3 analytics pipeline is the meter).

## Processor
**Stripe — the only processor** (owner-directed, 2026-06-28→30). Polar was fully removed: `polar.js`,
the `/webhooks/polar` route + app forwarder, and all `POLAR_*` / `BILLING_PROVIDER` config are gone.
The processor-abstraction is retained (single module `stripe.js`, processor-agnostic entitlements) so
a backup processor could be re-added later by adding one module — but none is configured today.

> ⚠️ **Risk note (owner-acknowledged):** on Stripe (a direct processor, not a Merchant of Record)
> Analytikul is the merchant of record — it takes on chargeback/fraud liability, automated
> **account-freeze risk**, and **global sales-tax/VAT** registration + remittance itself. Removing
> Polar also removes the **fallback-processor redundancy** the payment rule recommends. Recorded per
> the standing rule. Mitigate: clear statement descriptor, support contact at checkout, prompt refunds,
> and warn Stripe before launch volume spikes.

**To activate (owner's step — keys/products are not in repo):** create in the Stripe dashboard the
Pro, Team, and **Agent Power Tools ($99/mo)** recurring Prices; create a webhook to
`https://analytikul.ai/api/analytikul/webhooks/stripe` (events `checkout.session.completed`,
`customer.subscription.deleted`, `invoice.payment_failed`); then set on g3 `~/analytikul/.env`:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`,
`STRIPE_PRICE_POWERTOOLS`, and (for the monthly/annual toggle) `STRIPE_PRICE_PRO_YEAR` +
`STRIPE_PRICE_TEAM_YEAR`, then recreate `billing-service`. Checkout takes `plan` + `interval`
(`month`|`year`); annual falls back to the monthly Price if the `_YEAR` var is unset. Until then billing logs `stripe: false`
and checkout is dormant (entitlement reads still work). The add-on rides the subscription checkout via
`plan=powertools` → `addon_started` → `org.addons.powerTools`.

## Lock-in containment
- **The processor lives in ONE module**: `services/billing-service/src/stripe.js`. Nothing else imports
  the Stripe SDK or touches its payload shapes. To add a backup processor later, add one sibling module
  emitting the same internal events — no app-layer changes.
- Entitlements use **processor-agnostic** fields (`billingCustomerId`, `billingSubscriptionId`);
  the module emits internal events, so swapping/adding a processor touches one module only.
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
