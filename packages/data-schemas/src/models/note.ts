import { Model } from 'mongoose';
import noteSchema, { INote } from '~/schema/note';

export function createNoteModel(mongoose: typeof import('mongoose')): Model<INote> {
  return mongoose.models.Note || mongoose.model<INote>('Note', noteSchema);
}
