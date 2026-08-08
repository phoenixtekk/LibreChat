# ADR-009: Notes Feature & Open WebUI UI Parity

**Status:** Accepted · **Date:** 2026-06-12

## Context
User wants an Open WebUI-style Notes feature AND the Notes + main sidebar to look/work *exactly*
like Open WebUI (screenshots provided: a time-grouped notes list and a markdown note editor; a
single collapsible left sidebar). Open WebUI is Svelte; Analytikul's client is React.

## Decision
**Faithful React rebuild** — do NOT switch to Open WebUI's Svelte frontend. Use the same editor
engine Open WebUI uses (**TipTap**, via `@tiptap/react` v3 + `tiptap-markdown`) so the editor
behaves identically (inline WYSIWYG markdown, bubble toolbar, task lists). Replicate the notes
list (time bucketing Today/Yesterday/Previous 7/30 days/month/year, ⋯ menu, List/Grid, +New Note)
and a single collapsible sidebar (logo, New chat, Search, Notes, Workspace, Chats, account footer)
as React components referenced against the Open WebUI repo for exact Tailwind classes/spacing.
Notes AI actions (Enhance/Summarize/Continue) run as toolless **metered** agent calls so they
appear in the Costs dashboard, respect budgets, and use BYOK keys — an Analytikul advantage over
Open WebUI's plain Notes. Agent tools `search_notes/view_note/write_note` give the agent
note access scoped to the user.

## Alternatives Considered
- **Switch frontend to Open WebUI (Svelte)** — REJECTED: loses every Analytikul differentiator
  (FinOps dashboard, trace viewer, Preview Rail, skins, BYOK UI, org memory panels) and requires
  re-integrating the agent engine against Open WebUI's incompatible backend. Effectively restarts
  the frontend.
- Plain textarea + split preview (the first Notes implementation) — superseded; user explicitly
  wants the inline WYSIWYG Open WebUI feel.

## Consequences
+ Exact look/feel achievable while keeping all Analytikul features and the React stack.
+ TipTap is the same engine, so markdown behavior matches closely.
− Not a literal copy (Svelte→React translation); pixel parity requires visual diffing against
  screenshots (the verification step that was in progress when this ADR was written).
− Three TipTap v3 API differences caught (BubbleMenu import path, setContent options, no
  tippyOptions) — see architecture.md.
