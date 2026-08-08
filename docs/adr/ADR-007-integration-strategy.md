# ADR-007: Fork & Integration Strategy

**Status:** Accepted · **Date:** 2026-06-12

## Context
Analytikul builds on two MIT projects: LibreChat (frontend+backend base) and Hermes Agent
(Python agent runtime). Both evolve upstream. We need their capabilities without forking into an
unmaintainable divergence.

## Decision
- **LibreChat**: fork in place; `upstream` remote retained for merges. Tagged `upstream/v0-base`.
  Minimize edits to upstream files — new code in new files (`*/analytikul/*`, new routes/components).
  Two-line route registrations and a handful of surgical edits (sidebar swap, webhook mount) are
  the only upstream touches.
- **Hermes Agent**: VENDORED at `services/hermes-runtime/`, pinned commit `484f484…` (see
  ANALYTIKUL_PIN.md). NEVER edit vendored code. Our `analytikul_adapter/` package wraps only the
  public `AIAgent` API + tool registry. This keeps the runtime swappable behind the adapter.
- **Email/SES**: SMTP via env (LibreChat's mailer) — `EMAIL_*` vars; SES domain identity verified
  in Cloudflare DNS.
- **tsdown Windows fix** contributed upstream (#13700) rather than only patched locally.

## Alternatives Considered
- Switch frontend to Open WebUI (Svelte) for exact look — REJECTED (ADR-009): would discard all
  Analytikul differentiators and require re-integrating the agent engine against Open WebUI's
  backend. Rebuild the look in React instead.
- Pip-install Hermes as a dependency — rejected: needed source-level access to the tool registry
  and callbacks; vendoring with a pin is clearer and lets us read internals.

## Consequences
+ Can pull upstream LibreChat fixes with low conflict; runtime is replaceable.
+ Clear rule ("new files, never edit vendored") makes contributions safe.
− Vendored tree is large and carries cosmetic lint drift (filtered from lint-staged/eslint).
− Upstream-diff discipline needed over time (planned weekly CI diff).
