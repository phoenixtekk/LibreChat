# Analytikul Memory System — Product Spec & Seed System Instruction

> Status: DRAFT for review. Turns "how Claude Code remembers" into a **pillar, user-facing
> feature** of Analytikul Coder: a per-user memory system with a beautiful graph-based manager.
> Builds on the existing backend (`services/memory-service`, `docs/memory-architecture.md`,
> ADR-010) — this is the **CC-style node format + management UI** layer on top, not a rewrite.

---

## 1. The vision — "the memory manager people wish they had"

Most people don't know how to build an AI memory system. Analytikul ships one that is
**visible, editable, and beautiful**: every fact the agent knows is a card you can see, a node
on a graph you can explore, and a file you can edit. The differentiator is not that we *have*
memory — it's that ours is the **clearest, most manageable** memory system on the market.

Three surfaces, one store:
1. **Cards** — scannable list of memories, grouped by type, searchable.
2. **Graph** — force-directed map of memory nodes; edges are `[[wikilinks]]` and shared topics.
3. **Editor** — open any node, edit its fact/frontmatter, see what links to it.

---

## 2. The memory model (derived from Claude Code)

One **memory = one file = one fact**, with YAML frontmatter and a Markdown body:

```markdown
---
name: <short-kebab-case-slug>          # stable id, used as the [[link]] target
description: <one-line summary>          # used for recall relevance ranking
metadata:
  type: user | feedback | project | reference
---

<the fact. For feedback/project, follow with **Why:** and **How to apply:** lines.
Link related memories with [[their-name]].>
```

**Types (semantics carried from CC):**
| Type | Holds | Notes |
|---|---|---|
| `user` | who the user is — role, expertise, preferences | identity layer |
| `feedback` | guidance on how the agent should work (corrections + confirmed approaches) | include the *why* |
| `project` | ongoing work, goals, constraints not derivable from code/git | convert relative dates → absolute |
| `reference` | pointers to external resources (URLs, dashboards, tickets) | |

**Index:** a `MEMORY.md` holds one line per memory (`- [Title](file.md) — hook`) and is the
cheap always-loaded table of contents. Node bodies load on demand / on recall.

**Recall:** match a query against each node's `description`; surface the top-N as background
context (never as instructions). Memories reflect what was true when written — verify before
acting on a named file/flag.

**Discipline (the rules that keep it clean — enforced in UI):**
- Before saving, check for an existing node that already covers it → update, don't duplicate.
- Delete memories that turn out wrong.
- Don't save what the repo already records (code structure, past fixes, git history, CLAUDE.md).
- Link liberally; a `[[name]]` with no target yet is a valid "write this later" marker.

This is exactly the model already running for this project under
`…/.claude/projects/…/memory/` — we **port that format** as the seed and the interchange format.

---

## 3. The graph manager (the "cool" part)

- **Nodes** = memories, colored by `type` (user / feedback / project / reference), sized by
  connection count. Dangling `[[links]]` render as ghost nodes (a prompt to fill them in).
- **Edges** = explicit `[[wikilinks]]` (solid) + inferred shared-topic edges from the
  memory-service's embedding similarity (dashed, toggleable).
- **Interactions:** click a node → side panel with the fact + edit; hover → neighbors highlight;
  search → filter/spotlight; drag to pan, scroll to zoom; filter chips by type; "orphans" and
  "stale (>90d)" lenses.
- **Health view (the "reporting" ask):** counts per type, orphan count, dangling-link count,
  decay/age heatmap, growth over time — so the user can *manage* memory quality, not just view it.
- **Create/manage:** new node (guided form: type → description → fact → links), inline edit,
  merge duplicates, prune stale, and **import** an existing CC `memory/` folder (drag a zip of
  `.md` files → parsed into nodes).

**Library:** graph via **Cytoscape.js** (mature, huge graphs, good layouts) or **React Flow**
(nicer DX, editable nodes). Recommendation: **React Flow** for the editable manager feel, with a
force layout (`d3-force`/`elkjs`) — unless we expect >1k nodes, where Cytoscape wins.

---

## 4. Integration with the existing backend (not greenfield)

Analytikul already has: per-user + org memory (`memory-service`, pgvector + RLS), a 4-layer
Hermes-style design, Daily Logs, and an "Org Memory" panel. This feature:
- **Adds a node/file projection** over that store: each memory row ↔ one CC-style node
  (frontmatter derived from existing columns: type, description/summary, created/updated, links).
- **Adds `links[]`** (the `[[wikilink]]` graph) as first-class edges alongside the existing
  embedding-similarity edges — so users get *authored* structure, not just inferred.
- **Reuses** retrieval, decay (90-day), and per-user RLS scoping already built.
- New API surface (per-user, RLS-scoped): `GET /memory/nodes`, `GET /memory/graph`,
  `POST/PUT/DELETE /memory/nodes/:name`, `POST /memory/import`.
- New route/workspace: **Memory** (extend the existing sidebar "Org Memory" into a full
  workspace with Cards / Graph / Health tabs), reusing the two-pane pattern from Notes.

---

## 5. Phased build plan

- **Phase 1 — Read/see:** node projection API + Cards list + Graph view (read-only) + Health
  panel over existing memory-service data. Ships the "wow."
- **Phase 2 — Manage:** create/edit/delete nodes, `[[wikilink]]` authoring + edge rendering,
  merge/prune, MEMORY.md index generation.
- **Phase 3 — Seed & import:** ship the seed node set from §6, `.md`/zip import of a CC
  `memory/` folder, export back to `.md`.
- **Phase 4 — Intelligence:** dangling-link suggestions, dedupe detection, auto-topic edges,
  stale-node nudges, "explain this memory's connections."

---

## 6. Seed system instruction — "how I work and build web apps"

The following is the portable, product-neutral distillation of the owner's Claude Code global
rules, expressed as seed memory nodes (type in brackets). It doubles as the **default system
instruction** for Analytikul Coder and the **example content** that populates a new user's graph.

- **[user] operator-profile** — MSP/product engineer; ships web apps on an owned Linux fleet;
  values self-hosting, data ownership, and low marginal cost. Links: [[deploy-pattern]].
- **[feedback] auth-default-better-auth** — Default auth = self-hosted **Better Auth**
  (Postgres, no per-MAU fees), not Clerk/Auth0/Supabase, unless a project truly needs otherwise.
  **Why:** own the data, no auth vendor. **How:** copy the staged template, wire Drizzle tables.
- **[feedback] email-default-ses** — Transactional email = **Amazon SES** via `nodemailer`
  (SMTP 587), env-only creds, verified `EMAIL_FROM`. **Why:** standardization + deliverability.
- **[feedback] billing-risk-posture** — Treat payments as a business-continuity risk; abstract
  the processor behind one billing module; low-risk B2B SaaS → Stripe, high-risk → Merchant of
  Record. **Why:** freezes/lock-in are existential. **How:** normalize webhooks to internal events.
- **[feedback] docs-are-part-of-done** — A feature isn't done until `FEATURES.md`,
  `ADMIN_DOCS.md`, and the Help Center reflect it, and durable docs are mirrored to the Wiki.
- **[feedback] www-canonical** — Canonical host is always `https://www.<domain>`; apex 308→www.
- **[project] deploy-pattern** — linuxg fleet: build app image, run behind Cloudflare → reverse
  proxy on a free port; volume-mounted microservices deploy via restart; env changes need
  container recreate, not just restart. Links: [[operator-profile]].
- **[reference] agency-agents** — Install repo-local specialized subagents per project; use the
  right agent for specialized work.

(The real seed set is generated from the live global rules at build time so it stays current.)

---

## 7. Open decisions (need owner input before Phase 1)

1. **Graph library:** React Flow (editable, ≤1k nodes) vs Cytoscape.js (scale). *Rec: React Flow.*
2. **Home:** new top-level **Memory** workspace vs. expand the existing "Org Memory" panel. *Rec: new workspace, keep the panel as a quick view.*
3. **Scope of memory shown:** personal-only first, or personal + org (shared) with a toggle. *Rec: personal first, org as a Phase-2 lens.*
4. **Seed source:** auto-generate seed nodes from the live global rules, or curate a fixed starter set. *Rec: auto-generate + allow edit.*
