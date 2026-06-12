import { Schema, Document } from 'mongoose';

export interface INote extends Document {
  user: string;
  tenantId?: string;
  title: string;
  content: string;
  sharedWithOrg: boolean;
  pinnedBy: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const noteSchema: Schema<INote> = new Schema<INote>(
  {
    user: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    title: { type: String, default: 'Untitled' },
    content: { type: String, default: '' },
    sharedWithOrg: { type: Boolean, default: false },
    pinnedBy: { type: [String], default: [], index: true },
  },
  { timestamps: true },
);

noteSchema.index({ user: 1, updatedAt: -1 });
noteSchema.index({ title: 'text', content: 'text' });

export default noteSchema;
