# ADR-001: Authentication

**Status:** Accepted · **Date:** 2026-06-12

## Context
Analytikul is multi-tenant SaaS; users need accounts, sessions, and the platform needs to gate
all Analytikul routes (agent runs, notes, vault, analytics).

## Decision
Reuse LibreChat's built-in JWT auth unchanged. All Analytikul Express routes mount under
`requireJwtAuth` (`api/server/routes/analytikul.js`). The Stripe webhook is the sole exception —
it authenticates via Stripe signature (not JWT) and is mounted before the JSON body parser to
preserve the raw body. SSE streams pass the JWT as a Bearer header via `sse.js`.
Password reset uses LibreChat's flow over SES SMTP (see ADR-007). 2FA/OAuth/LDAP available from
upstream but not specifically configured.

## Alternatives Considered
- Clerk/Auth0 — rejected: adds a dependency and (Clerk) couples billing to Stripe; upstream JWT
  already works and keeps us aligned with LibreChat.
- Custom auth — unnecessary; upstream is solid.

## Consequences
+ Zero new auth code; stays mergeable with upstream.
+ `req.user.id` / `req.user.tenantId` available everywhere for scoping.
− Org/tenant model is thin today (tenantId defaults to 'default'); full org membership mapping is
  future work (ADR-008 / admin panel).
