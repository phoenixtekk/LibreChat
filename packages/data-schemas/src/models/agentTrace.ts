import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agentTraceSchema, { IAgentTrace } from '~/schema/agentTrace';

export function createAgentTraceModel(mongoose: typeof import('mongoose')): Model<IAgentTrace> {
  applyTenantIsolation(agentTraceSchema);
  return (
    mongoose.models.AgentTrace || mongoose.model<IAgentTrace>('AgentTrace', agentTraceSchema)
  );
}
