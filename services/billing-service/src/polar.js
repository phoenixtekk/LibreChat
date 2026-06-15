// THE one Polar module (see BILLING.md). Polar is the Merchant of Record.
// Nothing outside this file imports the Polar SDK or reads Polar payload shapes.
// Raw webhooks are verified (standard-webhooks spec) and normalized into the
// same internal events stripe.js emits; entitlements.js applies them.
import crypto from 'node:crypto';

const API = process.env.POLAR_API_BASE ?? 'https://api.polar.sh/v1';

export function polarReady() {
  return Boolean(process.env.POLAR_ACCESS_TOKEN);
}

/** plan+interval -> Polar product id, from env. */
const PRODUCTS = () => ({
  pro_month: process.env.POLAR_PRODUCT_PRO_MONTH,
  pro_year: process.env.POLAR_PRODUCT_PRO_YEAR,
  team_month: process.env.POLAR_PRODUCT_TEAM_MONTH,
  team_year: process.env.POLAR_PRODUCT_TEAM_YEAR,
});

async function polarFetch(path, options = {}) {
  if (!polarReady()) {
    throw new Error('polar not configured (POLAR_ACCESS_TOKEN missing)');
  }
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`polar ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function createSubscriptionCheckout({
  orgId,
  plan,
  interval = 'month',
  successUrl,
  cancelUrl: _cancelUrl,
}) {
  const key = `${plan}_${interval}`;
  const productId = PRODUCTS()[key];
  if (!productId) {
    throw new Error(`no Polar product configured for "${key}"`);
  }
  const checkout = await polarFetch('/checkouts/', {
    method: 'POST',
    body: JSON.stringify({
      products: [productId],
      success_url: successUrl,
      metadata: { orgId, plan, interval },
    }),
  });
  return { url: checkout.url };
}

export async function createCreditsCheckout() {
  throw new Error('credits checkout is not implemented for Polar yet');
}

/** Verify a standard-webhooks signature (Polar's scheme) over the raw body. */
function verifySignature(rawBody, headers, secret) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!id || !timestamp || !signatureHeader) {
    throw new Error('missing webhook signature headers');
  }
  // Replay protection (standard-webhooks): reject events outside a 5-minute skew.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60 * 1000) {
    throw new Error('polar webhook timestamp outside tolerance');
  }
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected);
  const ok = signatureHeader.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) {
      return false;
    }
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!ok) {
    throw new Error('polar webhook signature verification failed');
  }
}

/** Verify + normalize a raw webhook into an internal event (or null to ignore). */
export function normalizeWebhook(rawBody, headers) {
  verifySignature(rawBody, headers, process.env.POLAR_WEBHOOK_SECRET);
  const event = JSON.parse(rawBody.toString('utf8'));
  const data = event.data ?? {};
  const orgId = data.metadata?.orgId ?? data.checkout?.metadata?.orgId;
  const plan = data.metadata?.plan ?? data.checkout?.metadata?.plan ?? 'pro';
  switch (event.type) {
    case 'subscription.created':
    case 'subscription.active':
      return {
        type: 'subscription_started',
        orgId,
        plan,
        customerId: data.customer_id,
        subscriptionId: data.id,
      };
    case 'subscription.canceled':
    case 'subscription.revoked':
      return { type: 'subscription_ended', subscriptionId: data.id };
    case 'order.refunded':
      return { type: 'payment_failed', customerId: data.customer_id };
    default:
      return null;
  }
}
