# ADR-010: Long-Term Memory Architecture (4-Layer + Daily Logs)

**Status:** Accepted · **Date:** 2026-06-26

Full design + DDL + pipeline + review resolutions: **`docs/memory-architecture.md`**. This ADR records
the binding decisions; the design doc is the working spec.

## Context
The owner wants no cross-session context lost: capture each user's goals/efforts/outcomes continuously,
surface a reviewable per-user **Daily Log** in-app, and inject relevant memory into future sessions —
modeled on a Hermes-style 4-layer memory system (Working/Episodic/Semantic/Procedural). Two memory
systems already exist (LibreChat built-in per-user key/value memories in MongoDB; the Analytikul org
memory-service in Postgres+pgvector with RLS). A pre-code adversarial review (Backend Architect) found
7 blockers that shaped the final design.

## Decision
Build the memory engine by **extending the `services/memory-service` microservice** (it owns pgvector +
the `@huggingface/transformers` embedder + RLS), adding **per-user-private** layers; schedule background
work from **`gateway-service` (APScheduler)**; keep `/api` to a thin proxy + a non-blocking activity
hook; extend the existing injection points (adapter `build_memory_block`, `useMemory()`) for retrieval.

Locked decisions:
- **Per-user private** logs (new `app.user_id` RLS GUC + `withUser`, alongside the existing org RLS).
- **Capture = a dirty-queue observer** draining every **15 minutes**, incrementally inferring "what the
  user is trying to do" from each conversation's new messages (NOT idle/session-end). Episodes finalize
  after ~30 min quiet; a reply reopens (no duplicates).
- **Extraction on the local vLLM Qwen 2.5** endpoint (zero marginal cost), **Claude Haiku 4.5** fallback
  (capped + metered + alerted; default is skip-and-lag when vLLM is down).
- **Daily logs are read-only** (system-authored).
- **90-day decay** for unused low-value episodes (`>0.8` importance never decays).
- **Bounded backfill** from a sample of recent conversations to seed logs.
- **Phased build** (0: per-user foundation → 1: Daily Logs → 2: semantic → 3: procedural → 4: graph/decay).

Review-driven design rules (binding): **two DB roles** (`memory_admin` owner / least-privilege
`memory_rt` runtime, non-`BYPASSRLS`); **cursor on the non-RLS `observer_queue`**, not the episode;
**only finalized episodes are HNSW-indexed**; **memory is injected as untrusted data, never as
instructions** and procedural memory is **typed + allow-listed**; **memory may lag but never blocks
chat**; the `vllm_default` attachment is declared **in compose** (survives `force-recreate`).

## Alternatives Considered
- **New backend in `packages/api` (TS)** — REJECTED: the memory engine is a polyglot, independently
  scaled, pgvector-owning microservice; coupling it to the Express request lifecycle breaks the service
  boundary and the CLAUDE.md TS rule governs the app server, not the standalone services.
- **A brand-new dedicated memory microservice** — REJECTED for now: extra network hop to the vector
  store + duplicated RLS for no current benefit; revisit only if extraction compute outgrows the service.
- **Idle/session-end capture trigger** — REJECTED by owner in favor of the fixed 15-min observer (steady
  intent learning vs one-shot end-of-session guess); the **timer-scan** form was further rejected by
  review in favor of the **dirty-queue worker** (concurrency-safe, no dead-conversation scans).
- **Org/team-shared logs** — deferred; logs are per-user private (schema leaves room for org-shared).

## Consequences
+ Reuses ~70% existing substrate (pgvector, embedder, RLS, injection points, Notes-style UI pattern).
+ Continuous-learning intent model; per-user isolation enforced at the DB layer.
+ Cost-safe by default (local vLLM; capped metered fallback) and chat-latency-safe (non-blocking, lagging).
− Real complexity: two DB roles, a dirty-queue worker, tz-correct consolidation, injection containment —
  all required (not optional) per the review; Phase 0 must verify RLS as the runtime role and vLLM
  reachability after a `force-recreate`.
− memory-service gains an LLM dependency (vLLM) it didn't have; circuit breaker + skip-and-lag contain it.
