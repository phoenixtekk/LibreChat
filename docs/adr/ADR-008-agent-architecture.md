# ADR-008: Agent Engine Architecture

**Status:** Accepted · **Date:** 2026-06-12

## Context
The product's core is autonomous agents (Hermes parity + observability). The Python runtime is
synchronous and stateful; the frontend is React/SSE; every LLM call must be metered and budgeted;
multi-tenant isolation is mandatory.

## Decision
- **Session pool**: one `AIAgent` per `{tenantId}:{userId}:{conversationId}`, 10-min idle
  eviction, per-user concurrency cap. Hermes built-in memory disabled (`skip_memory=True`) — our
  memory-service owns persistence.
- **Threading**: synchronous `run_conversation` runs on a ThreadPoolExecutor worker; runtime
  callbacks emit onto a thread-safe `TaskEventBus`; the FastAPI SSE generator drains an asyncio
  queue (history replay + seq-deduped live tail).
- **Transport**: HTTP REST + SSE. Express is an SSE proxy (browser EventSource → Express →
  adapter `/stream/{task_id}`). Typed events in `packages/analytikul-shared`.
- **Cost metering**: wrap `agent.context_compressor.update_from_response` (single canonical-usage
  chokepoint) → emit `cost_event` + Redis `XADD`.
- **Budget gate**: Express checks analytics-service `/budgets/check` before every run (402 on hard
  overage). **Memory injection**: top-5 relevant org memories prepended as a system block.
- **Agent tools added** via the registry (pass INNER schema, registry adds the function wrapper):
  `save_to_org_memory`, `search_notes`, `view_note`, `write_note` — all scoped to the acting user
  via task-context lookup.

## Alternatives Considered
- Rewrite the agent loop in Node — rejected: Hermes's 40+ tools and loop are the value; wrap, don't
  reimplement.
- WebSocket instead of SSE — SSE is simpler, matches LibreChat's existing streaming, sufficient.
- Per-message new agent — rejected: loses conversation context and warm caching.

## Consequences
+ Full observability (every step + cost) and budget enforcement for free on every run.
+ Runtime stays vendored/swappable; tools are additive.
− Threaded sync runtime needs careful callback marshalling (done via loop.call_soon_threadsafe).
− Sandbox isolation is container-level in prod today; gVisor + ephemeral containers deferred.
