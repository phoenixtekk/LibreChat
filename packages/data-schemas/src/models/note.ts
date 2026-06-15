import { Model } from 'mongoose';
import noteSchema, { INote } from '~/schema/note';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

// Defense-in-depth: backstop the route-level tenant filters so a future query
// that forgets to scope by tenant/owner still can't read across tenants.
applyTenantIsolation(noteSchema);

export function createNoteModel(mongoose: typeof import('mongoose')): Model<INote> {
  return mongoose.models.Note || mongoose.model<INote>('Note', noteSchema);
}
