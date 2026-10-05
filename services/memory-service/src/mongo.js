// Read-only MongoDB access to LibreChat conversation messages. The memory engine reads message
// deltas to build episodes; it never writes to the app's Mongo. memory-service already shares the
// analytikul_default network with the mongodb container.
import { MongoClient, ObjectId } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://mongodb:27017/LibreChat';

let clientPromise = null;
function database() {
  clientPromise ??= new MongoClient(MONGO_URI, { maxPoolSize: 4 }).connect();
  return clientPromise.then((c) => c.db());
}

/** New messages in a conversation after a cursor (Mongo ObjectId hex), oldest-first. */
export async function readNewMessages({ conversationId, afterId, limit = 200 }) {
  const db = await database();
  const query = { conversationId };
  if (afterId) {
    query._id = { $gt: new ObjectId(afterId) };
  }
  return db
    .collection('messages')
    .find(query, { projection: { text: 1, isCreatedByUser: 1, createdAt: 1 } })
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();
}

/** Recent conversations (for bounded backfill): one row per conversation touched within `days`. */
export async function recentConversations({ days = 7, limit = 25 }) {
  const db = await database();
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .collection('messages')
    .aggregate([
      { $match: { createdAt: { $gte: since }, conversationId: { $ne: null }, user: { $ne: null } } },
      { $group: { _id: '$conversationId', user: { $first: '$user' }, lastAt: { $max: '$createdAt' } } },
      { $sort: { lastAt: -1 } },
      { $limit: limit },
    ])
    .toArray();
  return rows.map((r) => ({ conversationId: r._id, userId: String(r.user) }));
}

/** Render a message list as a bounded transcript for the extractor. */
export function toTranscript(messages, maxChars = 6000) {
  const lines = messages.map((m) => `${m.isCreatedByUser ? 'User' : 'Assistant'}: ${(m.text ?? '').trim()}`);
  let text = lines.join('\n');
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars); // keep the most recent content
  }
  return text;
}
