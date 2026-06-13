# ADR-006: Service Topology & Infrastructure

**Status:** Accepted · **Date:** 2026-06-12

## Context
Analytikul's differentiators (analytics, memory, billing, gateways) plus the Python agent runtime
don't belong in the Express monolith. Need a service decomposition that keeps the LibreChat fork
mergeable and the runtime swappable.

## Decision
Sidecar microservices on the private Docker network, each owning one concern, fronted by the
Express backend (the only thing the browser talks to):
- **hermes-adapter** (Python/FastAPI :8001) — wraps the vendored Hermes `AIAgent`.
- **analytics-service** (Node :8011) — cost event consumer + FinOps API.
- **memory-service** (Node :8012) — pgvector org memory + local embeddings.
- **billing-service** (Node :8013) — BYOK vault + Stripe + entitlements.
- **gateway-service** (Python :8014) — Telegram + cron.
New backend logic lives in TypeScript `packages/api/src/analytikul/` consumed by a thin
`api/server/routes/analytikul.js`. New UI in `client/src/components/analytikul/`. Shared types in
`packages/analytikul-shared`.

## Alternatives Considered
- Everything in Express — rejected: Python runtime + heavy embedding/analytics work don't fit;
  would bloat upstream-tracked files.
- Serverless functions — rejected: stateful agent sessions and a long-lived Redis consumer need
  persistent processes.

## Consequences
+ Each concern independently deployable/restartable; Express stays thin and upstream-mergeable.
+ Internal services never publicly exposed (defense in depth).
− More containers to orchestrate; cross-service calls add latency (mitigated: all on one host).
− Each Node service `npm install`s at container start (acceptable for now; bake images later).
