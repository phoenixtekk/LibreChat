# Analytikul Coder — Local Bridge

A **localhost-only** service that lets the Analytikul (Hermes) Agent build on **your own machine**.
It owns the `Analytikul_AI_Bin` workspace folder and is the *only* thing that touches local disk:
the agent (running on the AiBox) relays its `file`/`terminal` tool calls to this bridge, which
executes them **path-jailed** to `Analytikul_AI_Bin\<project>` and **permission-gated**.

This is Phase 1 of the Claude-Code-Desktop-style workspaces plan
(`docs/analytikul-coder-workspaces-plan.md`).

## Run it

```bash
node services/coder-bridge/bridge.mjs
```

Zero dependencies — plain Node (>=18). On start it prints the workspace path, the port, and a
**pairing token**. Paste that token into the Agent rail once (Keys/Settings) to connect.

### First-run folder resolution

- Searches your drives for a folder named `Analytikul_AI_Bin` (**C: first**, then D:, E:, …).
- If found, uses it. If none is found, it tells you to create one (or point it at a folder):
  ```bash
  set CODER_BRIDGE_BIN=D:\Analytikul_AI_Bin   # Windows
  export CODER_BRIDGE_BIN=~/Analytikul_AI_Bin # macOS/Linux dev
  ```
- One folder **per project**: `Analytikul_AI_Bin\<project-name>`.

## Config (env)

| Var | Default | Purpose |
|---|---|---|
| `CODER_BRIDGE_PORT` | `8790` | Port (bound to `127.0.0.1` only) |
| `CODER_BRIDGE_BIN` | auto-detected | Override the workspace folder |
| `CODER_BRIDGE_ORIGIN` | `https://analytikul.ai,http://localhost:3090,http://127.0.0.1:3090` | Comma-list of web origins allowed to call the bridge (CORS) |
| `CODER_BRIDGE_EXEC_TIMEOUT` | `900000` | Max ms per command |

The pairing token is generated once and stored in `~/.analytikul-coder-bridge.json` (mode 600).

## Security model

- **Bind:** `127.0.0.1` only — never exposed to the network.
- **Auth:** every request needs `Authorization: Bearer <token>`; CORS reflects only allowed origins.
- **Path jail:** all file/exec paths resolve under `Analytikul_AI_Bin\<project>`; traversal is rejected.
- **Permission modes:** `plan` executes nothing and writes nothing (dry-run); `manual` / `accept_edits`
  approvals are enforced in the rail *before* it calls the bridge; `auto` / `bypass` run inside the jail.

## API (localhost, token-gated)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok, version, bin, platform}` |
| GET | `/projects` | — | `{projects: string[]}` |
| POST | `/projects` | `{name, permissionMode}` | `{name, created}` |
| POST | `/fs/tree` | `{project, path?, depth?}` | `{tree}` |
| POST | `/fs/read` | `{project, path}` | `{path, content}` |
| POST | `/fs/write` | `{project, path, content, permissionMode}` | `{path, written, bytes}` |
| POST | `/fs/stat` | `{project, path}` | `{path, type, size, mtime}` |
| POST | `/exec` | `{project, command, permissionMode}` | `{command, executed, stdout, stderr, exitCode}` |

`plan` mode responses set `dryRun: true` and make no changes.
