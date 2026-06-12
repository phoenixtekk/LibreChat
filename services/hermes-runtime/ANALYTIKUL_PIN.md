# Hermes Agent — Analytikul fork pin

- Upstream: https://github.com/NousResearch/hermes-agent
- Pinned commit: `484f484c25bc89fbddc73f1d80410e99e6133fd5`
- Cloned: 2026-06-11 (depth 1, inner .git removed; vendored into the Analytikul monorepo)

Analytikul-specific code lives ONLY in `analytikul_adapter/` — never edit upstream Hermes files
directly. To update Hermes: re-clone upstream at a newer tag into a temp dir, diff against this
tree excluding `analytikul_adapter/`, apply, and update this pin.
