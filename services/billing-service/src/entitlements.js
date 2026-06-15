// Applies normalized billing events to our own entitlement store (the
// Organization collection in Mongo). Runtime authorization never reads Stripe.
import { MongoClient, ObjectId } from 'mongodb';

if (!process.env.MONGO_URI) {
  throw new Error('MONGO_URI is required (no default — refusing to start)');
}
const client = new MongoClient(process.env.MONGO_URI);
let orgs = null;

// Per-plan LibreChat balance top-up granted on subscription (tokenCredits;
// 1000 = $0.001). 0/unset = no grant (e.g. true-BYOK plans).
const PLAN_GRANTS = {
  pro: Number(process.env.PLAN_CREDIT_GRANT_PRO ?? 0),
  team: Number(process.env.PLAN_CREDIT_GRANT_TEAM ?? 0),
};

async function collection() {
  if (orgs == null) {
    await client.connect();
    orgs = client.db().collection('organizations');
  }
  return orgs;
}

/**
 * Grant a plan's balance top-up to the org's members. An org member is a user
 * whose tenantId == orgId; for a solo subscriber the org id IS their user id, so
 * we also match _id == orgId. Idempotent at the event level (webhook dedupe in
 * index.js ensures each provider event applies once).
 */
async function grantPlanBalance(orgId, plan, log) {
  const grant = PLAN_GRANTS[plan];
  if (!grant || grant <= 0) {
    return;
  }
  const db = client.db();
  const or = [{ tenantId: orgId }];
  if (ObjectId.isValid(orgId)) {
    or.push({ _id: new ObjectId(orgId) });
  }
  const users = await db.collection('users').find({ $or: or }, { projection: { _id: 1 } }).toArray();
  if (users.length === 0) {
    log(`no users found for org ${orgId}; balance top-up skipped`);
    return;
  }
  const balances = db.collection('balances');
  for (const user of users) {
    await balances.updateOne(
      { user: user._id },
      { $inc: { tokenCredits: grant } },
      { upsert: true },
    );
  }
  log(`granted ${grant} tokenCredits to ${users.length} user(s) in org ${orgId} (plan ${plan})`);
}

export async function applyEvent(event, log) {
  const col = await collection();
  switch (event.type) {
    case 'credits_purchased':
      await col.updateOne(
        { orgId: event.orgId },
        { $inc: { creditsUsd: event.creditsUsd }, $setOnInsert: { name: event.orgId, plan: 'free', seats: 1 } },
        { upsert: true },
      );
      log(`+$${event.creditsUsd} credits -> org ${event.orgId}`);
      break;
    case 'subscription_started':
      await col.updateOne(
        { orgId: event.orgId },
        {
          $set: {
            plan: event.plan,
            billingCustomerId: event.customerId,
            billingSubscriptionId: event.subscriptionId,
          },
          $setOnInsert: { name: event.orgId, seats: 1, creditsUsd: 0 },
        },
        { upsert: true },
      );
      log(`org ${event.orgId} -> plan ${event.plan}`);
      await grantPlanBalance(event.orgId, event.plan, log);
      break;
    case 'subscription_ended':
      await col.updateOne(
        { billingSubscriptionId: event.subscriptionId },
        { $set: { plan: 'free' }, $unset: { billingSubscriptionId: '' } },
      );
      log(`subscription ${event.subscriptionId} ended -> free`);
      break;
    case 'payment_failed':
      log(`payment failed for customer ${event.customerId} (alerting lands with admin panel)`);
      break;
    default:
      break;
  }
}

export async function getOrg(orgId) {
  const col = await collection();
  return col.findOne({ orgId });
}
