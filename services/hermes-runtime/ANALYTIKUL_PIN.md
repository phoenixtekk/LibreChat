# Hermes Agent — Analytikul fork pin

- Upstream: https://github.com/NousResearch/hermes-agent
- Pinned commit: `f97608f178d1ffeca59860195ab7da295f7c8e5f` (tag `v2026.9.24` = **v0.21.5**)
- Re-vendored: 2026-09-29 (depth 1, inner `.git` removed; vendored into the Analytikul monorepo)
- Previous pin: `484f484c25bc89fbddc73f1d80410e99e6133fd5` (v0.16.0, 2026-06-11)

Analytikul-specific code lives ONLY in `analytikul_adapter/` — never edit upstream Hermes files
directly. To update Hermes: clone upstream at the newer release tag into a temp dir, then replace
this tree **except** `analytikul_adapter/` (and this file), update `HERMES_PIN` in
`analytikul_adapter/main.py`, port the adapter per the RPC/adapter map, rebuild + verify.

## 2026-09-29 — re-vendor v0.16.0 → v0.21.5

- Full re-vendor (not a diff-apply — the 0.16→0.21 gap is too large). Preserved `analytikul_adapter/`
  (incl. its `Dockerfile`, `pyproject.toml`, `prices.yaml`, and glue `client_exec.py`/`code_exec.py`/
  `deploy.py`) and this file; replaced everything else with the v0.21.5 tree.
- **`website/` intentionally dropped.** Upstream Docusaurus docs only; not built into the runtime
  container, and several paths exceed Windows' 260-char limit. If ever needed, clone with
  `git -c core.longpaths=true`.
- Adapter port was **low-risk**: every upstream symbol the adapter hooks still exists with a
  compatible signature. Changes made: `HERMES_PIN` bumped; stale line-number comments in
  `sessions.py` refreshed to v0.21.5 locations. Full contract + port analysis:
  `docs/hermes-0.21.5-rpc-and-adapter-map.md`.
- Brings in: Bot Mode substrate (`profiles.*`, `message_agent`, `groups.*` rooms, `cron.manage`
  over the tui_gateway RPC surface), cron-with-memory, MCP command-center, provider/model refreshes.
- **Verified:** adapter `py_compile` clean; all hooked upstream modules present.
  **Not yet runtime-verified** — needs a container rebuild (`docker compose build hermes-adapter`)
  + agent-run smoke test on a non-prod container before the prod swap (CT201 deploy-fragility).

## Formatting drift note (obsolete after 2026-09-29 re-vendor)
The 2026-06-11 initial commit had lint-staged drift under `website/`, `apps/desktop/`, `ui-tui/`,
`web/`. The clean re-vendor replaced those trees, clearing the drift. `.husky/lint-staged.config.js`
filters `services/hermes-runtime/**` and `eslint.config.mjs` ignores it, so it stays clean.
