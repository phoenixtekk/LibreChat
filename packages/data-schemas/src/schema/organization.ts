import { Schema, Document } from 'mongoose';

export interface IOrganization extends Document {
  orgId: string;
  name: string;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  seats: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  creditsUsd: number;
  settings: {
    defaultProvider?: string;
    defaultModel?: string;
    allowMemberKeys: boolean;
    memoryEnabled: boolean;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

const organizationSchema: Schema<IOrganization> = new Schema<IOrganization>(
  {
    orgId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    plan: { type: String, enum: ['free', 'pro', 'team', 'enterprise'], default: 'free' },
    seats: { type: Number, default: 1 },
    stripeCustomerId: { type: String, index: true, sparse: true },
    stripeSubscriptionId: String,
    creditsUsd: { type: Number, default: 0 },
    settings: {
      defaultProvider: String,
      defaultModel: String,
      allowMemberKeys: { type: Boolean, default: true },
      memoryEnabled: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

export default organizationSchema;
