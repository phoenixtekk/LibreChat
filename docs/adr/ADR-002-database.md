# ADR-002: Database & Persistence

**Status:** Accepted · **Date:** 2026-06-12

## Context
Need stores for chat/app data, analytics rollups, vector memory, billing vault, gateway state.

## Decision
Reuse the two stores the LibreChat fork already runs, rather than adding new infrastructure:
- **MongoDB** for document data. New Mongoose models added via the standard registry
  (`packages/data-schemas/src/{schema,models}`): `agentTrace`, `organization`, `note`.
- **Postgres + pgvector** (the existing RAG `vectordb`) for everything relational/vector, split by
  schema: `analytics` (cost_events, daily_rollup, budgets), `org_memory` (RLS FORCE + HNSW),
  `billing` (vault), `gateway` (telegram_links, link_codes, cron_jobs).
- **Redis** for the `analytikul:cost_events` stream.
- **mongo:4.4 pinned in production** — linuxg6 CPU lacks AVX; mongo≥5 SIGILLs (exit 132).

## Alternatives Considered
- Separate dedicated DBs per service — rejected: operational overhead; the existing Postgres
  handles schemas cleanly with RLS for isolation.
- ClickHouse for analytics (LibreChat's new owner) — overkill at current scale; revisit if event
  volume explodes.

## Consequences
+ No new datastore to operate; tenant isolation enforced in-DB (Mongoose orgId + Postgres RLS).
+ Schema-per-concern keeps services decoupled while sharing one Postgres.
− mongo:4.4 is old (EOL); acceptable given the hardware constraint, revisit on hardware upgrade.
