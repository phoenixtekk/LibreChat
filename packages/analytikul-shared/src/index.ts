/**
 * Shared Analytikul types — the contract between the Express backend,
 * the Hermes adapter, the React client, and the analytics pipeline.
 */

export type AgentEventType =
  | 'text_chunk'
  | 'tool_start'
  | 'tool_output'
  | 'cost_event'
  | 'done'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  sessionKey: string; // `${tenantId}:${userId}:${conversationId}`
  timestamp: string; // ISO 8601
  payload: TextChunk | ToolStart | ToolOutput | CostEvent | DoneEvent | ErrorEvent;
}

export interface TextChunk {
  text: string;
}

export interface ToolStart {
  stepId: string;
  tool: string;
  inputSummary: string;
}

export type PreviewRenderType =
  | 'screenshot'
  | 'html'
  | 'file'
  | 'json'
  | 'terminal'
  | 'markdown';

export interface ToolOutput {
  stepId: string;
  tool: string;
  renderType: PreviewRenderType;
  output: unknown;
  durationMs: number;
}

export interface CostEvent {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  orgId: string;
  userId: string;
  conversationId: string;
}

export interface DoneEvent {
  totalCostUsd: number;
  totalTokens: number;
  steps: number;
}

export interface ErrorEvent {
  code: string;
  message: string;
}

export type PlanTier = 'free' | 'pro' | 'team';

export interface TierLimits {
  concurrentAgentSessions: number;
  managedGatewayPlatforms: number;
  orgMemoryEnabled: boolean;
  skillRollbackEnabled: boolean;
}

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  free: {
    concurrentAgentSessions: 2,
    managedGatewayPlatforms: 0,
    orgMemoryEnabled: false,
    skillRollbackEnabled: false,
  },
  pro: {
    concurrentAgentSessions: 5,
    managedGatewayPlatforms: 3,
    orgMemoryEnabled: false,
    skillRollbackEnabled: true,
  },
  team: {
    concurrentAgentSessions: Number.POSITIVE_INFINITY,
    managedGatewayPlatforms: 16,
    orgMemoryEnabled: true,
    skillRollbackEnabled: true,
  },
};
