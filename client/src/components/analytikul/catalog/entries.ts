import type { CatalogEntry } from './types';

/** Master catalog. Ordered loosely so a sequential reader gets a reasonable
 *  product tour. Search + per-user "used" state should be doing most of the
 *  actual surfacing work in the UI. */
export const CATALOG: CatalogEntry[] = [

  /* -------- Start here -------- */

  {
    id: 'start.palette',
    title: 'Press Ctrl+K to find anything',
    category: 'start',
    summary: 'Opens this catalog. Search across every feature, every panel, every slash command.',
    tags: ['palette', 'search', 'discover', 'keyboard'],
    state: 'live',
    action: { kind: 'none' },
  },
  {
    id: 'start.new-chat',
    title: 'Start a new conversation',
    category: 'start',
    summary: 'Fresh thread with the default Analytikul agent. Pick a model and go.',
    tags: ['chat', 'new'],
    state: 'live',
    action: { kind: 'navigate', path: '/c/new', label: 'New chat' },
  },
  {
    id: 'start.switch-model',
    title: 'Switch models mid-conversation',
    category: 'start',
    summary: 'The picker in the header swaps the model for the next turn — no need to start over.',
    tags: ['model', 'provider'],
    state: 'live',
    action: { kind: 'none' },
  },
  {
    id: 'start.find-old',
    title: 'Find an older conversation',
    category: 'start',
    summary: 'Search every chat you have ever had, not just titles — message contents too.',
    tags: ['search', 'history', 'recall'],
    state: 'live',
    action: { kind: 'navigate', path: '/search', label: 'Open search' },
  },

  /* -------- Agent intelligence -------- */

  {
    id: 'intel.skills-browse',
    title: 'Browse your skill library',
    category: 'intelligence',
    summary: 'Reusable approaches the agent has learned. Each skill is a named, versioned playbook it can pull off the shelf.',
    tags: ['skills', 'learning', 'reuse'],
    state: 'beta',
    action: { kind: 'navigate', path: '/skills', label: 'Open Skills' },
  },
  {
    id: 'intel.skills-save',
    title: 'Save a skill from a successful run',
    category: 'intelligence',
    summary: 'After a long task lands well, capture the approach as a skill so the agent reaches for it next time.',
    body: 'Skills are how Analytikul beats a fresh chat session. Once saved, the agent searches them automatically when a new task looks similar.',
    tags: ['skills', 'learning', 'memory'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'intel.subagent',
    title: 'Delegate work to a sub-agent',
    category: 'intelligence',
    summary: 'Spawn a parallel agent for a side-task while your main conversation keeps moving.',
    body: 'Useful for "research this in the background while we keep talking" or "run these three drafts side-by-side."',
    tags: ['subagent', 'delegate', 'parallel'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'intel.trace',
    title: 'See what the agent decided and why',
    category: 'intelligence',
    summary: 'Open the trace viewer to inspect every step the agent took — tool calls, reasoning, results.',
    tags: ['trace', 'debug', 'transparency'],
    state: 'live',
    action: { kind: 'panel', tab: 'preview', label: 'Open trace' },
  },

  /* -------- Tools & capabilities -------- */

  {
    id: 'tools.web-search',
    title: 'Let the agent search the web',
    category: 'tools',
    summary: 'Live results from the open web, cited inline. Off by default per conversation.',
    tags: ['web', 'search', 'tool', 'browser'],
    state: 'gated',
    action: { kind: 'none' },
  },
  {
    id: 'tools.browser',
    title: 'Have the agent drive a browser',
    category: 'tools',
    summary: 'A real Chromium session the agent can click, scroll, and read. Watch live or step away and review later.',
    tags: ['browser', 'automation', 'computer-use'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'tools.image-gen',
    title: 'Generate an image',
    category: 'tools',
    summary: 'Multiple providers wired in. Ask for it in chat — the agent picks the right one.',
    tags: ['image', 'generation', 'visual'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'tools.tts',
    title: 'Hear answers read aloud',
    category: 'tools',
    summary: 'Click the speaker on any reply, or toggle auto-play globally.',
    tags: ['voice', 'tts', 'audio'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'tools.stt',
    title: 'Send a voice message',
    category: 'tools',
    summary: 'Mic icon in the composer. Long answers from a voice memo are great for sketching ideas.',
    tags: ['voice', 'stt', 'transcription', 'mic'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'tools.code-exec',
    title: 'Run code in a safe sandbox',
    category: 'tools',
    summary: 'The agent can write and execute Python in an isolated container. Gated until the sandbox runtime is verified.',
    body: 'Code execution sits behind a gVisor + ephemeral-container sandbox. Once verified it will unlock automatically — no UI change needed.',
    tags: ['code', 'python', 'sandbox', 'interpreter'],
    state: 'gated',
    action: { kind: 'none' },
  },

  /* -------- Memory & context -------- */

  {
    id: 'memory.org',
    title: 'Teach the agent your team\'s facts',
    category: 'memory',
    summary: 'Org Memory is the shared layer every conversation reads from — company name, terminology, default tone.',
    tags: ['memory', 'org', 'team', 'context'],
    state: 'live',
    action: { kind: 'panel', tab: 'memory', label: 'Open Org Memory' },
  },
  {
    id: 'memory.about-you',
    title: 'See what the agent has learned about you',
    category: 'memory',
    summary: 'A personal-facts panel — what the agent has picked up over time, editable and erasable.',
    body: 'Built on the dialectic user-modeling pattern: every conversation adds nuance instead of starting from zero. Visible, editable, and you own the off-switch.',
    tags: ['memory', 'personal', 'profile', 'honcho'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'memory.search',
    title: 'Search every past conversation',
    category: 'memory',
    summary: 'Full-text search across every chat — message contents, not just titles.',
    tags: ['search', 'recall', 'history'],
    state: 'live',
    action: { kind: 'navigate', path: '/search', label: 'Open search' },
  },
  {
    id: 'memory.compress',
    title: 'Compress a long conversation',
    category: 'memory',
    summary: 'When you are deep in a thread, compress it to a summary the agent can carry forward without burning tokens.',
    tags: ['compress', 'context', 'tokens', 'long'],
    state: 'soon',
    action: { kind: 'none' },
  },

  /* -------- Cost & observability -------- */

  {
    id: 'cost.per-message',
    title: 'See what each turn costs',
    category: 'cost',
    summary: 'A small cost pill on every assistant reply — what the round-trip ran you, in cents.',
    tags: ['cost', 'pricing', 'transparency'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'cost.spend',
    title: 'Track your monthly spend',
    category: 'cost',
    summary: 'Dashboard of cost by day, model, and conversation. Built for "where did the money go" answers.',
    tags: ['cost', 'spend', 'analytics', 'budget'],
    state: 'live',
    action: { kind: 'panel', tab: 'costs', label: 'Open costs panel' },
  },
  {
    id: 'cost.cache',
    title: 'Watch the cache save you tokens',
    category: 'cost',
    summary: 'Prompt caching can cut costs significantly on long threads. The savings tally shows what cache is earning you.',
    tags: ['cost', 'cache', 'savings'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'cost.limit',
    title: 'Cap your spend',
    category: 'cost',
    summary: 'A hard ceiling per period. The platform refuses spend over the cap rather than surprising you with a bill.',
    body: 'The default cap is bounded-open: the platform spends up to a configured ceiling, then routes new turns to user-provided keys until the next period.',
    tags: ['cost', 'limit', 'budget', 'cap'],
    state: 'live',
    action: { kind: 'none' },
  },

  /* -------- Automation -------- */

  {
    id: 'auto.schedule',
    title: 'Schedule a recurring task in plain English',
    category: 'automation',
    summary: '"Every Monday at 9am, summarize last week\'s sales calls and post to #weekly." Cron without the cron.',
    tags: ['schedule', 'cron', 'automation', 'recurring'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'auto.annotate',
    title: 'Highlight and save important text',
    category: 'automation',
    summary: 'Select any part of an answer and save it with a note. Highlights persist; the sidebar collects them per conversation.',
    tags: ['annotate', 'highlight', 'notes', 'save'],
    state: 'live',
    action: { kind: 'none' },
    whatsNew: { date: '2026-06-15', note: 'New: persistent highlights with side-panel index.' },
  },
  {
    id: 'auto.bookmark',
    title: 'Tag and bookmark conversations',
    category: 'automation',
    summary: 'Tag a chat with a topic, then filter the sidebar by tag. Useful when you live in 50 threads at once.',
    tags: ['bookmark', 'tag', 'organize'],
    state: 'live',
    action: { kind: 'none' },
  },

  /* -------- Channels -------- */

  {
    id: 'channels.telegram',
    title: 'Chat from Telegram',
    category: 'channels',
    summary: 'Your agent on your phone — voice memos in, answers out, no app to install.',
    body: 'Same conversation history, same skills, same memory. The browser is just one face of the agent.',
    tags: ['telegram', 'mobile', 'gateway'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'channels.email',
    title: 'Send commands by email',
    category: 'channels',
    summary: 'Forward a long email, get a summary back. Reply to a thread to keep the conversation going.',
    tags: ['email', 'gateway'],
    state: 'soon',
    action: { kind: 'none' },
  },
  {
    id: 'channels.slack',
    title: 'Add a Slack bot for your team',
    category: 'channels',
    summary: 'Mention the bot in any channel — same agent, same memory, shared context with the team.',
    tags: ['slack', 'team', 'gateway'],
    state: 'soon',
    action: { kind: 'none' },
  },

  /* -------- Workspace -------- */

  {
    id: 'ws.agent-build',
    title: 'Build a custom agent',
    category: 'workspace',
    summary: 'Name it, give it instructions, attach tools and files. Save it for the team or keep it private.',
    tags: ['agent', 'build', 'custom'],
    state: 'live',
    action: { kind: 'navigate', path: '/agents', label: 'Open Agents' },
  },
  {
    id: 'ws.model-build',
    title: 'Build a custom model preset',
    category: 'workspace',
    summary: 'Pin a model, temperature, system prompt, and tools as a one-click preset.',
    tags: ['model', 'preset', 'build'],
    state: 'live',
    action: { kind: 'navigate', path: '/workspace/models', label: 'Open Models' },
  },
  {
    id: 'ws.prompts',
    title: 'Save a prompt for reuse',
    category: 'workspace',
    summary: 'Library of prompts your team can pull into any conversation. Variables supported.',
    tags: ['prompt', 'library', 'reuse', 'template'],
    state: 'live',
    action: { kind: 'navigate', path: '/prompts/new', label: 'New prompt' },
  },
  {
    id: 'ws.files',
    title: 'Attach files to a conversation',
    category: 'workspace',
    summary: 'PDFs, code, spreadsheets, images. The agent reads them and they stay in the conversation context.',
    tags: ['files', 'attach', 'upload', 'rag'],
    state: 'live',
    action: { kind: 'panel', tab: 'files', label: 'Open files panel' },
  },
  {
    id: 'ws.multi-convo',
    title: 'Run multiple conversations side by side',
    category: 'workspace',
    summary: 'Compare two models on the same prompt, or keep parallel threads in one view.',
    tags: ['multi', 'compare', 'parallel'],
    state: 'live',
    action: { kind: 'none' },
  },
];

/** Hand-curated "What's new" — pinned at the top of the panel for ~2 weeks
 *  after a meaningful ship. Scaffolded from git log; pruned to ship-worthy
 *  changes the user would actually notice. Edit as features land. */
export type WhatsNewItem = { id: string; date: string; headline: string };

export const WHATS_NEW: WhatsNewItem[] = [
  { id: 'auto.annotate',   date: '2026-06-15', headline: 'Diigo-style highlights for chat replies' },
  { id: 'cost.spend',      date: '2026-06-10', headline: 'Resizable preview rail with persistent width' },
  { id: 'ws.agent-build',  date: '2026-06-08', headline: '17 curated Agency Agents seeded into the platform' },
];
