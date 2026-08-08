---
title: Analytikul Coder — Local Workspaces & Claude-Code-Desktop UI
description: Architecture and phased roadmap for per-project local build folders (Analytikul_AI_Bin), a local execution bridge (web) + a desktop app, and a Claude-Code-Desktop-style Agent rail.
published: true
tags: analytikul, hermes-agent, workspaces, desktop, planning
editor: markdown
---

# Analytikul Coder — Local Workspaces & Claude-Code-Desktop UI

**Owner:** Lacy · **Status:** Planning → build · **Branch:** `feature/analytikul-coder`

## Goal

Make the Hermes **Agent rail** work and feel like **Claude Code Desktop (CCD)**: each session is bound
to a **project folder on the user's own machine**, under `Analytikul_AI_Bin`, one folder **per project**.
Support **two delivery targets** so users can pick:

- **A — Web + Local Bridge:** keep the existing web rail (all tabs), but run the agent's file/terminal/
  code work **locally** on the user's PC via a bridge, building into `<drive>:\Analytikul_AI_Bin\<project>`.
- **B — Desktop App:** ship "Analytikul Coder" as a native desktop app (Electron/Tauri) that reuses the
  same UI and runs the agent locally — true CCD parity.

The Agent rail keeps **all current features and tabs** (Agent, Preview, Costs, Memory, Keys, Files, Deploy)
and adopts the CCD visual language.

## Current state (verified in code + live containers)

- **Workspace concept already exists but is switched off.** UI picker is gated behind `wsConfigured`
  (`client/src/components/analytikul/AgentPanel.tsx:437`). It only shows when the server env is set.
- Env today (CT201): `POWER_MODE=true` on both `analytikul-app` and `analytikul-hermes-adapter`
  (so `file`/`terminal`/`code_execution` are unlocked), **but** `WORKSPACE_HOST_DIR` (app) and
  `WORKSPACE_ROOT` (hermes) are **unset**, and no shared project folder is mounted.
- **Execution is server-side** in the Linux container. `file`/`terminal` pin to `WORKSPACE_ROOT/<project>`
  via process-global `os.chdir` + `TERMINAL_CWD` per run (`services/hermes-runtime/analytikul_adapter/
  sessions.py`). `code_execution` is ephemeral (fresh temp/container per call). ⇒ **The server-side agent
  cannot reach the user's `C:\`/`G:\` drives** — that is why local folders need A or B.
- **Permission modes already match CCD's five:** `plan / manual / accept_edits / auto / bypass`
  (`AgentPanel.tsx:121`).
- **Local bin already present:** `G:\Analytikul_AI_Bin` exists (nothing on C:–F:).

## Folder model (both targets)

```
<drive>:\Analytikul_AI_Bin\
    <project-a>\        # one folder per project (user-named)
    <project-b>\
```

- **First-run resolver (local, per CCD):** search drives (C: first) for `Analytikul_AI_Bin`; if found,
  use it; if not, prompt the user to pick a drive and create it. `G:\Analytikul_AI_Bin` already satisfies
  this today.
- **Per project, not per session.** A project folder is user-named; multiple chats/sessions may target
  the same project. Project name validated by `^[A-Za-z0-9._-]{1,64}$` (reuse existing `PROJECT_NAME_RE`).
- **Persistent** across runs (unlike `code_execution`'s temp dirs).

## Architecture

### A — Web + Local Bridge

The browser runs on the user's PC and can reach both the AiBox web app **and** a `localhost` bridge.

```
Browser (web rail)  ──SSE──  Hermes agent (AiBox, LLM + planning)
      │                             │ emits file/terminal tool call
      │  relays tool call           ▼
      └──HTTP/WS──►  Local Bridge (localhost, this PC)
                        executes in <bin>\<project>, returns result
```

- **Local Bridge** = a small signed service on the Windows PC exposing **scoped** ops:
  `read/write/list/stat` (files) and `exec` (terminal), **path-jailed to `Analytikul_AI_Bin`**, plus
  first-run drive resolution. Token-auth (bridge prints a pairing token; rail stores it per user).
  **Never** binds beyond `127.0.0.1`.
- **Permission enforcement in the bridge:** `plan` = dry-run/no writes; `manual` = each write/exec
  requires a rail approval prompt; `accept_edits` = auto-apply file writes, still prompt for exec;
  `auto` = run freely inside the jail; `bypass` = no prompts (explicit opt-in).
- **Hermes side:** a "client-executed tools" mode where `file`/`terminal` calls are emitted to the rail
  for local execution instead of running in-container. **Open risk — needs a spike** to confirm how
  `@librechat/agents` supports client/remote tool execution (see Risks).
- `code_execution` stays server-side/ephemeral for now (sandboxed heavy runs), or optionally routes to
  the bridge in a later phase.

### B — Desktop App

- Electron or Tauri shell wrapping the **same** `client/` UI (no UI fork).
- Bridge logic runs **in-process** (no pairing needed — same machine, same app).
- Models: point at AiBox (Ollama/vLLM) or a local Ollama; reuse the existing provider/Base-URL picker.
- Ships as an installer; auto-detects/creates `Analytikul_AI_Bin`.

### Shared

- Persist the chosen **workspace on the conversation** (DB), so reopening a chat restores its folder
  (fixes the "folder isn't remembered" gap).
- Reuse the existing `/api/analytikul/agent/workspaces` + `/workspace/tree` + `/workspace/file` REST
  shape; back it by the bridge (A) or local FS (B) instead of the container FS.

## CCD-style Agent rail (Layer 2 UI spec, from the CCD screenshot)

Keep all tabs; adopt CCD's layout inside the slide-out rail:

- **Left mini-column:** **Projects/Sessions** list with status dots; grouped by project; "＋ New".
- **Home / Code** segmented toggle at top.
- **Header breadcrumb:** `Project ▸ <folder>` with the active build folder always visible.
- **Right sub-panel:** **Background tasks** (agent runs / trace), with Clear.
- **Bottom command bar:** branch + `+N −N` diff → **Commit changes**; **permission pill**
  (Plan/Manual/Accept edits/Auto/Bypass); **model + effort** selectors; `/` command input.
- Preserve tabs: Agent · Preview · Costs · Memory · Keys · Files · Deploy.

## Phased roadmap

- **Phase 0 — Foundation (shared). ✅ DONE.** Folder model + first-run drive resolver (in the bridge);
  workspace↔conversation persisted in `localStorage` (`atk_ws_<conversationId>`); permission modes
  (plan/manual/accept_edits/auto/bypass) confirmed end-to-end.
- **Phase 1 — Local Bridge MVP (A). ✅ DONE + DEPLOYED.** Bridge service (`services/coder-bridge/`,
  files + exec, path-jailed, token-auth, plan dry-run, PNA/CORS) — live-tested. Server wiring: bus
  event `tool_dispatch`, `POST /tool_result/{task_id}`, `analytikul_adapter/client_exec.py` executor,
  `exec_target` flag, gating — deployed to `analytikul-hermes-adapter`, endpoint verified. Route +
  service (`/agent/tool_result`, `sendAgentToolResult`) + client relay (`bridge.ts`, `useAgentStream`
  `tool_dispatch` handling) + rail "Build on my machine" UI — built and deployed to `analytikul-app`.
  Remaining: the end-to-end browser run (user-driven).
- **Phase 2 — CCD rail UI.** Mockup approved. Build: projects list, active-folder header, bottom
  command bar, permission pill, model/effort, background-tasks panel. *(next)*
- **Phase 3 — Desktop app (B).** Electron/Tauri shell reusing `client/`, in-process bridge, installer.
  *(large)*
- **Phase 4 — Polish.** Git strip (branch + diff + commit) wired to the project folder; session grouping;
  per-project settings. *(medium)*

## Transport pivot (2026-08-06) — browser-localhost is blocked

The first relay design (browser → `http://127.0.0.1` bridge) is **impossible from the web app**:
modern Chrome blocks a public HTTPS page from reaching a local/loopback service at the network layer
(confirmed — even a `no-cors` request throws "Failed to fetch"; no bridge-side CORS/PNA header can fix
it). Fixed by **inverting the transport**: the bridge **dials out** and long-polls the server.

- Bridge (`services/coder-bridge/bridge.mjs`, v0.2.0): outbound only — pairs with a code, long-polls
  `GET /api/analytikul/bridge/poll`, executes the tool locally under `Analytikul_AI_Bin\<project>`,
  posts back to `POST /api/analytikul/bridge/result`. No localhost server, no token/URL, nothing exposed.
- App (`api/server/routes/analytikul.js`): in-process relay — `POST /bridge/pair` (JWT) issues a 24h
  code; `poll`/`result` (code-authed, registered before `requireJwtAuth`); `relayToolDispatch` hooks the
  `/agent/stream` `onEvent` so each `tool_dispatch` goes to the user's paired bridge and its result is
  posted to Hermes `/tool_result`. `taskMeta` now carries `workspace`/`permissionMode`.
- Client: browser relay removed; rail now shows **"Pair this machine"** (code + run command) instead of
  URL/token. Verified: bridge dial-out reaches the server and authenticates; endpoints return correct
  401s; app + hermes healthy. Remaining: the user-driven end-to-end agent run.
- This outbound model is also exactly what the desktop app (Phase 3) uses.

## Deploy notes (2026-08-05)

Deployed to CT201 (AiBox) by copying built artifacts into the running containers (the images aren't
built from an on-box repo): Python → `analytikul-hermes-adapter:/runtime/…`; `client/dist` +
`packages/api/dist/index.cjs` + `api/server/routes/analytikul.js` → `analytikul-app:/app/…`; both
restarted. **Caveat (per deploy-fragility rule): a `--force-recreate` of these containers reverts to the
baked image** — re-apply from source, or rebuild the `:coder` images to make it durable. The fresh
`client/dist` also carries the landing-page "y" fix, so that is now durable in the built bundle.

## Feasibility (spike verdict — resolved)

Approach A is buildable on the **current Hermes runtime** (correction: the adapter wraps Hermes
`run_agent.AIAgent`, **not** `@librechat/agents`). The proven seam is the existing **edit-approval
round-trip**: `_run` emits `permission_request` on the `TaskEventBus`, **blocks** on a
`threading.Event`, and is unblocked by `POST /respond/{task_id}` → `resolve_approval(...)`
(`services/hermes-runtime/analytikul_adapter/sessions.py:132-164, 104-119`; `main.py:243-250`). It
carries a decision string today; generalize it to carry a **tool-result payload** and it becomes a
synchronous mid-run RPC to the client. The terminal/file tools also already use a pluggable
`Environment` abstraction keyed on `TERMINAL_ENV` (`tools/terminal_tool.py:1072, 1204-1351`), so a new
`env_type="bridge"` backend is the clean insertion point.

Concrete changes for the Local Bridge MVP:
1. **Carry a result, not just a decision** — extend `_pending_approvals` + `resolve_approval`
   (`sessions.py:107,117`) to hold an arbitrary payload; add `POST /tool_result/{task_id}` (+ JS proxy
   in `api/server/routes/analytikul.js`, + `sendToolResult()` in `useAgentStream.ts`).
2. **Emit the tool call** — new `tool_dispatch` bus event (mirrors the `permission_request` emit).
3. **Block-and-return executor** — `env_type="bridge"` `Environment.execute()` (+ matching file
   executor) that emits the dispatch, waits on the Event, returns the client's stdout/exit code; or
   intercept generically at `registry.dispatch` (`model_tools.py:1114-1126`).
4. **Client owns the folder** — server-side `os.chdir`/`TERMINAL_CWD`/`WORKSPACE_ROOT` become moot for
   bridged tools; the bridge pins `Analytikul_AI_Bin\<project>`.
5. **Gating** — add a "bridge" allowance to `FORBIDDEN_TOOLSETS`/`POWER_MODE` (`sessions.py:47-52`) and
   its JS mirror `forbiddenToolsetsForPlan` (`analytikul.js:117`), since it's the user's own machine.

Note: terminal commands are **not** currently gated by the edit-approval path (only `write_file`/`patch`
are) — the bridge executor adds the gate for `exec` as it routes it.

Reference for Approach B: `@librechat/agents` (LangGraph) has first-class HITL
(`interrupt()`/`Run.resume(result)`) and swappable engines (`LocalExecutionEngine`,
`CloudflareSandboxExecutionEngine`) — useful if the desktop app later moves onto that runtime.

## Risks / open items

1. ~~Client-executed tools gate~~ — **RESOLVED** (see Feasibility above): the approval round-trip +
   `Environment` seam make it buildable on Hermes as-is.
2. **Local exec security** — a remote web app driving local shell/file ops. Mitigations: `127.0.0.1`
   only, token pairing, hard path-jail to `Analytikul_AI_Bin`, permission modes, per-command audit log.
   Bring in the Security Engineer agent before shipping A.
3. **Concurrency** — server-side workspace uses process-global `os.chdir`; safe only single-user/
   serialized. Fine for a personal box; must not enable on multi-tenant SaaS.
4. **Desktop framework** — Electron (mature, heavy) vs Tauri (light, Rust). Decide at Phase 3.

## Non-goals (for now)

- Enabling the **server-side** (AiBox) workspace as the primary build target (Approach C) — user chose
  local folders (A+B). Server-side remains available for sandboxed `code_execution`.
