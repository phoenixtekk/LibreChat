# Hermes v0.21.5 — Gateway RPC Contract & Adapter Port Map

> Groundwork for (a) updating the vendored Hermes at `services/hermes-runtime/` from
> **v0.16.0 → v0.21.5**, and (b) building the Analytikul web **Bots** surface (Bot Mode)
> against the Hermes gateway RPCs.
>
> **Source of truth:** a shallow clone of the upstream stable tag. All `file:line` citations
> below are from the **NEW** tree unless explicitly labelled OLD.
>
> No file in the main repo was modified to produce this document (this report is the only new file).

---

## 1. Clone info + version confirmed

| Item | Value |
|---|---|
| Repo | `https://github.com/NousResearch/hermes-agent.git` |
| Requested tag | `v2026.9.24` (v0.21.5 stable) — **used successfully** (no fallback to `main` needed) |
| HEAD commit | `f97608f178d1ffeca59860195ab7da295f7c8e5f` — `chore: release v0.21.5 (2026.9.24)` |
| `pyproject.toml` version | **`0.21.5`** (confirmed, line 5) |
| Clone location (scratchpad, NOT the repo) | `…/scratchpad/hermes-0.21.5` |

**Clone caveat (Windows):** the shallow checkout reported `error: unable to create file … Filename too long`
for a handful of paths under `website/i18n/**` and `website/docs/user-guide/skills/**`. These are
Docusaurus translation/skill docs only — **no runtime code was affected**. All gateway, agent, tools,
and tui_gateway sources checked out cleanly. (If a full checkout is ever needed on Windows, set
`git config --system core.longpaths true` before cloning.)

**Build system / runtime:**
- `requires-python = ">=3.11,<3.14"` (`pyproject.toml:15`)
- `build-backend = "setuptools.build_meta"` (`pyproject.toml:429`); dependency/lock management via **uv** (`[tool.uv]` at `pyproject.toml:436`).
- **No Git LFS** (no `.gitattributes` LFS filters).

---

## 2. RPC contract reference (the meat)

### 2.0 Two distinct RPC surfaces

Hermes v0.21.5 exposes **two** server surfaces. The Analytikul Bots web UI will use both:

| Surface | Where | Transport | Auth | Purpose |
|---|---|---|---|---|
| **tui_gateway JSON-RPC** | `tui_gateway/server.py` + `tui_gateway/methods_*.py` | newline-delimited JSON-RPC over **stdio** (Ink/CLI) **or WebSocket** (`tui_gateway/ws.py`, mounted `@app.websocket("/api/ws")`) | WS: server-verified upgrade credential → `auth_identity` (`tui_gateway/ws.py:96-99`); stdio: process-local, none | The control plane: `profiles.*`, `session.*`, `groups.*`, `image.generate`, `cron.manage`, `prompt.submit`. **This is the "gateway RPC" surface for Bot Mode.** |
| **api_server** (platform) | `gateway/platforms/api_server.py` | aiohttp HTTP, OpenAI-compatible `http://localhost:8642/v1` | **`Authorization: Bearer <API_SERVER_KEY>`** (`_check_auth`, `api_server.py:1428-1470`; key resolved from the profile-scoped secret `API_SERVER_KEY`, `api_server.py:1177`, `:1412`) | OpenAI-compatible chat/runs, room grants/dispatch, live Bot-Chat turn delivery, health, browser control. |

The tui_gateway RPC handlers are registered with an `@method("<name>")` decorator (`method_ctx.HandlerRegistry`)
and the bodies are rebound onto `server.py` globals via `method_ctx.bind_module`. The full slow-handler /
method allow-list is in `tui_gateway/server.py:161-176`.

Every handler returns `_ok(rid, {...})` or `_err(rid, code, msg[, data])`.

---

### 2.1 `profiles.*` — `tui_gateway/methods_profiles.py`

Contracts (typed params/results): `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py`
(`profiles.list` at `:179`, `profiles.create` at `:219`).

#### `profiles.list` — `methods_profiles.py:266`
- **Params:** `include_sessions: bool = true` (adds `last_session` / `worker_session` / `canonical_session` per row).
- **Returns:** `{ profiles: [ { name, path, is_default, model, provider, description, display_name, skill_count, previous_names[], role, ui_meta_revisions, ui_meta?, has_avatar, last_session?, worker_session?, canonical_session? } ], bot_mode_protocol: true }`.
- **Bot-Mode relevance:** the row's `ui_meta` (with the `hermes-bots` block) and `canonical_session` (the profile's `"Bot Chat"` row: `id`, `resolved_id`, `title`, `preview`, `message_count`) are exactly what a Bots roster paints. `canonical_session` is resolved server-side from `db.get_session_by_title("Bot Chat")` (`methods_profiles.py:147-179`). The top-level `bot_mode_protocol: true` tells clients **not** to append the protocol to `SOUL.md` (`methods_profiles.py:283-285`).

#### `profiles.create` — `methods_profiles.py:383`
- **Params:** `name` (req), `description`, `clone_from`, `clone_all`, `clone_channels`, `no_skills`, `soul`, `model`+`provider`, `share_auth`, `no_alias`, `mirror_credentials` (default true).
- **Returns:** `{ ok, name, path, soul_written, model_set, mirrored: { env, auth, model_inherited, voice } }`.
- Delegates to `hermes_cli.profiles.create_profile(...)`.

#### `profiles.describe` — `methods_profiles.py:450`
- **Params:** `name` (req; `4063` name required / `4064` not found).
- **Returns:** `{ name, description, soul, model:{provider,default}, skills:[{name,enabled}], toolsets:[{name,label,description,tool_count,enabled}], toolsets_pinned, mcp_servers:[{name,enabled,transport}] }`.

#### `profiles.configure` — `methods_profiles.py:625`
- **Params:** `name` (req) + any independent section: `ui_meta` (+ `ui_meta_expected_revisions` for per-key CAS), `soul`, `description`, `model`+`provider` (+ `confirm_expensive_model`), `disabled_skills[]`, `enabled_toolsets[]`, `enabled_mcp_servers[]`.
- **Returns:** `{ ok, applied:{...per-section bool...}, confirm_required?, confirm_message? }`.
- **Bot-Mode relevance:** this is the **write path for the `ui_meta['hermes-bots']` marker** (see §2.6). `ui_meta` is merged key-wise into `profile.yaml`, `None` deletes a key, 64 KB cap, optimistic-concurrency via `_ui_meta_revisions` (`methods_profiles.py:487-531`).

Also present: `profiles.set_asset` (`:657`, avatar upload, PNG/JPEG/WebP ≤2 MB), `profiles.get_asset` (`:695`), `profiles.remember_onboarding` (`:712`).

---

### 2.2 `image.generate` (avatar generation) — `tui_gateway/methods_images.py:54`
- **Params:** `prompt` (req unless `probe`), `aspect_ratio` ∈ {`landscape`,`square`,`portrait`} (default `square`), `probe: bool` (availability only), `max_bytes` (data-URL cap, default 8 MB, max 16 MB).
- **Returns:** `{ available, success, image, image_data?, error? }` — `image_data` is a base64 **data URL** (a remote desktop can't read a gateway file path); omitted on download failure so callers fall back to `image` (the backend URL/path).
- Backed by `tools.image_generation_tool._handle_image_generate` (full provider dispatcher). SSRF-guarded fetch in `_image_to_data_url` (`methods_images.py:13-51`).

---

### 2.3 Cron / routines — RPC `cron.manage` → `tools.cronjob_tools.cronjob`
There is **no `cron.*` dotted RPC**. Cron is driven through one RPC method:

#### `cron.manage` — `tui_gateway/methods_tools.py:1187`
- **Params:** `action` ∈ {`list`,`add`,`remove`,`pause`,`resume`} (default `list`), `name` (job id), `profile` (per-profile store), and for `add`: `schedule`, `prompt`, `repeat`, `continuity`, `deliver`.
- Wraps `tools.cronjob_tools.cronjob(action=..., ...)`; `add` maps to `cronjob(action="create", ...)`, `remove/pause/resume` pass `job_id`.
- **Underlying Python API:** `cron/jobs.py` → `create_job(...)` (`:1732`, full kwargs incl. `prompt, schedule, name, repeat, deliver, skill(s), model, provider, script, workdir, no_agent, monitor_url, …`), `list_jobs(include_disabled)` (`:1896`), `remove_job(job_id)` (`:2216`).

**Bot routine naming / namespacing:** delivery targeting uses a `deliver` token, **not** a job-name prefix.
`BOT_CHAT_PLATFORM = "bot-chat"` (`cron/scheduler_delivery.py:1010`). The `deliver` values (documented in the
`cronjob` tool schema, `tools/cronjob_tools.py:1007`) are:
`'local'` (save only), `'all'`, **`'bot-chat'`** (inject into *this* profile's Bot Chat as a real message),
**`'bot-chat:<profile>'`** (a named profile on this machine), or `platform:chat_id:thread_id`;
comma-combine (e.g. `'origin,all'`). The `[bot:<name>]` string the task referenced is a **client-side list
filter** older gateways can't scope server-side (`methods_tools.py:1196-1199`), not a stored job-name convention.

---

### 2.4 `message_agent` tool — `tools/bot_mode_dm.py`
This is an **injected agent tool** (not a registry tool, not an RPC).

- **Schema:** `message_agent_tool_schema()` (`bot_mode_dm.py:64`) → OpenAI function `message_agent`, params `target: string` (req), `message: string` (req, ≤ `MESSAGE_MAX_CHARS = 16000`). Fire-and-forget; returns a dispatch ack, not the reply.
- **Dispatch:** `message_agent_tool(target="", message="", task_id=None, agent=None)` (`bot_mode_dm.py:198`).
  Returns JSON ack `{status:"queued", delivery_id, to, reply_delivery:"notification"|"poll", process_id, detail}` or `{error, reason, teammates?, peers?}`.
- **Target resolution** (`bot_mode_dm.py:198-283`):
  - `'<peer>'` or `'<peer>/<agent>'` matched by `_PEER_TARGET_RE` and the registered `peers` list → `hermes -p <self> peer dm <target>` over stdin.
  - a local teammate name / `display_name` / `@slug` → `_resolve_local_name` (`:167`); `'hermes'` maps to the `default` profile. Delivered by `hermes -p <resolved> <BOT_CHAT_TURN_ARGS>` (a Bot Chat turn) via `terminal_tool(background=True, notify_on_complete=True)`.
  - unresolved locally → Desktop **relay** roster (`_try_relay_delivery`, `:286`).
- **Server-side gate (the requirements that make it available):** `message_agent_authorized(agent)` (`bot_mode_dm.py:120`) AND re-checked on dispatch (`:209-214`). Both require **all** of:
  1. `agent._bot_mode_protocol` is truthy (the `agent.bot_mode_protocol` config toggle — see §2.6);
  2. the session title is **exactly `BOT_CHAT_TITLE` ("Bot Chat")** — read via `_session_title(agent)` (`bot_mode_dm.py:807`, from `agent._session_title_hint` or `session_db.get_session_title`);
  3. `is_bot_mode_managed(home)` is true — i.e. the profile carries `ui_meta['hermes-bots']` (`tools/bot_mode_probe.py:111-118`).
- **Injection:** `ensure_message_agent_tool(agent)` (`bot_mode_dm.py:137`) appends the schema and adds the name to `agent.valid_tool_names` once per turn, only when the gate passes. A forged call in a non-Bot-Chat session returns a structured error (never executes).

---

### 2.5 Group chat / rooms — `tui_gateway/methods_groups.py`
Contract: `tui_gateway/contracts/groups_bot_relay.py`. Canonical method list (`methods_groups.py:18-22`):
`groups.capabilities, groups.list, groups.create, groups.state, groups.send, groups.rename, groups.log,
groups.disband, groups.replicate, groups.replica_state, groups.promote, groups.demote, groups.stop,
groups.retry, groups.approve, groups.peer.invite, groups.peer.revoke, groups.peer.register`.

- `groups.capabilities` — `methods_groups.py:216`: `{ protocol_version, driver, persistent_process, authority_gateway_id, room_link:{enabled,profile,catalog,endpoint}, features[], methods[], max_log_limit }`.
- `groups.promote` — `methods_groups.py:506`: continue a replicated room on **this** gateway at `epoch+1`; **requires `confirm: true`** (else `4118`); params `room_id`, `reason`. Delegates `gateway.hosted_room_replicas.promote_replica`.
- `groups.demote` — `methods_groups.py:518` (via `_passthrough`): fence stale authority; params `room_id`, `observed_gateway_id`, `observed_epoch` → `gateway.hosted_room_replicas.demote_room`.
- `groups.replica_state` — `methods_groups.py:500` (via `_passthrough`): params `room_id` → `gateway.hosted_room_replicas.replica_state` (local replica coverage + authority lineage).
- `groups.create` (`:357`, params `room_id?`,`name`,`members`), `groups.send` (`:381`, `room_id`,`event_id`,`payload`), `groups.state` (`:367`), `groups.log` (`:487`, delta after `since_seq`), `groups.disband` (`:396`).

**Where room state lives:** the hosted-room DB path is `gateway.hosted_rooms.default_db_path()`
(imported throughout `methods_groups.py`, e.g. `:46`, `:202`, and every `db=True` handler). The room service
is `tui_gateway.hosted_room_service.HostedRoomService` bound to that path (`methods_groups.py:41-56`). Replica
state is in `gateway.hosted_room_replicas`. (This is the upstream "shared-state.db"-style store; the exact
filename comes from `gateway/hosted_rooms.py:default_db_path`.)

---

### 2.6 `agent.bot_mode_protocol` config + the `ui_meta['hermes-bots']` marker

**Config key `agent.bot_mode_protocol`:**
- Default **`True`** — `hermes_cli/config_defaults.py:174`.
- Loaded onto the agent as `agent._bot_mode_protocol` during init — `agent/agent_init.py:1381` (in the config-key list `"environment_probe", "bot_mode_protocol", …`).
- Read by: `agent/system_prompt.py:349-355` and `:702` (injects the Bot Mode protocol section only when the session title == `BOT_CHAT_TITLE`, via `tools.bot_mode_probe.get_bot_mode_protocol_section`), `agent/conversation_loop.py:631`, and the `message_agent` gate (`tools/bot_mode_dm.py:125,142`).

**The `hermes-bots` ui_meta marker (managed-install signal):**
- Stored in `profile.yaml` under `ui_meta['hermes-bots']` (a dict; `title` is the Bot Mode display name).
- **Read server-side:** `tools/bot_mode_probe.py:111-118` (`_bots_meta` / `is_bot_mode_managed`), and `hermes_cli/profiles.py:820-822` (Bot Mode title).
- **Written server-side:** through **`profiles.configure`** `ui_meta` (`methods_profiles.py:487-531`), CAS-guarded via `_ui_meta_revisions`; surfaced back on **`profiles.list`** (`_profile_ui_meta_fields`, `methods_profiles.py:241-263`).
- Desktop parity reference: `apps/desktop/src/plugins/hermes-bots/…` (e.g. `gateway/hosted_room_discussion.py:43`, `agent/prompt_builder.py:543`).

**"Bot Chat" session title** is the constant `BOT_CHAT_TITLE = "Bot Chat"` in `tools/bot_mode_probe.py`
(imported at `bot_mode_dm.py:127`, `methods_session.py:467`, `methods_profiles.py:159`). The canonical Bot
Chat is identified by **exact title** (`db.get_session_by_title("Bot Chat")`), which core treats as a
`UNIQUE(title)` registry of at most one row.

---

### 2.7 Session lifecycle over RPC — `tui_gateway/methods_session.py`
Contract: `tui_gateway/contracts/sessions.py`.

#### `session.create` — `methods_session.py:431` → `_create_session` (`:334`)
- **Params** (`SessionCreateParams`, `contracts/sessions.py:118-133`): `profile` (inherited from `ProfileParams`), `cols`, `source`, `cwd`, `messages[]` (seed), `parent_session_id`, **`title`**, `model`, `provider`, `reasoning_effort`, `fast`, `close_on_disconnect`, **`hidden`** (canonical Bot Chats are born hidden), `room_plumbing`, `follow_profile_config`.
- **Returns** (`SessionCreateResult`): `{ session_id, stored_session_id, message_count, messages[], info }`. A DB row appears on first prompt unless seeded.

#### `session.title` — `methods_session.py:1074`
- **Params:** `session_id`/`session_key`, `title` (omit to read). `4021` title required; `4022` invalid.
- **Returns:** read → `{ title, session_key }`; write → `{ pending, title }`. Uses `db.set_session_title(key, title)`.

#### `session.list` — `methods_session.py:488`
- **Params:** `title` (exact-title lookup, windowless — used to find the "Bot Chat" row; `hidden` rows resolve, archived/deny-listed don't), `limit` (default 200), **`include_hidden`** (Bots pane / pickers own hidden sessions).
- **Returns:** `{ sessions: [ {id, resolved_id?, title, preview, started_at, message_count, source} ] }`.

Also: `session.most_recent` (`:503`), `session.set_hidden` (`:1106`), `session.resume`, `session.interrupt`, `session.delete`, `session.compress`.

#### `prompt.submit` — `tui_gateway/methods_prompt.py:564`
- **Params** (`PromptSubmitParams`, `contracts/prompt_voice.py:26-46`): `session_id`/`session_key`, `text` (string or structured parts), `display_kind` (`"hidden"` honoured), `interrupted`, `queued`, `surface`, `voice_context`, `title_preview`, truncation set (`confirm_truncate` + `truncate_before_row_id`/`…message_id`/`…user_ordinal`).

---

### 2.8 Bot-Mode reachability summary
**Every Bot-Mode RPC exists in v0.21.5 and is reachable via the gateway RPC surface** (tui_gateway,
stdio/WS). `message_agent` is an injected agent tool gated on the Bot Chat session + managed-install
markers rather than an RPC. Live Bot-Chat turn delivery to a session another surface holds open also
crosses the **api_server** HTTP surface (`api_server.py` "canonical Bot Chat" handling, e.g. `:3257-3367`,
`api_server_runs.py:822-864`) — that surface authenticates with `Bearer API_SERVER_KEY`.

**Recommended Analytikul Bots wiring:** connect to the gateway over WS (`/api/ws`); use
`profiles.list`/`profiles.describe` to render the roster, `profiles.create`/`profiles.configure`
(incl. `ui_meta['hermes-bots']`) + `image.generate` to build/brand bots, `session.list(title:"Bot Chat",
include_hidden:true)` / `session.create(title:"Bot Chat", hidden:true)` + `prompt.submit` to drive a bot's
chat, `cron.manage` for routines (`deliver:"bot-chat[:profile]"`), and `groups.*` for rooms.

---

## 3. Adapter port checklist (per file)

**Scope:** the Analytikul glue is the 6 files in `services/hermes-runtime/analytikul_adapter/`
(`main.py, sessions.py, events.py, meter.py, memory.py, notes_tools.py`). Below, each **upstream** symbol
the adapter imports/hooks is classified against v0.21.5.

> **Headline:** every upstream symbol the adapter depends on **still exists in v0.21.5 with a
> compatible signature.** No RENAMES, no REMOVALS, and no SIGNATURE-CHANGES that break the current calls.
> Two internal call sites **MOVED** (line numbers only — referenced in comments, not in imports). The port
> is therefore low-risk *at the seam*; the real work is re-vendoring the ~15k-file upstream tree and
> re-verifying behavior, not rewriting adapter calls.

### 3.1 `main.py`
| Upstream hook | v0.21.5 location | Status | Action |
|---|---|---|---|
| `model_tools.get_tool_definitions(quiet_mode=True)` | `model_tools.py:213` | **UNCHANGED** — sig `get_tool_definitions(enabled_toolsets=None, disabled_toolsets=None, quiet_mode=False, skip_tool_search_assembly=False)`; still accepts `quiet_mode` kw | none |
| own: `events.TaskEventBus`, `sessions.*`, `memory.register_memory_tool`, `notes_tools.register_notes_tools`, plus sibling adapter files `code_exec`, `client_exec`, `deploy` | — | own code | keep; no upstream drift |

- No changes required. (FastAPI/pydantic are the adapter's own deps, unaffected by the Hermes bump.)

### 3.2 `sessions.py` (the heaviest coupling)
| Upstream hook | v0.21.5 location | Status | Action |
|---|---|---|---|
| `run_agent.AIAgent(...)` ctor kwargs used: `base_url, api_key, provider, model, skip_memory, skip_context_files, quiet_mode, save_trajectories, session_id, platform, enabled_toolsets, disabled_toolsets, max_tokens` | `run_agent.py:261` | **UNCHANGED** — all 13 kwargs still present (forwarder to `agent.agent_init.init_agent`) | none; consider optionally passing the new `cwd=` kwarg instead of the `os.chdir`/`TERMINAL_CWD` dance |
| `agent.run_conversation(user_message=, system_message=, task_id=, stream_callback=)` | `agent/turn_facade.py:22` (`TurnFacadeMixin`) → `agent/conversation_loop.py:1605` | **UNCHANGED** — sig `(user_message, system_message=None, conversation_history=None, task_id=None, stream_callback=None, …)` | none |
| run result dict keys `final_response, failed, error, interrupted` | `agent/conversation_loop.py:590-591, 993-1006` | **UNCHANGED** — `final_response`/`failed`/`error` confirmed; `interrupted` carried in `**flags` | none (keep `.get()` guards) |
| `agent.interrupt("…")` | `agent/interrupt_control.py:109` | **UNCHANGED** — sig `interrupt(self, message=None, *, hard_cancel=False, …) -> bool`; positional message OK | none |
| `agent.context_compressor.update_from_response` monkey-patch | attr set in `agent/agent_init.py` (`ContextCompressor`); method `agent/context_compressor.py:2740` `update_from_response(self, usage)` | **UNCHANGED** (behavior); comment line ref stale | update the stale comment `agent/conversation_loop.py:1568` → the sink now fires from **`agent/turn_usage.py:125`** (`compressor.update_from_response(usage_dict)`) |
| callbacks set: `tool_start_callback, tool_complete_callback, tool_progress_callback, step_callback, stream_delta_callback` | invoked at: `tool_start` **`agent/tool_executor.py:991`** `(id, name, args)`; `tool_complete` **`:1016`** `(id, name, args, result)`; `tool_progress` `agent/turn_response_intake.py:109,114`; `step` **`agent/turn_iteration_prep.py:131`** `(api_call_count, prev_tools)`; `stream_delta` `agent/chat_completion_helpers.py:2841`, `agent/turn_tool_round.py:152/176` | **UNCHANGED contract / MOVED lines** — arities match the adapter's `_wire_callbacks` exactly (adapter already uses `*rest` guards) | update the stale line refs in `sessions.py:519,522,539` comments (446→991, 719→1016, cl:512→turn_iteration_prep:131); no code change |
| `acp_adapter.edit_approval.should_auto_approve_edit(proposal, "session"/"workspace_session", cwd)` | `acp_adapter/edit_approval.py:148` | **UNCHANGED** — sig `(proposal, policy, cwd=None)`; policy constants `AUTO_APPROVE_SESSION="session"` (`:47`), `AUTO_APPROVE_WORKSPACE="workspace_session"` (`:46`) still match the string literals passed | none |
| `acp_adapter.edit_approval.set_edit_approval_requester` / `reset_edit_approval_requester` | `edit_approval.py:53` / `:58` | **UNCHANGED** | none |
| `agent.runtime_cwd.set_session_cwd(cwd)` / `clear_session_cwd()` | `agent/runtime_cwd.py:38` / `:43` | **UNCHANGED** — `set_session_cwd(cwd: str|None) -> Token` | none |
| env-var floor logic (`POWER_MODE`, `TERMINAL_CWD`, toolset names `terminal/computer_use/messaging/homeassistant`) | env only | **UNCHANGED** | re-verify the toolset names still exist as toolsets in v0.21.5 `toolsets` registry (they are string floors; harmless if a name is gone, but confirm `computer_use`/`terminal` names) |

- **Net:** `sessions.py` should port with **only stale-comment updates**. Re-run the app after re-vendor and
  confirm: (1) events stream (callbacks fire), (2) cost metering fires (the `update_from_response` wrapper
  still intercepts), (3) edit-approval prompts route.

### 3.3 `events.py`
- Pure stdlib (`asyncio`, `threading`, `json`). **No upstream Hermes symbols.** **UNCHANGED** — no action.

### 3.4 `meter.py`
- Own + external only (`yaml`, `redis`). **No upstream Hermes symbols.** **UNCHANGED** — no action.
- (The usage dict it consumes comes from `sessions.py`'s wrapper of `update_from_response`, which is unchanged.)

### 3.5 `memory.py`
| Upstream hook | v0.21.5 location | Status | Action |
|---|---|---|---|
| `tools.registry.registry.register(name=, toolset="planning", schema=, handler=, description=, emoji=)` | `tools/registry.py:662` (class `ToolRegistry`); singleton `registry` at `:1009` | **UNCHANGED** — sig `register(self, name, toolset, schema, handler, check_fn=None, requires_env=None, is_async=False, description="", emoji="", …, scope=None)`; all adapter kwargs still accepted (new optional params added, backward-compatible) | none |
| `toolset="planning"` must exist as a valid toolset | `toolsets` registry | **verify** | confirm `planning` is still a registered toolset name in v0.21.5 (schema-level validation now rejects malformed schemas at registration, `registry.py:676-684`) |
| Memory service HTTP contract (`MEMORY_SERVICE_URL`, `/memories/search`, `/retrieve`, `/memories`) | Analytikul memory-service (not Hermes) | own | unaffected by the Hermes bump |

- **Net:** no code change expected; just confirm the `planning` toolset name and that schema shape passes the
  new registration-time validation (it does — `parameters` is a dict).

### 3.6 `notes_tools.py`
| Upstream hook | v0.21.5 location | Status | Action |
|---|---|---|---|
| `tools.registry.registry.register(...)` ×3 (`search_notes`, `view_note`, `write_note`, all `toolset="planning"`) | `tools/registry.py:662` | **UNCHANGED** | none (same verification as §3.5) |
| everything else | `pymongo`, `bson` (own) | own | unaffected |

---

## 4. Blockers / surprises

1. **Windows long-path checkout failure (cosmetic).** The shallow clone failed to write several
   `website/i18n/**` and `website/docs/**/skills/**` files (path > 260 chars). **No runtime code affected.**
   To re-vendor cleanly on Windows use `git -c core.longpaths=true clone …`, or vendor only the runtime
   subtree and drop `website/`, `evals/`, `tests*/` (the current vendored copy already omits most of these).

2. **`services/hermes-runtime/` currently vendors extra adapter files not in the "6-file" list.**
   `analytikul_adapter/` also contains `client_exec.py`, `code_exec.py`, `deploy.py` (and `Dockerfile`,
   `prices.yaml`, `pyproject.toml`). `main.py`/`sessions.py` import these. They are Analytikul-authored glue
   too and must be carried across the bump. They add these **extra** upstream touch-points to re-verify
   (not in scope for the 6-file checklist, flagged here):
   - `sessions.py` uses `acp_adapter.edit_approval.*` — **confirmed present** (`acp_adapter/edit_approval.py`).
   - `deploy.py` / `client_exec.py` may import other upstream helpers (`tools.terminal_tool`, process
     registry, etc.) — audit these when porting; e.g. `message_agent` shows `tools.terminal_tool.terminal_tool`
     is still the background-exec entry (`bot_mode_dm.py:639-643`).

3. **`HERMES_PIN` is a hard-coded commit hash in `main.py:32`**
   (`484f484c25bc89fbddc73f1d80410e99e6133fd5`, the v0.16.0 pin) and is echoed by `/health`. **Update this
   pin to the v0.21.5 HEAD `f97608f178d1ffeca59860195ab7da295f7c8e5f`** as part of the bump, or `/health`
   will misreport the runtime version.

4. **Stale line-number comments in `sessions.py`** (446/719/512/1568) no longer point at the right lines
   (now 991/1016/turn_iteration_prep:131/turn_usage:125). These are documentation only — behavior is intact —
   but they should be corrected so the next maintainer isn't misled.

5. **Python version.** v0.21.5 requires `>=3.11,<3.14`. Confirm the vendored container base image and the
   adapter's own `pyproject.toml` target a compatible interpreter; if the v0.16.0 image pinned an older
   Python, bump the base image. (Build backend is still `setuptools.build_meta` + `uv` — no build-system
   migration.)

6. **No Git LFS** — nothing special needed for large assets.

7. **Two auth models to wire in the web Bots surface (not a code blocker, a design note).** The gateway
   control RPCs go over the tui_gateway WS (`/api/ws`, upgrade-credential auth), while the OpenAI-compatible
   and live-Bot-Chat-delivery paths go over api_server HTTP with `Bearer API_SERVER_KEY`. The Bots UI will
   need both, and `API_SERVER_KEY` must be provisioned per profile (`agent.secret_scope`).

---

*Generated from upstream tag `v2026.9.24` / commit `f97608f`. All §2–§3 citations are from the NEW tree
at `…/scratchpad/hermes-0.21.5`.*
