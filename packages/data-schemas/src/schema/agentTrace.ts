import { Schema, Document } from 'mongoose';

export interface IAgentTraceStep {
  seq: number;
  ts: number;
  type: string;
  tool?: string;
  callId?: string;
  args?: unknown;
  output?: string;
  text?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface IAgentTrace extends Document {
  taskId: string;
  user: string;
  tenantId?: string;
  conversationId: string;
  model: string;
  provider: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  finalResponse?: string;
  error?: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  steps: IAgentTraceStep[];
  startedAt: Date;
  finishedAt?: Date;
}

const agentTraceStepSchema = new Schema<IAgentTraceStep>(
  {
    seq: { type: Number, required: true },
    ts: { type: Number, required: true },
    type: { type: String, required: true },
    tool: String,
    callId: String,
    args: Schema.Types.Mixed,
    output: String,
    text: String,
    costUsd: Number,
    inputTokens: Number,
    outputTokens: Number,
  },
  { _id: false },
);

const agentTraceSchema: Schema<IAgentTrace> = new Schema<IAgentTrace>(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    user: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    conversationId: { type: String, required: true, index: true },
    model: { type: String, default: '' },
    provider: { type: String, default: '' },
    status: { type: String, enum: ['running', 'done', 'error', 'cancelled'], default: 'running' },
    finalResponse: String,
    error: String,
    totalCostUsd: { type: Number, default: 0 },
    totalInputTokens: { type: Number, default: 0 },
    totalOutputTokens: { type: Number, default: 0 },
    steps: { type: [agentTraceStepSchema], default: [] },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
  },
  { timestamps: true },
);

agentTraceSchema.index({ user: 1, conversationId: 1, startedAt: -1 });

export default agentTraceSchema;
