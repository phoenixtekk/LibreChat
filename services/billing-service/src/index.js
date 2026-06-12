// Analytikul billing-service — BYOK vault + Stripe checkout/webhooks + entitlements.
// Internal-only: never publicly proxied; only the Express backend calls it
// (except /webhooks/stripe which Express forwards raw).
import http from 'node:http';
import { migrateVault, putKey, getKey, listKeys, deleteKey } from './vault.js';
import {
  stripeReady,
  normalizeWebhook,
  createSubscriptionCheckout,
  createCreditsCheckout,
} from './stripe.js';
import { applyEvent, getOrg } from './entitlements.js';

const PORT = process.env.BILLING_PORT || 8013;
const log = (msg) => console.log(`[billing] ${msg}`);

await migrateVault();
log(`vault schema ready; stripe configured: ${stripeReady()}`);

async function readBody(req, raw = false) {
  const chunks = [];
  for await (const chunk of req) {
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
        return send(200, await createSubscriptionCheckout(body));
      }

      if (url.pathname === '/checkout/credits' && req.method === 'POST') {
        const body = await readBody(req);
        return send(200, await createCreditsCheckout(body));
      }

      if (url.pathname === '/webhooks/stripe' && req.method === 'POST') {
        const raw = await readBody(req, true);
        const event = normalizeWebhook(raw, req.headers['stripe-signature']);
        if (event != null) {
          await applyEvent(event, log);
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
      const status = /not configured|no Stripe price/.test(err.message) ? 503 : 500;
      return send(status, { error: err.message });
    }
  })
  .listen(PORT, () => log(`listening on :${PORT}`));
