# ADR-003: AI Provider Strategy

**Status:** Accepted · **Date:** 2026-06-12

## Context
The product is multi-provider by design; the agent engine and Notes AI need a model, and the
business model is BYOK.

## Decision
**BYOK-first** with a server default fallback. Per request, the backend resolves the user's
vaulted key (ADR-004) for the active provider; if none, it falls back to
`AGENT_DEFAULT_API_KEY`. Production default: **Anthropic `claude-sonnet-4-6`**, base URL
`https://api.anthropic.com` (NO `/v1` suffix — the Hermes runtime appends paths).
Pricing for cost metering lives in `services/hermes-runtime/analytikul_adapter/prices.yaml`
(USD per 1M tokens, prefix-matched, hot-reloaded on mtime). Unpriced models surface in the
dashboard. Provider extras (`anthropic`, etc.) installed into the adapter image.

## Alternatives Considered
- Single managed provider — rejected: contradicts the BYOK business model and multi-provider
  positioning.
- Per-request model picker UI everywhere — partially present (agent panel); default-driven for
  Notes AI to keep utility calls simple.

## Consequences
+ High margin (users bring keys); provider-agnostic; cost attribution per model built in.
+ Adding a provider = add a price entry + ensure its SDK extra is in the adapter image.
− Each provider's lazy SDK dep must be installed in the adapter image (caught Anthropic missing
  during M2).
