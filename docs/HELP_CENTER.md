# Analytikul Help Center

Welcome to Analytikul — the analytics-native AI workspace. This guide explains how to use every
feature. (Sections are added as features ship; see FEATURES.md for status.)

## Getting started
1. Open the app and create an account (email/password or SSO if your organization enabled it).
2. Add an API key for at least one AI provider under **Settings → API Keys** (bring-your-own-key),
   or use managed credits once billing launches (M4).
3. Pick a model from the selector at the top of the chat and start a conversation.

## Chatting
- **Switch models mid-conversation** with the model selector — compare answers across providers.
- **Fork a conversation** to branch into alternatives without losing the original thread.
- **Search** past conversations from the sidebar search box.
- **Upload files** with the paperclip / drag-and-drop to chat with documents.

## Personalizing your workspace
- **Command palette**: press <kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>Cmd</kbd>+<kbd>K</kbd> on Mac) anywhere
  to search and run commands — start a new chat, switch themes, or toggle panels without the mouse.
- **Skins**: choose between **Aurora** (deep navy, the default), **Ember** (warm charcoal/cream),
  **Verdant** (slate green), and **Slate** (classic neutral) from the command palette ("Skin: …").
  Each skin pairs with both light and dark mode — use "Switch to dark/light mode" to flip.
- **Accent colors**: pick Indigo, Amber, Emerald, Rose, Cyan, or Violet ("Accent: …") to recolor
  buttons and highlights. Your choices are remembered on this device.
- **Composer history**: press <kbd>↑</kbd> in an empty message box to recall previous messages,
  <kbd>↓</kbd> to go forward, <kbd>Esc</kbd> to restore your draft.
- **Preview Rail**: open from the command palette ("Toggle Preview Rail"). On phones it slides up
  from the bottom. Live agent output appears here once agent tasks ship.

## Running agent tasks
- Open the **Preview Rail** (<kbd>Ctrl</kbd>+<kbd>K</kbd> → "Toggle Preview Rail") and pick the **Agent** tab.
- Describe a task — research something on the web, write and run code, work with files — and press
  **Run agent** (or <kbd>Enter</kbd>). The rail opens automatically when a task starts.
- **Watch it work**: every step appears live in the trace — which tool ran, what it did, and what
  each AI call cost. Click any completed tool step to expand its output. The header shows your
  running token count and cost in real time.
- **Preview tab**: the agent's latest output renders here — images, web pages, structured data, or
  terminal output.
- **Cancel** any time with the Cancel button — the agent stops at the next safe point.
- Past runs for a conversation are saved and auditable (your admin can review traces).

## Tracking your AI costs
- Open the **Costs** tab in the Preview Rail (or <kbd>Ctrl</kbd>+<kbd>K</kbd> → "Open cost dashboard").
- See your last 30 days at a glance: total spend, number of AI calls, and tokens used — plus
  spend per day, per model, and per conversation, and a feed of recent calls with exact costs.
- If a model shows in "Unpriced models", its costs aren't being counted — ask your admin to add
  it to the price table.
- **Budgets**: your organization may set spending limits. If you hit a hard limit, agent runs
  pause with a clear message until the period resets or an admin raises the limit.

## Team memory
- Open the **Memory** tab in the Preview Rail to see facts your team has saved — every entry
  shows who saved it and when.
- Add a fact directly with the input box, or just ask your agent: *"remember for the team that…"*
  — it saves via the `save_to_org_memory` tool.
- From then on, **everyone's** agent automatically knows those facts: ask a question and relevant
  team memories are quietly provided to the agent before it answers.
- Delete outdated entries with the ✕ on each card.

## Notes
- Open Notes from the command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd> → "Open Notes") or go to `/notes`.
- **Write in markdown** with the toolbar (bold, headings, lists, ☑ task lists, code) — your work
  autosaves as you type, and Preview shows the rendered note.
- **AI assist**: select text (or nothing for the whole note) and click **AI: Enhance** to fix and
  tighten it in place, **AI: Summarize** for bullet points, or **AI: Continue** to keep writing in
  your style. These use your API key and show up in your Costs dashboard like any other AI call.
- **Pin** important notes to the top, **search** from the box above the list, **Export .md** to
  download, and **Share with org** to let teammates (and their agents) read a note.
- **Your agent can use your notes**: ask it things like *"search my notes for the deployment
  checklist"* or *"write a note summarizing this conversation"* — it has `search_notes`,
  `view_note`, and `write_note` tools scoped safely to your own notes.

## Bringing your own endpoints
- Open the **Keys** panel in the Preview Rail and switch to the **My Endpoints** tab.
- Add any OpenAI-compatible endpoint: a **name**, the **base URL** (e.g. `https://api.example.com/v1`),
  your **API key**, and the **model ids** you want to use (comma-separated).
- Your endpoints are **private to you** — they appear only in your own model picker, and the key is
  encrypted at rest and never shown again after saving.
- For your safety, the base URL is checked before it's saved: URLs that point at private or internal
  addresses are rejected (you'll see why), so an endpoint can't be used to reach internal services.
- Remove an endpoint anytime with the ✕ next to it.

## Coming soon (placeholders, filled in as each milestone ships)
- **Agent tasks & the Preview Rail** (M2): watch your agent browse, run code, and produce files
  live in a side panel; inspect every step and its cost in the Trace view.
- **Costs & budgets** (M3): the Analytics page shows what you spend per model and conversation;
  set monthly budgets and alerts.
- **Team memory** (M3): facts your team saves are remembered across conversations, with sources.
- **Messaging platforms & scheduled tasks** (M4): connect Telegram/Slack/Discord and schedule
  recurring agent jobs from Settings — no server required.
- **Plans & billing** (M4): Free, Pro, and Team plans; bring your own keys or buy credits.

## Talking to Amy (AiBox voice assistant)
Amy listens on the speakerphone and now has a camera, so she can see the room as well as hear it.
Say **"Hey Amy"**, wait for "How can I help you, Lacy?", then ask.

**Ask about what she can see**
- "What do you see?" · "How many people are in the room?" · "What am I holding?"
- "What colour is this?" · "Describe the room."
- Ordinary questions still go to the language model as before — she only looks when the question needs it.

**Move the camera**
- "Look left." · "Look right 60 degrees." · "Look up." · "Look straight ahead."
- "Look around the room." — she pans across the room and summarises what's there (takes about 25 seconds; she'll say "Let me take a look around" first).
- "Remember this spot as the door." — then later, "Look at the door."

**Privacy**
- "Close your eyes." — the camera genuinely switches off; its indicator light goes out and capture stops.
- "Open your eyes." — turns it back on.
- Nothing is recorded. A single frame is held in memory and overwritten twice a second, and all
  image understanding happens on your own hardware — no image ever leaves the AiBox.

### Asking Amy to search, and putting it on your screen
- "Hey Amy, search for the best mechanical keyboards." — she searches and answers out loud, and tells you
  which site it came from.
- Then: **"Pull that up on my computer."** — the page opens in your browser. Also works: "show me that",
  "open that", "bring it up".
- Want a different result? **"Open the second one."** · "Show me the third one." · "Open the last one."
- She remembers the last handful of links until she's restarted, so you can come back to them a bit later.
- Other ways to start a search: "look up …", "google …", "find me …", "find out about …".

> Tip: "look up the weather" searches the web, but a bare "look up" tilts the camera up — the difference is
> whether you give her something to look up.
