# Analytikul — Features & Capabilities

Living record of implemented features. Update when a feature is added, changed, or removed.
See also `docs/` (authoritative project memory) and the public Help Center at `/help`.

## Tooling / Dev environment
- **Agency Agents** — installed repo-local at `.claude/agents/` (232 specialized subagents,
  native Claude Code format) from https://github.com/msitarzewski/agency-agents. Re-run the
  installer to update. Already present as of 2026-06-14 (no reinstall needed).

## Product — public site
- Marketing landing at `/` (Anunnaki/space theme); **Features** `/features`, **Pricing** `/pricing`,
  **Help Center** `/help` — static HTML served by Express from `dist` (see `marketing-site-pages`).
- App at `/chat` (React SPA).

## Product — workspace
- **Chat** — multi-provider (Anthropic platform-key today; OpenAI/Google BYOK), model selector,
  presets, prompt library.
- **Controls panel** — per-chat System Prompt + full advanced-parameter set + Add Custom Parameter.
- **Models** (`/workspace/models`) — OWUI-style grid + full builder (system prompt, base model,
  params, tools, capabilities, knowledge) via the embedded Agent Builder.
- **Agents (Hermes runtime)** — task launcher with live trace, 26 tool sets, provider/model picker,
  budget-capped runs (`checkBudget` FinOps).
- **Notes** — rich editor with AI actions + share-with-org.
- **Search** — full-text message search (MeiliSearch).
- **Org Memory** + **BYOK API Keys vault** (encrypted) — surfaced in the sidebar / Preview Rail.
- **Org / roles**, cost tracking & budgets.

## Known commercial risk (see pricing audit 2026-06-14)
- Anthropic chat + default agent are **platform-paid** and chat is **uncapped** (`CHECK_BALANCE`
  off). Pricing page promises BYOK. Reconcile before scaling paid users — set Anthropic to
  `user_provided` and/or enable `CHECK_BALANCE` with credits + overage.
