// Analytikul billing-service — BYOK vault + Stripe checkout/webhooks + entitlements.
// Internal-only: never publicly proxied; only the Express backend calls it
// (except /webhooks/stripe which Express forwards raw).
import http from 'node:http';
import crypto from 'node:crypto';
import { migrateVault, putKey, getKey, listKeys, deleteKey, claimEvent } from './vault.js';
import {
  stripeReady,
  normalizeWebhook,
  createSubscriptionCheckout,
  createCreditsCheckout,
} from './stripe.js';
import {
  polarReady,
  normalizeWebhook as polarNormalizeWebhook,
  createSubscriptionCheckout as polarCreateSubscriptionCheckout,
  createCreditsCheckout as polarCreateCreditsCheckout,
} from './polar.js';
import { applyEvent, getOrg } from './entitlements.js';

const PORT = process.env.BILLING_PORT || 8013;
const PROVIDER = process.env.BILLING_PROVIDER ?? 'polar';
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const MAX_BODY = 256 * 1024;
const log = (msg) => console.log(`[billing] ${msg}`);

// Constant-time check of the internal service token. Webhooks are exempt (they
// authenticate via provider signature); /health is public.
function authorized(req) {
  if (!INTERNAL_TOKEN) {
    return true;
  }
  const provided = req.headers['x-internal-token'];
  if (typeof provided !== 'string' || provided.length !== INTERNAL_TOKEN.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(INTERNAL_TOKEN));
}

const subscriptionCheckout =
  PROVIDER === 'polar' ? polarCreateSubscriptionCheckout : createSubscriptionCheckout;
const creditsCheckout = PROVIDER === 'polar' ? polarCreateCreditsCheckout : createCreditsCheckout;

await migrateVault();
log(`vault schema ready; provider: ${PROVIDER}; stripe: ${stripeReady()}; polar: ${polarReady()}`);
if (!INTERNAL_TOKEN) {
  log('WARNING: INTERNAL_SERVICE_TOKEN unset — internal endpoints are unauthenticated. Set it in prod.');
}

async function readBody(req, raw = false) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const err = new Error('request body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return raw ? buffer : JSON.parse(buffer.toString() || '{}');
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    try {
      if (url.pathname === '/health') {
        return send(200, { status: 'ok', service: 'billing-service', stripe: stripeReady() });
      }

      // All non-health, non-webhook routes require the internal service token.
      const isWebhook = url.pathname.startsWith('/webhooks/');
      if (!isWebhook && !authorized(req)) {
        return send(401, { error: 'unauthorized' });
      }

      if (url.pathname === '/vault/keys' && req.method === 'GET') {
        const orgId = url.searchParams.get('orgId') ?? 'default';
        const userId = url.searchParams.get('userId');
        if (!userId) {
          return send(400, { error: 'userId required' });
        }
        return send(200, { keys: await listKeys({ orgId, userId }) });
      }

      if (url.pathname === '/vault/keys' && req.method === 'PUT') {
        const body = await readBody(req);
        const { orgId = 'default', userId, provider, apiKey } = body;
        if (!userId || !provider || !apiKey) {
          return send(400, { error: 'userId, provider, apiKey required' });
        }
        return send(200, { key: await putKey({ orgId, userId, provider, apiKey }) });
      }

      if (url.pathname === '/vault/keys' && req.method === 'DELETE') {
        const body = await readBody(req);
        const { orgId = 'default', userId, provider } = body;
        const deleted = await deleteKey({ orgId, userId, provider });
        return send(deleted ? 200 : 404, { deleted });
      }

      if (url.pathname === '/vault/key' && req.method === 'POST') {
        const body = await readBody(req);
        const { orgId = 'default', userId, provider } = body;
        const apiKey = await getKey({ orgId, userId, provider });
        return send(apiKey == null ? 404 : 200, apiKey == null ? { error: 'no key' } : { apiKey });
      }

      if (url.pathname === '/checkout/subscription' && req.method === 'POST') {
        const body = await readBody(req);
        return send(200, await subscriptionCheckout(body));
      }

      if (url.pathname === '/checkout/credits' && req.method === 'POST') {
        const body = await readBody(req);
        return send(200, await creditsCheckout(body));
      }

      if (url.pathname === '/webhooks/stripe' && req.method === 'POST') {
        const raw = await readBody(req, true);
        const event = normalizeWebhook(raw, req.headers['stripe-signature']);
        if (event != null) {
          if (await claimEvent(event.eventId)) {
            await applyEvent(event, log);
          } else {
            log(`stripe event ${event.eventId} already processed — skipping (replay/retry)`);
          }
        }
        return send(200, { received: true });
      }

      if (url.pathname === '/webhooks/polar' && req.method === 'POST') {
        const raw = await readBody(req, true);
        const event = polarNormalizeWebhook(raw, req.headers);
        if (event != null) {
          if (await claimEvent(event.eventId)) {
            await applyEvent(event, log);
          } else {
            log(`polar event ${event.eventId} already processed — skipping (replay/retry)`);
          }
        }
        return send(200, { received: true });
      }

      if (url.pathname === '/org' && req.method === 'GET') {
        const orgId = url.searchParams.get('orgId') ?? 'default';
        return send(200, { org: await getOrg(orgId) });
      }

      return send(404, { error: 'not found' });
    } catch (err) {
      log(`api error ${url.pathname}: ${err.message}`);
      if (err.status === 413) {
        return send(413, { error: 'request body too large' });
      }
      const status = /not configured|no Stripe price/.test(err.message) ? 503 : 500;
      // Don't reflect internal error detail to the caller.
      return send(status, { error: status === 503 ? err.message : 'internal error' });
    }
  })
  .listen(PORT, () => log(`listening on :${PORT}`));
