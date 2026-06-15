// THE one Stripe module (see BILLING.md). Nothing outside this file imports the
// Stripe SDK or reads Stripe payload shapes. Raw webhooks are normalized into
// internal events here; entitlements.js applies them to our own data.
import Stripe from 'stripe';

let client = null;

export function stripeReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function stripe() {
  if (!stripeReady()) {
    throw new Error('stripe not configured (STRIPE_SECRET_KEY missing)');
  }
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

const PLAN_PRICES = () => ({
  pro: process.env.STRIPE_PRICE_PRO,
  team: process.env.STRIPE_PRICE_TEAM,
});

export async function createSubscriptionCheckout({ orgId, plan, successUrl, cancelUrl }) {
  const price = PLAN_PRICES()[plan];
  if (!price) {
    throw new Error(`no Stripe price configured for plan "${plan}"`);
  }
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: orgId,
    metadata: { orgId, plan },
  });
  return { url: session.url };
}

export async function createCreditsCheckout({ orgId, amountUsd, successUrl, cancelUrl }) {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    throw new Error('amountUsd must be a number between 1 and 100000');
  }
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(amount * 100),
          product_data: { name: `Analytikul credits ($${amount})` },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: orgId,
    metadata: { orgId, creditsUsd: String(amountUsd) },
  });
  return { url: session.url };
}

/** Verify + normalize a raw webhook into an internal event (or null to ignore). */
export function normalizeWebhook(rawBody, signature) {
  const event = stripe().webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  const object = event.data.object;
  const eventId = event.id;
  switch (event.type) {
    case 'checkout.session.completed': {
      const orgId = object.client_reference_id ?? object.metadata?.orgId;
      if (object.mode === 'payment') {
        return {
          type: 'credits_purchased',
          eventId,
          orgId,
          // Credit strictly from the amount Stripe actually collected, never from
          // client-supplied metadata — metadata can claim more than was paid.
          creditsUsd: object.amount_total / 100,
        };
      }
      return {
        type: 'subscription_started',
        eventId,
        orgId,
        plan: object.metadata?.plan ?? 'pro',
        customerId: object.customer,
        subscriptionId: object.subscription,
      };
    }
    case 'customer.subscription.deleted':
      return { type: 'subscription_ended', eventId, subscriptionId: object.id };
    case 'invoice.payment_failed':
      return { type: 'payment_failed', eventId, customerId: object.customer };
    default:
      return null;
  }
}
