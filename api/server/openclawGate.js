// Shared admin-gate + target config for the OpenClaw embed. Used by the HTTP proxy
// (routes/analytikul.js) and the WebSocket upgrade proxy (index.js).
// A short-lived, HMAC-signed cookie authorizes the browser's iframe/asset/WS requests
// (which can't carry the Bearer JWT); the proxy injects the gateway token upstream.
const crypto = require('node:crypto');

const COOKIE = 'oc_gate';
const TTL_MS = 60 * 60 * 1000; // 1h

const secret = () => process.env.JWT_SECRET || process.env.INTERNAL_SERVICE_TOKEN || 'oc-dev-secret';
const sign = (userId, exp) =>
  crypto.createHmac('sha256', secret()).update(`${userId}.${exp}`).digest('hex');

function issue(userId) {
  const exp = Date.now() + TTL_MS;
  return `${userId}.${exp}.${sign(userId, exp)}`;
}

function valid(cookieHeader) {
  const m = /(?:^|;\s*)oc_gate=([^;]+)/.exec(cookieHeader || '');
  if (!m) return false;
  const parts = decodeURIComponent(m[1]).split('.');
  if (parts.length !== 3) return false;
  const [userId, exp, sig] = parts;
  if (!userId || !exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(userId, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

const targetUrl = () => process.env.OPENCLAW_GATEWAY_URL || 'http://analytikul-openclaw:18789';
const gatewayToken = () => process.env.OPENCLAW_GATEWAY_TOKEN || '';

module.exports = { COOKIE, TTL_MS, issue, valid, targetUrl, gatewayToken };
