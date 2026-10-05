import { Schema, Document } from 'mongoose';

export interface IAnnotation extends Document {
  user: string;
  tenantId?: string;
  conversationId: string;
  messageId: string;
  highlightedText: string;
  containingParagraph: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const annotationSchema: Schema<IAnnotation> = new Schema<IAnnotation>(
  {
    user: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    conversationId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, index: true },
    highlightedText: { type: String, required: true, maxlength: 8000 },
    containingParagraph: { type: String, default: '', maxlength: 16000 },
    contextBefore: { type: String, default: '', maxlength: 200 },
    contextAfter: { type: String, default: '', maxlength: 200 },
    note: { type: String, default: '', maxlength: 2000 },
  },
  { timestamps: true },
);

// List queries — newest first per owner.
annotationSchema.index({ user: 1, createdAt: -1 });
// Per-conversation list view.
annotationSchema.index({ conversationId: 1, createdAt: -1 });
// Per-message highlight injection on render.
annotationSchema.index({ messageId: 1 });

export default annotationSchema;
