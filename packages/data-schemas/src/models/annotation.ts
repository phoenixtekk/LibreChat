import { Model } from 'mongoose';
import annotationSchema, { IAnnotation } from '~/schema/annotation';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

// Defense-in-depth: backstop the route-level tenant filters so a future query
// that forgets to scope by tenant/owner still can't read across tenants.
applyTenantIsolation(annotationSchema);

export function createAnnotationModel(
  mongoose: typeof import('mongoose'),
): Model<IAnnotation> {
  return mongoose.models.Annotation || mongoose.model<IAnnotation>('Annotation', annotationSchema);
}
