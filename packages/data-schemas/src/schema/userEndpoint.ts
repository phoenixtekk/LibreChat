import mongoose, { Schema, Document, Types } from 'mongoose';

/** A user-defined custom LLM endpoint (BYOK).
 *
 *  Each user can register their own OpenAI-compatible endpoints. These appear
 *  ONLY in that user's model picker — they are never global. The API key is
 *  encrypted at rest (encryptV2) and stored in `apiKey` with `select: false`
 *  so it is never returned by a default query; the runtime decrypts it only
 *  when building that user's endpoints config.
 *
 *  Before any endpoint is stored, its baseURL is validated by the SSRF guard
 *  (packages/api/src/security/ssrf) so a user cannot point the platform at an
 *  internal service. */
export interface IUserEndpoint extends Document {
  userId: Types.ObjectId;
  /** Display name + endpoint key in the picker. Unique per user. */
  name: string;
  /** OpenAI-compatible base URL (e.g. https://api.example.com/v1). */
  baseURL: string;
  /** Encrypted (encryptV2) API key. `select: false` — never auto-loaded. */
  apiKey: string;
  /** Model ids the user wants to expose for this endpoint. */
  models: string[];
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const userEndpointSchema: Schema<IUserEndpoint> = new Schema<IUserEndpoint>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    baseURL: {
      type: String,
      required: true,
    },
    apiKey: {
      type: String,
      required: true,
      select: false,
    },
    models: {
      type: [String],
      default: [],
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

userEndpointSchema.index({ userId: 1, name: 1 }, { unique: true });

export default userEndpointSchema;
