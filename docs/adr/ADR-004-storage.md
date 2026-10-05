# ADR-004: Secrets & BYOK Key Storage

**Status:** Accepted · **Date:** 2026-06-12

## Context
Users bring provider API keys (BYOK). These must be stored securely, used per-request, and never
exposed back to the client or logs.

## Decision
**AES-256-GCM vault** in Postgres `billing.vault` (`services/billing-service/src/vault.js`).
Master key `ANALYTIKUL_VAULT_KEY` (32-byte hex) lives in env only. Keys are encrypted at rest;
decrypted per-request by an internal-only endpoint (`POST /vault/key`) the Express backend calls;
never cached, never logged, never returned to the client after creation (only a `…1234` last-4
hint is shown). Other secrets (JWT, CREDS_KEY/IV, Meili, Postgres pw, Stripe) are env-only,
regenerated for production by `scripts/gen-prod-env.sh`. PCI scope minimal: Stripe hosted
Checkout only, no card data touches our servers.

## Alternatives Considered
- Cloud KMS / Vault by HashiCorp — heavier than needed at this stage; env master key + AES-GCM
  is sufficient and self-contained.
- Storing keys in Mongo with app-level encryption — chose Postgres + GCM auth tag for integrity.

## Consequences
+ Keys safe at rest with authenticated encryption; clear blast-radius (one master key in env).
+ Swappable to KMS later behind the same vault interface.
− Master key in env means env compromise = vault compromise; rotate via re-encrypt if leaked.
