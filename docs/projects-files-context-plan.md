# Project Files & Context — scope

> Status: **scoped, not started** · 2026-10-04 · Feature for the Analytikul Coder/Agent "Projects"
> (the per-conversation workspace folders in the Agent panel).

## Goal

Let a user enrich a **Project** (a workspace folder the agent builds in) two ways:
1. **Add files** to the project (upload from the browser; or, in the desktop app, drop them in the
   real folder) so the agent can read them.
2. **Type project context** into a **multiline "Project Context" textbox** in the UI — saved per
   project and **auto-injected into every agent run** for that project (no file needed).

Both are confirmed feasible against the current code (injection points below).

## How Projects work today (grounding)

- A "project" is the `workspace` field on `POST /api/analytikul/agent/run`
  (`api/server/routes/analytikul.js:335`). The adapter maps it to `WORKSPACE_ROOT/<project>` and
  runs the agent there (`analytikul_adapter/sessions.py` `resolve_workspace_cwd`, `run(workspace=…)`,
  `run_conversation(system_message=…)`).
- **Desktop app:** the project is a real folder on the user's PC (`Analytikul_AI_Bin/<project>` via
  the local bridge); the agent reads/writes it with `read_file`/`write_file`/`search_files`/`tree`
  (`services/coder-bridge/bridge.mjs`). The **Files tab** is read-only today.
- **Context files are OFF:** the adapter runs with `skip_context_files=True`
  (`sessions.py:289`) — nothing is auto-loaded into the prompt today.

## Feature A — add files to a project

- **Server-workspace mode:** new `POST /api/analytikul/agent/workspace/upload` (multer memory,
  size + type caps, tenant + `workspace` scoped, path-traversal guarded) → writes into
  `WORKSPACE_ROOT/<project>/<name>`. Mirror the existing read-only workspace-file route
  (`:817`) and the Notes-image upload pattern (multer).
- **Desktop-bridge mode:** add a `write_file`/`put` op to the bridge FS surface
  (`/api/analytikul/bridge/fs`, `bridge.mjs`) so an upload lands in the paired machine's project
  folder. (The bridge already has `write_file`; expose a user-initiated upload path.)
- **UI:** an "Add files" control + drag-drop zone on the Files tab / Agent panel; show them in the
  existing project tree. Reuse the drop handling we added for Notes.

## Feature B — typed "Project Context" (the multiline textbox)

- **UI:** a collapsible **"Project Context"** `<textarea>` in the Agent panel, bound to the selected
  project; autosave (debounced, like NoteEditor) with a char cap (e.g. 16–32 KB) + a char counter.
- **Storage:** a small `ProjectContext` model keyed by `(tenantId, project)` in Mongo
  (`packages/data-schemas`), CRUD at `/api/analytikul/agent/context` (GET/PUT, auth + tenant scoped).
  Avoids any filesystem dependency and works in both desktop and server modes.
- **Injection (recommended — approach A):** in `/agent/run`, load the project's saved context and
  pass it through to the adapter as `system_message` (or a dedicated `project_context` kwarg that
  the adapter prepends to the system message in `run_conversation`). Deterministic, per-run, no flag
  flip, no files on disk.
- **Alternative (approach B):** write the typed context to `AGENTS.md` in the project cwd and set
  `skip_context_files=False` so Hermes auto-loads it. Leverages the native context-files feature but
  touches the filesystem and changes behavior globally — prefer A unless we want native parity.

## Cross-cutting

- **Tenancy/auth:** both features scope by `tenantId` + `workspace`; reuse `requireJwtAuth`.
- **Limits/cost:** cap context size (it rides every run → tokens/cost); surface the size in the UI.
  Consider counting it toward the FinOps view.
- **Security:** strict path-traversal + type/size validation on uploads; never execute uploads.
- **Docs:** FEATURES.md + HELP_CENTER.md ("add files / set project context") + wiki mirror.

## Acceptance

- Upload a file to a project → it appears in the tree and the agent can `read_file` it.
- Type context in the textbox → it persists per project across reloads, and the next agent run for
  that project reflects it (verify via a run that references the context).
- Switching projects swaps both the files view and the context textbox; tenant isolation holds.
