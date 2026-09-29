// Typed client for the admin-gated Bots broker (POST /api/analytikul/bots/rpc), which forwards
// allow-listed JSON-RPC methods to the Hermes gateway. Shapes mirror the v0.21.5 contracts in
// docs/hermes-0.21.5-rpc-and-adapter-map.md §2.

export interface BotCanonicalSession {
  id: string;
  resolved_id?: string;
  title: string;
  preview: string;
  message_count: number;
}

export interface BotProfile {
  name: string;
  path: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  description: string;
  display_name: string;
  skill_count: number;
  role: string;
  has_avatar: boolean;
  ui_meta?: Record<string, unknown>;
  canonical_session?: BotCanonicalSession;
}

export interface ProfilesListResult {
  profiles: BotProfile[];
  bot_mode_protocol: boolean;
}

export interface BotSkill {
  name: string;
  enabled: boolean;
}

export interface BotToolset {
  name: string;
  label: string;
  description: string;
  tool_count: number;
  enabled: boolean;
}

export interface ProfileDescribeResult {
  name: string;
  description: string;
  soul: string;
  model: { provider: string; default: string };
  skills: BotSkill[];
  toolsets: BotToolset[];
  mcp_servers: { name: string; enabled: boolean; transport: string }[];
}

export interface BotsHealth {
  configured: boolean;
  reachable: boolean;
}

/** A Bot is a Hermes profile carrying the `hermes-bots` ui_meta marker. */
export function isBot(profile: BotProfile): boolean {
  return profile.ui_meta != null && 'hermes-bots' in profile.ui_meta;
}

/**
 * Invoke one broker RPC method. Throws with the server message on non-2xx.
 * @param method allow-listed method name (e.g. `profiles.list`)
 */
export async function botsRpc<T>(
  method: string,
  params: Record<string, unknown>,
  token: string | undefined,
): Promise<T> {
  const res = await fetch('/api/analytikul/bots/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  });
  const body = (await res.json().catch(() => null)) as { result?: T; message?: string } | null;
  if (!res.ok) {
    throw new Error(body?.message ?? `bots rpc failed (${res.status})`);
  }
  return body?.result as T;
}

export async function botsHealth(token: string | undefined): Promise<BotsHealth> {
  const res = await fetch('/api/analytikul/bots/health', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as BotsHealth;
}

// ---- S4: routines (cron.manage), rooms (groups.*), chat (session.resume + prompt.submit) ----

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt?: string;
  enabled?: boolean;
  state?: string;
  next_run_at?: number | null;
  deliver?: string;
}

export interface CronListResult {
  success: boolean;
  count: number;
  jobs: CronJob[];
}

export interface Room {
  room_id: string;
  name: string;
  members: string[];
  created_at: number;
  disbanded_at?: number | null;
  authority_epoch?: number;
}

export interface RoomsListResult {
  rooms: Room[];
  next_offset?: number | null;
}

export interface ChatMessage {
  role: string;
  content: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

export interface SessionResumeResult {
  session_id: string;
  resumed?: string;
  message_count: number;
  messages: ChatMessage[];
}

// ---- S5: bot metadata carried in ui_meta['hermes-bots'] ----

export interface BotMeta {
  title?: string;
  shared_with_org?: boolean;
}

/** Read the `hermes-bots` ui_meta block off a profile, if present. */
export function botMeta(profile: BotProfile): BotMeta {
  const raw = profile.ui_meta?.['hermes-bots'];
  return raw != null && typeof raw === 'object' ? (raw as BotMeta) : {};
}

export function isSharedWithOrg(profile: BotProfile): boolean {
  return botMeta(profile).shared_with_org === true;
}
