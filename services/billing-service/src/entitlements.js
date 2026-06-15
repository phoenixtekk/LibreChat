// Applies normalized billing events to our own entitlement store (the
// Organization collection in Mongo). Runtime authorization never reads Stripe.
import { MongoClient } from 'mongodb';

if (!process.env.MONGO_URI) {
  throw new Error('MONGO_URI is required (no default — refusing to start)');
}
const client = new MongoClient(process.env.MONGO_URI);
let orgs = null;

async function collection() {
  if (orgs == null) {
    await client.connect();
    orgs = client.db().collection('organizations');
  }
  return orgs;
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
