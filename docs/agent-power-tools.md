# Agent Power Tools — Tiering, Entitlements & Pricing

**Status:** entitlement gating SHIPPED (server-enforced); pricing/packaging PROPOSED.
**Date:** 2026-06-28 · **Owner:** Lacy

The Hermes Agent's toolsets split into *information* tools (read/search/reason/generate — safe) and
**action** tools that touch the real world (your servers, a live desktop, people's inboxes, physical
devices). The action tools are the premium, governed tier — pricing them *is* the security boundary.

---

## 1. The toolsets by risk class

| Class | Toolsets | What they do | Risk |
|---|---|---|---|
| **Safe (info)** | web, search, x_search, vision, video, image_gen, video_gen, browser, tts, todo, memory, planning (notes + org-memory), context_engine, session_search, delegation, skills, kanban, cronjob, clarify, moa, discord | Read, search, reason, generate, plan | Low |
| **Sandboxed compute** | `code_execution`, `file` | Run code / manipulate files in a per-task gVisor sandbox | Medium (contained) |
| **Plan-gated actions** | `messaging`, `homeassistant` | Send messages on external channels; control Home Assistant devices | High — outbound side effects / physical world; BYO-credential |
| **Hard-floored (not shipped)** | `terminal`, `computer_use` | Run host shell commands; drive a live desktop GUI | Highest — host compromise / can do anything a logged-in human can |

---

## 2. Tier × tool matrix

✅ available · ➕ BYO-credential, per-user opt-in · 🔒 gated/upsell · ⛔ not shipped yet

| Toolset class | Free ($0) | Pro ($20) | Team ($40) | Enterprise (Custom) |
|---|---|---|---|---|
| Safe (info) tools | ✅ | ✅ | ✅ | ✅ |
| `code_execution`, `file` (sandboxed) | ✅* | ✅ | ✅ | ✅ |
| `messaging`, `homeassistant` | 🔒 | 🔒 | ➕ | ➕ |
| `terminal`, `computer_use` | ⛔ | ⛔ | ⛔ | ⛔ → ➕ once sandbox/VM ships (admin-approved, metered, audit-logged) |

\* As SHIPPED, `code_execution`/`file` are available on every plan (gVisor-sandboxed). **Proposed
option:** gate them at Pro+ to align compute cost with revenue (one-line policy change). Not done
yet — flagged for your call.

**What's enforced today (server):**
- `terminal` + `computer_use` → **hard-floored for everyone**, regardless of plan, until per-task
  sandbox/VM isolation is wired.
- `messaging` + `homeassistant` → **Team+ only**; stripped server-side below Team.
- Everything else → available.
- Enforcement is **fail-closed**: if the billing service is unreachable the plan resolves to `free`,
  so gated tools are denied, never accidentally granted.

---

## 3. Pricing & packaging suggestions

Current plans: **Free $0 · Pro $20 · Team $40/user/mo · Enterprise Custom**. Three complementary levers:

### A. Tier-gate (shipped shape)
`messaging`/`homeassistant` are a concrete reason to move Pro → Team (+$20/user/mo). Keeps the upgrade
story simple and already enforced.

### B. "Agent Power Tools" add-on (recommended next)
A purchasable add-on that unlocks the action tools without forcing a full tier jump:
- **+$15–25 / user / mo** (or a per-org flat, e.g. +$99/mo) → unlocks `messaging` + `homeassistant`
  on Pro or Team.
- Bundles the **governance** layer (admin approval + audit log) — itself an enterprise selling point.
- When sandbox ships, the add-on (Enterprise only) also unlocks `terminal` + `computer_use`.

### C. Usage-based markup (the margin lever)
The action/compute tools have real COGS (computer_use = vision tokens; terminal/sandbox = compute;
messaging = deliverability). You already meter cost per run (cost-events + budgets). Add a **markup
multiplier** on power-tool actions, surfaced in the existing cost UI:
- e.g. **1.3–1.5×** the raw provider/compute cost on power-tool steps, or a flat per-action fee
  (e.g. $0.01–0.05 / computer_use step).
- Naturally caps abuse via the existing budget system and turns the most expensive tools into a
  margin source rather than a cost sink.

### D. BYO-infrastructure (lowers your risk + COGS)
`messaging` (their bot token), `homeassistant` (their HA token), and later `computer_use` (their VM)
are **BYO-credential** — they bring the integration, bear the infra cost and the blast radius. You
charge for orchestration + governance. This is the BYOK model extended to *actions*.

**Recommended rollout:** ship A (done) → add B (the add-on + governance) → layer C (usage markup) →
add `terminal`/`computer_use` to Enterprise only after sandbox/VM isolation + audit log land.

---

## 4. How the entitlement gating works (shipped)

- `packages/api/src/analytikul/service.ts`: `getOrgPlan(orgId)` reads the org plan from the billing
  service (`GET /org`); `forbiddenToolsetsForPlan(plan)` returns the toolsets to strip = the hard
  floor (`HARD_FLOORED_TOOLSETS`) + any `PLAN_GATED_TOOLSETS` the plan's tier can't reach
  (`TIER_RANK`: free<pro<team<business<enterprise).
- `api/server/routes/analytikul.js` `/agent/run`: resolves the caller's plan (`tenantOf(req)` → org),
  computes the forbidden set, and strips it from `enabledToolsets` + force-adds it to
  `disabledToolsets` before calling the Hermes runtime. Replaces the old static global floor.
- The Agent panel reflects entitlements: gated tools show as locked chips; `messaging`/`homeassistant`
  become selectable at Team+.

## 5. Open decisions for the owner
1. **Gate `code_execution`/`file` at Pro+?** (currently open to Free) — one-line policy change.
2. **Add-on price** (B) and **usage markup** (C) numbers.
3. **Lift the `terminal`/`computer_use` floor** — only after per-task sandbox/VM isolation + audit log;
   then Enterprise + admin-approved + metered.
