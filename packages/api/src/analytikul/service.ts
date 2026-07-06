import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AgentRunBody, AdapterRunRequest, AgentStreamEvent } from './types';

const ADAPTER_URL = () => process.env.HERMES_ADAPTER_URL ?? 'http://hermes-adapter:8001';
const ANALYTICS_URL = () => process.env.ANALYTICS_SERVICE_URL ?? 'http://localhost:8011';

/** Shared secret for calls into the internal services. */
const internalHeaders = (extra: Record<string, string> = {}): Record<string, string> => {
  const token = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  return token ? { ...extra, 'x-internal-token': token } : extra;
};

export interface BudgetCheck {
  allowed: boolean;
  exceeded: boolean;
  scope?: 'org' | 'user';
  period?: string;
  spent?: number;
  limit?: number;
  hard?: boolean;
  /** True when the budget could not be verified (analytics unreachable). The
   * caller must fail closed for platform-key runs rather than spend uncapped. */
  degraded?: boolean;
}

/**
 * Fail-open by default (BYOK users proceed), but flags `degraded` so callers can
 * fail closed for platform-key runs when the budget service is unreachable.
 */
export async function checkBudget(userId: string, orgId = 'default'): Promise<BudgetCheck> {
  try {
    const res = await fetch(
      `${ANALYTICS_URL()}/budgets/check?userId=${encodeURIComponent(userId)}&orgId=${encodeURIComponent(orgId)}`,
      { headers: internalHeaders(), signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) {
      return { allowed: true, exceeded: false, degraded: true };
    }
    return (await res.json()) as BudgetCheck;
  } catch {
    return { allowed: true, exceeded: false, degraded: true };
  }
}

export interface AgentRunContext {
  userId: string;
  tenantId?: string;
  apiKey?: string;
}

export async function startAgentRun(
  body: AgentRunBody,
  ctx: AgentRunContext,
): Promise<{ taskId: string }> {
  const payload: AdapterRunRequest = {
    message: body.message,
    tenant_id: ctx.tenantId ?? 'default',
    user_id: ctx.userId,
    conversation_id: body.conversationId,
    model: body.model ?? '',
    provider: body.provider ?? 'openrouter',
    api_key: ctx.apiKey ?? '',
    base_url: body.baseUrl ?? 'https://openrouter.ai/api/v1',
    enabled_toolsets: body.enabledToolsets,
    disabled_toolsets: body.disabledToolsets,
  };
  const res = await fetch(`${ADAPTER_URL()}/run`, {
    method: 'POST',
    headers: internalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await safeDetail(res);
    throw new AdapterError(res.status, detail);
  }
  const data = (await res.json()) as { task_id: string };
  return { taskId: data.task_id };
}

export async function cancelAgentRun(taskId: string): Promise<boolean> {
  const res = await fetch(`${ADAPTER_URL()}/cancel/${encodeURIComponent(taskId)}`, {
    method: 'POST',
    headers: internalHeaders(),
  });
  return res.ok;
}

export async function getAgentTools(): Promise<unknown> {
  const res = await fetch(`${ADAPTER_URL()}/tools`, { headers: internalHeaders() });
  if (!res.ok) {
    throw new AdapterError(res.status, await safeDetail(res));
  }
  return res.json();
}

/**
 * Start a run and collect it to completion server-side (no client streaming).
 * Used for single-turn utility calls like Notes AI actions — still metered,
 * budgeted, and traced like any other run.
 */
export async function collectAgentRun(
  body: AgentRunBody,
  ctx: AgentRunContext,
  timeoutMs = 120_000,
): Promise<string> {
  const { taskId } = await startAgentRun(body, ctx);
  const upstream = await fetch(`${ADAPTER_URL()}/stream/${encodeURIComponent(taskId)}`, {
    headers: internalHeaders({ Accept: 'text/event-stream' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!upstream.ok || upstream.body == null) {
    throw new AdapterError(upstream.status, await safeDetail(upstream));
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (dataLine == null) {
        continue;
      }
      const event = JSON.parse(dataLine.slice(6)) as AgentStreamEvent;
      if (event.type === 'done') {
        return event.final_response ?? '';
      }
      if (event.type === 'error') {
        throw new AdapterError(500, event.message ?? 'agent error');
      }
    }
  }
  throw new AdapterError(500, 'stream ended without result');
}

/**
 * Pipe the adapter's SSE stream for a task to an Express response, invoking
 * onEvent for each parsed event (used for trace persistence).
 */
export async function pipeAgentStream(
  taskId: string,
  res: Response,
  onEvent?: (event: AgentStreamEvent) => void,
): Promise<void> {
  const upstream = await fetch(`${ADAPTER_URL()}/stream/${encodeURIComponent(taskId)}`, {
    headers: internalHeaders({ Accept: 'text/event-stream' }),
  });
  if (!upstream.ok || upstream.body == null) {
    throw new AdapterError(upstream.status, await safeDetail(upstream));
  }

  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const abort = () => {
    reader.cancel().catch(() => undefined);
  };
  res.on('close', abort);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      if (!res.writableEnded) {
        res.write(chunk);
        if (typeof (res as Response & { flush?: () => void }).flush === 'function') {
          (res as Response & { flush: () => void }).flush();
        }
      }
      buffer = drainEvents(buffer, onEvent);
    }
  } catch (error) {
    logger.warn(`[analytikul] agent stream ${taskId} interrupted: ${error}`);
  } finally {
    res.off('close', abort);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function drainEvents(buffer: string, onEvent?: (event: AgentStreamEvent) => void): string {
  if (onEvent == null) {
    return '';
  }
  const frames = buffer.split('\n\n');
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (dataLine == null) {
      continue;
    }
    try {
      onEvent(JSON.parse(dataLine.slice(6)) as AgentStreamEvent);
    } catch {
      /* malformed frame — forwarded raw to the client regardless */
    }
  }
  return remainder;
}

async function safeDetail(res: { text: () => Promise<string> }): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      return parsed.detail ?? text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return 'adapter unreachable';
  }
}

export class AdapterError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

const BILLING_URL = () => process.env.BILLING_SERVICE_URL ?? 'http://localhost:8013';

export interface VaultKeyInfo {
  provider: string;
  key_hint: string;
  created_at: string;
}

/** Resolve the user's vaulted key for a provider; null if none stored. */
export async function getVaultedKey(
  userId: string,
  provider: string,
  orgId = 'default',
): Promise<string | null> {
  try {
    const res = await fetch(`${BILLING_URL()}/vault/key`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ orgId, userId, provider }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { apiKey?: string };
    return body.apiKey ?? null;
  } catch {
    return null;
  }
}

export async function listVaultKeys(userId: string, orgId = 'default'): Promise<VaultKeyInfo[]> {
  const res = await fetch(
    `${BILLING_URL()}/vault/keys?userId=${encodeURIComponent(userId)}&orgId=${encodeURIComponent(orgId)}`,
    { headers: internalHeaders(), signal: AbortSignal.timeout(4000) },
  );
  if (!res.ok) {
    throw new AdapterError(res.status, 'vault unavailable');
  }
  const body = (await res.json()) as { keys: VaultKeyInfo[] };
  return body.keys;
}

export async function putVaultKey(
  userId: string,
  provider: string,
  apiKey: string,
  orgId = 'default',
): Promise<{ provider: string; hint: string }> {
  const res = await fetch(`${BILLING_URL()}/vault/keys`, {
    method: 'PUT',
    headers: internalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ orgId, userId, provider, apiKey }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    throw new AdapterError(res.status, 'vault rejected key');
  }
  const body = (await res.json()) as { key: { provider: string; hint: string } };
  return body.key;
}

export async function deleteVaultKey(
  userId: string,
  provider: string,
  orgId = 'default',
): Promise<boolean> {
  const res = await fetch(`${BILLING_URL()}/vault/keys`, {
    method: 'DELETE',
    headers: internalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ orgId, userId, provider }),
    signal: AbortSignal.timeout(4000),
  });
  return res.ok;
}

/* ── Agent Power Tools entitlement policy ──────────────────────────────────────
 * Two layers gate the highest-risk agent toolsets:
 *  - HARD_FLOORED: off for EVERYONE regardless of plan, until per-task sandbox/VM
 *    isolation ships (these run host commands or drive a live desktop).
 *  - PLAN_GATED: allowed only at/above a minimum plan tier (BYO-credential model).
 * Replaces the old static global floor in the /agent/run route.
 */
export const HARD_FLOORED_TOOLSETS = ['terminal', 'computer_use'] as const;

const TIER_RANK: Record<string, number> = {
  free: 0,
  pro: 1,
  team: 2,
  business: 3,
  enterprise: 4,
};

/** toolset → minimum plan tier required. code_execution/file are Pro+ (sandboxed compute). */
export const PLAN_GATED_TOOLSETS: Record<string, string> = {
  code_execution: 'pro',
  file: 'pro',
  messaging: 'team',
  homeassistant: 'team',
};

/** Toolsets the "Agent Power Tools" add-on unlocks (on a Pro+ base). */
const ADDON_TOOLSETS = ['messaging', 'homeassistant'];

/**
 * Toolsets to strip = the hard floor + any plan-gated tool the plan can't reach,
 * EXCEPT add-on tools when the org holds the Agent Power Tools add-on (Pro+ base).
 */
export function forbiddenToolsetsForPlan(
  plan: string | null | undefined,
  powerTools = false,
): string[] {
  const rank = TIER_RANK[(plan ?? 'free').toLowerCase()] ?? 0;
  const addonActive = powerTools && rank >= TIER_RANK.pro;
  const gated = Object.entries(PLAN_GATED_TOOLSETS)
    .filter(([toolset, minTier]) => {
      const reaches = rank >= (TIER_RANK[minTier] ?? Number.MAX_SAFE_INTEGER);
      const viaAddon = addonActive && ADDON_TOOLSETS.includes(toolset);
      return !reaches && !viaAddon;
    })
    .map(([toolset]) => toolset);
  return [...HARD_FLOORED_TOOLSETS, ...gated];
}

export interface OrgEntitlements {
  plan: string;
  powerTools: boolean;
}

/** Read an org's plan + add-ons from billing; defaults to free/no-addon (least privilege) on error. */
export async function getOrgEntitlements(orgId = 'default'): Promise<OrgEntitlements> {
  try {
    const res = await fetch(`${BILLING_URL()}/org?orgId=${encodeURIComponent(orgId)}`, {
      headers: internalHeaders(),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { plan: 'free', powerTools: false };
    }
    const body = (await res.json()) as {
      org?: { plan?: string; addons?: { powerTools?: boolean } } | null;
    };
    return {
      plan: body.org?.plan ?? 'free',
      powerTools: Boolean(body.org?.addons?.powerTools),
    };
  } catch {
    return { plan: 'free', powerTools: false };
  }
}

/** Back-compat thin wrapper. */
export async function getOrgPlan(orgId = 'default'): Promise<string> {
  return (await getOrgEntitlements(orgId)).plan;
}

/** Create a Stripe Checkout session for a plan/add-on via the billing service. */
export async function createCheckout(args: {
  orgId: string;
  plan: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const res = await fetch(`${BILLING_URL()}/checkout/subscription`, {
    method: 'POST',
    headers: internalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `billing checkout failed (${res.status})`);
  }
  return (await res.json()) as { url: string };
}
