# Hermes update → Bot Mode in Analytikul — analysis & plan

> Status: **proposal / awaiting decisions** · Author: session Analytikul-One v2 · 2026-09-29
> Supersedes nothing; extends `openclaw-integration-plan.md` and the "surface all features" rule.

## TL;DR

1. **Bot Mode requires a major Hermes upgrade first.** We are pinned to **v0.16.0** (June 11).
   Bot Mode shipped in **v0.21.0** (Aug 31) and needs mid-2026+ gateway RPCs (`profiles.*`,
   `message_agent`, cron-with-memory, `shared-state.db` rooms) that **do not exist in 0.16**.
   Latest upstream is **v0.21.5** (Sep 24). So: **update, then Bot Mode.**
2. **Bot Mode's UI is desktop-only (an Electron plugin), but its substrate is not.** The plugin
   is a *pure UI layer* over gateway RPCs + CLI handoffs — "no core patches, no daemon." A Bot
   **is** just a Hermes profile (`~/.hermes/profiles/<name>/`). So we do **not** embed Electron;
   we drive the same RPCs from Analytikul's web app.
3. **Reveal-on-demand is a solved pattern here.** Analytikul's `PreviewRail` already reveals
   admin panels as tabs (`costs`, `memory`, `keys`, `openclaw`). A new **`bots`** tab is the
   same mechanism.
4. **The improvement:** make Bots *first-class Analytikul entities* — per-bot FinOps budgets,
   per-bot BYOK vault keys, org-shared team bots, metered group-chat rooms surfaced as Analytikul
   conversations — instead of a bolted-on clone of the desktop plugin.

---

## 1. What "Bot Mode" actually is (verified 2026-09-29)

Sources: upstream README, `website/docs/user-guide/bot-mode.md`, the `NousResearch/Hermes-Bot-Mode`
repo, and release notes for v0.20.6–v0.21.5.

- A **Bot = a Hermes profile**: isolated config, memory, skills, credentials, chat history under
  `~/.hermes/profiles/<name>/`. Bot Mode adds **no new data structures** — it renders existing
  profiles through a specialized UI.
- **Roster pane** (avatar, last-message preview, activity), **Sections** (folders, stored in each
  profile's `ui_meta`), a pinned **canonical "Bot Chat"** per bot, a **Routines pane** (namespaced
  cron jobs `[bot:<name>] <routine>`), **group-chat rooms** (2–6 bots, ≤3 serial rounds, room state
  in `shared-state.db`), **avatars** (blob/geometric/uploaded/AI-generated/pixel-pets).
- **Bot-to-bot messaging** via the `message_agent(target, message)` tool, resolved against the live
  roster; fire-and-forget with async completion. Cross-machine via desktop relay or the
  `hermes peer` CLI (gateway-to-gateway).
- **Backend it leans on:** gateway RPCs `profiles.list|create|describe|configure` and
  `image.generate`; Hermes cron; CLI handoffs (`hermes -p <bot> chat --in ~ -c "Bot Chat" -Q -q …`).
- **Availability:** desktop plugin only. **Not exposed in the web UI or gateway API by default** —
  `message_agent` only activates when a session is titled exactly `"Bot Chat"` and a profile carries
  `ui_meta: { hermes-bots: {} }` (markers the desktop plugin writes). Headless installs can wire it
  manually. Config gate: `agent.bot_mode_protocol: true` (default on).
- **License:** MIT (both Hermes and the Bot-Mode plugin) — we may port/adapt the plugin UI.

**Implication:** the desktop-only limitation is a *UI packaging* limitation, not a capability one.
Everything Bot Mode does is expressible over `profiles.*` + cron + `message_agent`, which the
gateway exposes. That is what makes a web Bots surface in Analytikul feasible.

## 2. Where we are today

- Pinned Hermes **v0.16.0**, vendored at `services/hermes-runtime/`, Analytikul code confined to
  `analytikul_adapter/` (`main, sessions, events, meter, memory, notes_tools`). Pin:
  `ANALYTIKUL_PIN.md` (commit `484f484…`).
- The pin **already ships a web dashboard** (`services/hermes-runtime/web/`, React 19) with a
  **`ProfilesPage.tsx`** — profiles (the Bot substrate) exist in our web UI, but roster/rooms/
  avatars/inbox/`message_agent` do **not** (all post-0.16).
- Prod embeds that web dashboard as the admin **OpenClaw** rail tab: `OpenClawPanel` iframes
  `/api/analytikul/openclaw/#token=…`; `api/server/routes/analytikul.js` reverse-proxies to the
  containerized gateway (embed cookie, gateway-token injection) plus a manage panel
  (status/start/stop/restart/logs) via `analytikul-openclaw-ops`. (`openclaw-integration-plan.md`)
- Reveal mechanism: `store.previewRail` `{open, tab}`; `PreviewRail` renders per-tab panels;
  `RailTabRow`/`PreviewRail` list the tabs (`agent|preview|costs|memory|keys|files|deploy|openclaw`).

## 3. The update (prerequisite work)

0.16 → 0.21.5 is five minor versions / thousands of PRs — too large for the pin doc's
"diff-and-apply." Treat it as a **fresh re-vendor**:

1. Clone `NousResearch/hermes-agent` at tag **v0.21.5** into a temp dir (depth 1, strip `.git`).
2. Replace `services/hermes-runtime/` **except** `analytikul_adapter/`; keep the vendored-path lint
   filters (`.husky/lint-staged.config.js`, `eslint.config.mjs`).
3. **Port the adapter** — the real risk. The adapter hooks Hermes internals (session lifecycle,
   event stream, metering, memory, tools) that changed across 0.17–0.21. Reconcile each of
   `main/sessions/events/meter/memory/notes_tools.py` against 0.21.5 APIs. Run adapter tests.
4. Rebuild the gateway/hermes container image; **stage on a non-prod container first** (the CT201
   deploy-fragility rule — a force-recreate wipes container hotfixes). Verify an agent run E2E
   (cost metering, org-memory, BYOK) before swapping prod.
5. Update `ANALYTIKUL_PIN.md` (commit + date + "Last verified").

Carries along, for free, other 0.17–0.21 wins we've wanted: cron-with-memory, MCP command-center
dashboard, live subagent steering, provider/model refreshes.

## 4. Integration options for the Bot-mode UI

| # | Approach | Effort | Fidelity | Analytikul fit |
|---|---|---|---|---|
| A | Embed the upstream web dashboard's (0.21) Profiles/roster pages as-is in the OpenClaw iframe | Low | Partial (no rooms/inbox unless upstream web gains them) | Poor — foreign UI, no cost/memory tie-in |
| B | **Port the MIT Bot-Mode plugin UI** into Analytikul's web app, wired to gateway `profiles.*`/cron/`message_agent` via a new `/api/analytikul/bots` proxy | Medium | High (it *is* the plugin UI) | Medium — faithful, but still "a clone" |
| C | **Build a native Analytikul "Bots" surface** on the same RPCs, designed into Analytikul (rail tab + full route), integrated with FinOps/vault/org-memory | High | High + differentiated | **Best** |

**Recommendation: C, reusing B's building blocks.** Port the plugin's proven interaction model
(roster, sections, canonical Bot Chat, routines, rooms, `message_agent`) but render it as native
Analytikul components against our proxy, so it inherits Analytikul's theme, auth, tenancy, and —
critically — our differentiators.

## 5. The improved idea — Bots as first-class Analytikul entities

Bolt Bot Mode onto Analytikul's existing strengths instead of duplicating a desktop app:

- **Per-bot FinOps.** Analytikul already meters every agent run (`analytikul_adapter/meter`,
  `costs` rail tab, budget → 402). Give each Bot its own **budget + spend view**; a group-chat room
  shows aggregate burn. This is a genuine advantage the desktop plugin has no concept of.
- **Per-bot BYOK vault.** Map Bot Mode's per-profile credential store to Analytikul's AES-256-GCM
  vault (`analytikul_adapter` + vault). A Bot inherits the tenant's BYOK key or carries its own.
- **Org-shared team bots.** Like `sharedWithOrg` notes: a tenant-level roster of shared specialist
  bots (a "Research" bot, a "Support" bot) versus private bots. Sections become the org's folders.
- **Rooms as Analytikul conversations.** Surface group-chat rooms in the normal conversation list
  with annotations + org-memory recall, not a separate silo.
- **Reveal on demand.** New admin/tenant **`bots`** `RailTab` → `BotsPanel` (roster + open a bot's
  canonical chat inline), plus a full-screen `/bots` route for room management — mirroring how
  Notes has both an embedded and a full view. Honors the "surface every feature as a side-panel
  button" rule (`hard-rule-surface-features`).
- **Multi-tenant safety.** Bots are profiles under the gateway; scope roster/RPCs by
  `tenantId`/`userId` in the proxy so one tenant never sees another's bots. The gateway's
  `API_SERVER_KEY` and our internal-auth secret stay server-side (never in the browser).

## 6. Staged implementation plan

- **S0 — spike (no prod):** stand up Hermes v0.21.5 in a throwaway container; confirm `profiles.*`,
  `message_agent`, cron, and room RPCs over the API server; capture the exact RPC contracts.
- **S1 — update the runtime:** re-vendor 0.21.5, port `analytikul_adapter`, adapter tests green,
  stage image, verify E2E, then prod swap. (§3)
- **S2 — bots proxy:** `/api/analytikul/bots/*` in `analytikul.js` → gateway `profiles.*`/cron/
  `message_agent`, tenant-scoped, admin/entitlement-gated, secrets injected server-side.
- **S3 — Bots UI:** `BotsPanel` + `bots` RailTab (roster, create bot, open canonical chat);
  data-provider hooks under `client/src/data-provider/Bots/`.
- **S4 — rooms & routines:** group-chat rooms as conversations; routines via existing cron gateway.
- **S5 — differentiators:** per-bot budget/spend, per-bot vault, org-shared bots.
- **S6 — docs:** FEATURES.md, HELP_CENTER.md, wiki mirror; register in My Apps if a new URL.

## 7. Decisions needed from the owner

1. **Update strategy:** full re-vendor to v0.21.5 now, or pin to v0.21.0 (Bot Mode's floor, smaller
   jump) and defer .1–.5? (Recommend v0.21.5 — the .1–.5 are stability/`state.db` fixes.)
2. **Integration path:** A, B, or **C** (recommended)?
3. **Audience:** admin-only (like OpenClaw today), or per-tenant/user bots for customers?
4. **Depth now:** ship S1–S3 (update + roster + single-bot chat) first, then rooms/differentiators
   later — or the full S1–S5 in one arc?
5. **Prod risk window:** the runtime swap needs a staged deploy; when can we take that window?
