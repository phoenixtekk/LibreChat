import { Model } from 'mongoose';
import organizationSchema, { IOrganization } from '~/schema/organization';

export function createOrganizationModel(
  mongoose: typeof import('mongoose'),
): Model<IOrganization> {
  return (
    mongoose.models.Organization ||
    mongoose.model<IOrganization>('Organization', organizationSchema)
  );
}
