# Agent folder-picker — scope

> Status: **scoped, not started** · 2026-10-04 · UX improvement for the Analytikul Coder/Agent so a
> project can point at any local folder (e.g. `G:\VisualStudioCode\Intune-Reporting`) via a native
> picker, instead of the `CODER_BRIDGE_BIN` env-var dance.

## Goal

In the **Analytikul AI Desktop App**, add an **"Add folder…"** control in the Agent panel's project
selector that opens a native OS folder dialog; the chosen folder becomes a selectable project the
agent reads/writes (path-jailed to that folder). No env vars, no manual `Analytikul_AI_Bin` layout.

Confirmed feasible against the code; it is a **desktop-app feature** (native folder picking needs
Electron — a browser can't hand the agent a real filesystem path).

## How it works today (grounding)

- The **local bridge** (`services/coder-bridge/bridge.mjs`) runs on the user's machine, pairs with
  analytikul.ai, and executes the agent's file/terminal tools **path-jailed under a workspace root**
  `BIN` (`CODER_BRIDGE_BIN` or an `Analytikul_AI_Bin` folder). A "project" is a subfolder under `BIN`
  (`fsHandle` `'projects'` lists `BIN/*` dirs; `projectDir`/`resolveInProject` reject escapes). Config
  lives at `~/.analytikul-coder-bridge.json` (`CONFIG_PATH`).
- The **desktop app** (`services/coder-desktop`) is Electron: `main.mjs` has `ipcMain` + a `preload.cjs`
  that `contextBridge.exposeInMainWorld('analytikulDesktop', { pair, … })`. So a web→desktop channel
  already exists (`window.analytikulDesktop`).
- The **Agent panel** lists projects via the bridge / `/api/analytikul/agent/workspaces` and runs the
  agent with a `workspace` (project) name (`AgentPanel.tsx` `loadWorkspaces`, `/agent/run`).

## Design

1. **Desktop — native picker + grant.**
   - `preload.cjs`: expose `pickFolder()` → `ipcRenderer.invoke('atk:pick-folder')`.
   - `main.mjs`: `ipcMain.handle('atk:pick-folder', …)` → `dialog.showOpenDialog({ properties:
     ['openDirectory'] })`; return the absolute path (or null if cancelled).
   - On pick, register the folder as a **named root** in the bridge config
     (`~/.analytikul-coder-bridge.json` → `{ roots: [{ name, path }] }`); the name defaults to the
     folder basename (deduped). This is the user's explicit, revocable grant.

2. **Bridge — registered roots.**
   - Load `roots` from config at startup / on change. Extend project resolution so a `project` can be
     EITHER a `BIN/<name>` subfolder (today) OR a registered root name → its absolute path.
   - Keep the containment jail **per root**: `isInside(root, full)` — a path can never escape its
     chosen folder. `'projects'` op returns BIN subfolders **plus** registered roots (name + path).
   - Registered roots are only ever added through the picker (consented); never inferred.

3. **Web Agent panel — UI.**
   - Project selector shows BIN projects + registered roots (name + a truncated path, with a small
     "folder" badge). Add an **"Add folder…"** item.
   - If `window.analytikulDesktop?.pickFolder` exists → call it, then refresh the project list. If NOT
     (browser-only, no desktop app) → disable it with a hint: "Open the Analytikul AI Desktop App to
     add a local folder."
   - Selecting a registered root sets `workspace` to that root's name; `/agent/run` + the bridge map
     it to the absolute path.

4. **Server passthrough.** No new server trust surface — the project→path mapping lives in the bridge
   (local, consented). `/agent/workspaces` and `/api/analytikul/bridge/fs` just surface whatever the
   paired bridge reports (now including registered roots).

## Security

- Access is an **explicit per-folder grant** via the native dialog — the user chooses exactly what to
  expose. Persisted in the bridge config; show a "Manage folders" list with **remove/revoke**.
- Per-root path-traversal jail is preserved (no escaping a granted folder). Terminal/exec stay under
  the same floor/permission model as today.
- Nothing server-side gains new filesystem reach; it all runs through the user's local bridge.

## Acceptance

- In the desktop app, "Add folder…" → pick `G:\VisualStudioCode\Intune-Reporting` → it appears in the
  project selector; the agent can `read_file`/`write_file` `FEATURES.md` there, and cannot escape it.
- The grant persists across bridge/app restarts and can be revoked from the UI.
- In a plain browser (no desktop app), the control is disabled with the explanatory hint.
