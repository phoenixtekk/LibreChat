import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import userEndpointSchema, { IUserEndpoint } from '~/schema/userEndpoint';

export function createUserEndpointModel(
  mongoose: typeof import('mongoose'),
): Model<IUserEndpoint> {
  applyTenantIsolation(userEndpointSchema);
  return (
    mongoose.models.UserEndpoint ||
    mongoose.model<IUserEndpoint>('UserEndpoint', userEndpointSchema)
  );
}
