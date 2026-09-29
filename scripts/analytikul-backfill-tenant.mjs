// One-off backfill: replace the legacy shared `tenantId: 'default'` (and missing
// tenantId) on Notes and AgentTraces with each document owner's real tenant —
// the user's `tenantId` if they belong to an org, else their own user id. This
// mirrors the runtime `tenantOf()` rule (api/server/routes/analytikul.js) so the
// previously shared 'default' bucket no longer leaks org-shared notes / traces
// across unrelated users.
//
// Safe to run multiple times (idempotent). Mongo only — the Postgres org memory
// and analytics rows keyed by orgId='default' are separate; re-key those with
// the matching note in docs/open-issues.md if you have shared org data there.
//
//   MONGO_URI="mongodb://127.0.0.1:27017/LibreChat" node scripts/analytikul-backfill-tenant.mjs
import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/LibreChat';
const LEGACY = new Set([null, undefined, '', 'default']);

const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const users = await db.collection('users').find({}, { projection: { tenantId: 1 } }).toArray();
const tenantOf = new Map(users.map((u) => [String(u._id), u.tenantId || String(u._id)]));
console.log(`loaded ${tenantOf.size} users`);

async function backfill(collection) {
  const col = db.collection(collection);
  const docs = await col
    .find({ $or: [{ tenantId: { $in: [...LEGACY] } }, { tenantId: { $exists: false } }] })
    .project({ user: 1, tenantId: 1 })
    .toArray();
  let updated = 0;
  for (const doc of docs) {
    const tenant = tenantOf.get(String(doc.user)) ?? String(doc.user);
    if (doc.tenantId === tenant) {
      continue;
    }
    await col.updateOne({ _id: doc._id }, { $set: { tenantId: tenant } });
    updated += 1;
  }
  console.log(`${collection}: ${docs.length} candidate(s), ${updated} updated`);
}

await backfill('notes');
await backfill('agenttraces');

await client.close();
console.log('backfill complete');
