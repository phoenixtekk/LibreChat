import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AgentRunBody, AdapterRunRequest, AgentStreamEvent } from './types';

const ADAPTER_URL = () => process.env.HERMES_ADAPTER_URL ?? 'http://hermes-adapter:8001';
const ANALYTICS_URL = () => process.env.ANALYTICS_SERVICE_URL ?? 'http://localhost:8011';

export interface BudgetCheck {
  allowed: boolean;
  exceeded: boolean;
  scope?: 'org' | 'user';
  period?: string;
  spent?: number;
  limit?: number;
  hard?: boolean;
}

/** Fail-open: if the analytics service is unreachable, runs proceed. */
export async function checkBudget(userId: string, orgId = 'default'): Promise<BudgetCheck> {
  try {
    const res = await fetch(
      `${ANALYTICS_URL()}/budgets/check?userId=${encodeURIComponent(userId)}&orgId=${encodeURIComponent(orgId)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) {
      return { allowed: true, exceeded: false };
    }
    return (await res.json()) as BudgetCheck;
  } catch {
    return { allowed: true, exceeded: false };
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
    headers: { 'Content-Type': 'application/json' },
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
  });
  return res.ok;
}

export async function getAgentTools(): Promise<unknown> {
  const res = await fetch(`${ADAPTER_URL()}/tools`);
  if (!res.ok) {
    throw new AdapterError(res.status, await safeDetail(res));
  }
  return res.json();
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
    headers: { Accept: 'text/event-stream' },
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
