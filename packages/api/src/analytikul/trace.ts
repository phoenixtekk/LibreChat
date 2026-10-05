import { logger } from '@librechat/data-schemas';
import type { Model } from 'mongoose';
import type { IAgentTrace } from '@librechat/data-schemas';
import type { AgentStreamEvent } from './types';

const PERSISTED_TYPES = new Set([
  'tool_start',
  'tool_complete',
  'cost_event',
  'step',
  'status',
  'done',
  'error',
]);
const MAX_STEPS = 500;

/**
 * Accumulates a task's stream events and flushes the trace document once the
 * task reaches a terminal state. text_chunk events are excluded (the final
 * response captures them); tool/cost/step events form the inspectable trace.
 */
export function createTraceRecorder(
  AgentTrace: Model<IAgentTrace>,
  init: {
    taskId: string;
    userId: string;
    tenantId?: string;
    conversationId: string;
    model: string;
    provider: string;
  },
): { onEvent: (event: AgentStreamEvent) => void } {
  const steps: IAgentTrace['steps'] = [];
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let flushed = false;

  const onEvent = (event: AgentStreamEvent): void => {
    if (!PERSISTED_TYPES.has(event.type)) {
      return;
    }
    if (event.type === 'cost_event') {
      totalCostUsd += event.cost_usd ?? 0;
      totalInputTokens += event.input_tokens ?? 0;
      totalOutputTokens += event.output_tokens ?? 0;
    }
    if (steps.length < MAX_STEPS) {
      steps.push({
        seq: event.seq,
        ts: event.ts,
        type: event.type,
        tool: event.tool,
        callId: event.call_id,
        args: event.args,
        output: event.output,
        costUsd: event.cost_usd ?? undefined,
        inputTokens: event.input_tokens,
        outputTokens: event.output_tokens,
      });
    }
    if (event.type === 'done' || event.type === 'error') {
      void flush(event);
    }
  };

  const flush = async (terminal: AgentStreamEvent): Promise<void> => {
    if (flushed) {
      return;
    }
    flushed = true;
    try {
      await AgentTrace.updateOne(
        { taskId: init.taskId },
        {
          $set: {
            user: init.userId,
            tenantId: init.tenantId,
            conversationId: init.conversationId,
            model: init.model,
            provider: init.provider,
            status:
              terminal.type === 'error'
                ? 'error'
                : terminal.interrupted === true
                  ? 'cancelled'
                  : 'done',
            finalResponse: terminal.final_response,
            error: terminal.message,
            totalCostUsd,
            totalInputTokens,
            totalOutputTokens,
            steps,
            finishedAt: new Date(),
          },
          $setOnInsert: { startedAt: new Date() },
        },
        { upsert: true },
      );
    } catch (error) {
      logger.error(`[analytikul] failed to persist trace ${init.taskId}: ${error}`);
    }
  };

  return { onEvent };
}
