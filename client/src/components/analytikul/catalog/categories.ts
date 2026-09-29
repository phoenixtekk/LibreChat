import type { CategoryMeta } from './types';

export const CATEGORIES: CategoryMeta[] = [
  { id: 'start',         label: 'Start here',          blurb: 'The four things worth knowing on day one.' },
  { id: 'intelligence',  label: 'Agent intelligence',  blurb: 'Skills, sub-agents, and the learning loop.' },
  { id: 'tools',         label: 'Tools & capabilities', blurb: 'What the agent can do beyond text.' },
  { id: 'memory',        label: 'Memory & context',    blurb: 'What it remembers, what it forgets, how to steer both.' },
  { id: 'cost',          label: 'Cost & observability', blurb: 'What every turn costs and where the money goes.' },
  { id: 'automation',    label: 'Automation',          blurb: 'Schedules, recurring runs, and background work.' },
  { id: 'channels',      label: 'Channels',            blurb: 'Talk to your agent from outside the browser.' },
  { id: 'workspace',     label: 'Workspace',           blurb: 'Organize conversations, models, and prompts.' },
];
