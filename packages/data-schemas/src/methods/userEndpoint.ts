import type { Types } from 'mongoose';
import { encryptV2, decryptV2 } from '~/crypto';
import type { IUserEndpoint } from '~/schema/userEndpoint';

/** A user endpoint with the secret stripped — safe to return to the client. */
export interface UserEndpointSummary {
  id: string;
  name: string;
  baseURL: string;
  models: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/** A user endpoint with its decrypted key — for runtime config building only. */
export interface UserEndpointResolved {
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
}

export interface CreateUserEndpointInput {
  userId: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models?: string[];
}

export interface UpdateUserEndpointInput {
  name?: string;
  baseURL?: string;
  /** When present, replaces and re-encrypts the stored key. */
  apiKey?: string;
  models?: string[];
}

type LeanUserEndpoint = IUserEndpoint & { _id: Types.ObjectId };

function toSummary(doc: LeanUserEndpoint): UserEndpointSummary {
  return {
    id: String(doc._id),
    name: doc.name,
    baseURL: doc.baseURL,
    models: doc.models ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Factory that takes a mongoose instance and returns the user-endpoint methods. */
export function createUserEndpointMethods(mongoose: typeof import('mongoose')): {
  listUserEndpoints: (params: { userId: string }) => Promise<UserEndpointSummary[]>;
  getUserEndpoint: (params: {
    userId: string;
    id: string;
  }) => Promise<UserEndpointSummary | null>;
  createUserEndpoint: (params: CreateUserEndpointInput) => Promise<UserEndpointSummary>;
  updateUserEndpoint: (params: {
    userId: string;
    id: string;
    updates: UpdateUserEndpointInput;
  }) => Promise<UserEndpointSummary | null>;
  deleteUserEndpoint: (params: { userId: string; id: string }) => Promise<boolean>;
  resolveUserEndpoints: (params: { userId: string }) => Promise<UserEndpointResolved[]>;
} {
  async function listUserEndpoints(params: {
    userId: string;
  }): Promise<UserEndpointSummary[]> {
    const UserEndpoint = mongoose.models.UserEndpoint;
    const docs = (await UserEndpoint.find({ userId: params.userId })
      .sort({ name: 1 })
      .lean()) as LeanUserEndpoint[];
    return docs.map(toSummary);
  }

  async function getUserEndpoint(params: {
    userId: string;
    id: string;
  }): Promise<UserEndpointSummary | null> {
    const UserEndpoint = mongoose.models.UserEndpoint;
    const doc = (await UserEndpoint.findOne({
      _id: params.id,
      userId: params.userId,
    }).lean()) as LeanUserEndpoint | null;
    return doc ? toSummary(doc) : null;
  }

  async function createUserEndpoint(
    params: CreateUserEndpointInput,
  ): Promise<UserEndpointSummary> {
    const UserEndpoint = mongoose.models.UserEndpoint;
    const encrypted = await encryptV2(params.apiKey);
    const created = (await UserEndpoint.create({
      userId: params.userId,
      name: params.name,
      baseURL: params.baseURL,
      apiKey: encrypted,
      models: params.models ?? [],
    })) as unknown as LeanUserEndpoint;
    return toSummary(created);
  }

  async function updateUserEndpoint(params: {
    userId: string;
    id: string;
    updates: UpdateUserEndpointInput;
  }): Promise<UserEndpointSummary | null> {
    const UserEndpoint = mongoose.models.UserEndpoint;
    const { updates } = params;
    const set: Partial<IUserEndpoint> = {};
    if (typeof updates.name === 'string') {
      set.name = updates.name;
    }
    if (typeof updates.baseURL === 'string') {
      set.baseURL = updates.baseURL;
    }
    if (Array.isArray(updates.models)) {
      set.models = updates.models;
    }
    if (typeof updates.apiKey === 'string' && updates.apiKey.length > 0) {
      set.apiKey = await encryptV2(updates.apiKey);
    }
    const doc = (await UserEndpoint.findOneAndUpdate(
      { _id: params.id, userId: params.userId },
      { $set: set },
      { new: true },
    ).lean()) as LeanUserEndpoint | null;
    return doc ? toSummary(doc) : null;
  }

  async function deleteUserEndpoint(params: {
    userId: string;
    id: string;
  }): Promise<boolean> {
    const UserEndpoint = mongoose.models.UserEndpoint;
    const res = (await UserEndpoint.findOneAndDelete({
      _id: params.id,
      userId: params.userId,
    }).lean()) as LeanUserEndpoint | null;
    return res != null;
  }

  /** Returns the user's endpoints WITH decrypted keys, for building the
   *  per-user endpoints config at request time. Never expose this to clients. */
  async function resolveUserEndpoints(params: {
    userId: string;
  }): Promise<UserEndpointResolved[]> {
    const UserEndpoint = mongoose.models.UserEndpoint;
    const docs = (await UserEndpoint.find({ userId: params.userId })
      .select('+apiKey')
      .lean()) as LeanUserEndpoint[];
    const resolved: UserEndpointResolved[] = [];
    for (const doc of docs) {
      resolved.push({
        name: doc.name,
        baseURL: doc.baseURL,
        apiKey: await decryptV2(doc.apiKey),
        models: doc.models ?? [],
      });
    }
    return resolved;
  }

  return {
    listUserEndpoints,
    getUserEndpoint,
    createUserEndpoint,
    updateUserEndpoint,
    deleteUserEndpoint,
    resolveUserEndpoints,
  };
}

export type UserEndpointMethods = ReturnType<typeof createUserEndpointMethods>;
