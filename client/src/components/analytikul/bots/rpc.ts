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
