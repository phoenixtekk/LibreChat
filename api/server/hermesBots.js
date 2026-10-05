// Server-side JSON-RPC broker to the Hermes v0.21.5 dashboard/tui_gateway (Bot Mode control
// plane). The browser never speaks to the gateway directly: the Analytikul backend holds one
// authenticated WebSocket to the gateway's `/api/ws` and forwards an allow-listed set of RPC
// methods on the caller's behalf, so the gateway credential never reaches the client.
//
// Transport: newline-delimited JSON-RPC 2.0 over WebSocket (tui_gateway/ws.py, mounted at
// `/api/ws`). We correlate responses by `id`. See docs/hermes-0.21.5-rpc-and-adapter-map.md §2.
//
// Auth: the Hermes dashboard gates non-loopback binds with a login -> ws-ticket flow (not a bearer
// header). Per connection we (1) POST /auth/password-login with the basic-auth creds to get session
// cookies, (2) POST /api/auth/ws-ticket for a single-use ticket, (3) open /api/ws presenting the
// ticket as the `hermes-gateway-ticket.<ticket>` WebSocket subprotocol. Creds come from
// HERMES_GATEWAY_USER + HERMES_GATEWAY_TOKEN (set in .env.aibox alongside the gateway's
// HERMES_DASHBOARD_BASIC_AUTH_*). Until configured, the module no-ops gracefully.
const WebSocket = require('ws');
const { logger } = require('@librechat/data-schemas');

const GATEWAY_URL = () =>
  process.env.HERMES_GATEWAY_URL || 'ws://analytikul-hermes-gateway:9119/api/ws';
const GATEWAY_USER = () => process.env.HERMES_GATEWAY_USER || 'analytikul';
const GATEWAY_TOKEN = () => process.env.HERMES_GATEWAY_TOKEN || '';
const GATEWAY_PROVIDER = () => process.env.HERMES_GATEWAY_PROVIDER || 'basic';
const WS_PROTOCOL = 'hermes-gateway-v1';
const WS_TICKET_SUBPROTOCOL_PREFIX = 'hermes-gateway-ticket.';
const CONNECT_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 30000;

/** HTTP base (scheme + host) for the dashboard, derived from the ws(s):// gateway URL. */
function httpBase() {
  const u = new URL(GATEWAY_URL());
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${u.protocol}//${u.host}`;
}

/** Collapse Set-Cookie headers into a single `name=value; …` Cookie header value. */
function cookieHeaderFrom(res) {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

/**
 * Run the dashboard login -> ws-ticket handshake and return a fresh single-use ticket plus the
 * session Cookie header. Throws on auth failure.
 */
async function obtainWsTicket() {
  const base = httpBase();
  const controller = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
  const loginRes = await fetch(`${base}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: GATEWAY_PROVIDER(),
      username: GATEWAY_USER(),
      password: GATEWAY_TOKEN(),
    }),
    signal: controller,
  });
  if (!loginRes.ok) {
    throw new Error(`gateway login failed (${loginRes.status})`);
  }
  const cookie = cookieHeaderFrom(loginRes);
  const ticketRes = await fetch(`${base}/api/auth/ws-ticket`, {
    method: 'POST',
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  });
  if (!ticketRes.ok) {
    throw new Error(`gateway ws-ticket failed (${ticketRes.status})`);
  }
  const { ticket } = await ticketRes.json();
  if (!ticket) {
    throw new Error('gateway ws-ticket: empty ticket');
  }
  return ticket;
}

// Methods the browser is allowed to invoke through the broker. Anything else is rejected before
// it reaches the gateway. Group-chat rooms and cron routines are included for S4.
const ALLOWED_METHODS = new Set([
  'profiles.list',
  'profiles.describe',
  'profiles.create',
  'profiles.configure',
  'profiles.set_asset',
  'profiles.get_asset',
  'image.generate',
  'cron.manage',
  'session.list',
  'session.create',
  'session.title',
  'session.set_hidden',
  'session.most_recent',
  'session.resume',
  'prompt.submit',
  'groups.capabilities',
  'groups.list',
  'groups.create',
  'groups.state',
  'groups.send',
  'groups.rename',
  'groups.log',
  'groups.disband',
]);

/** @type {{ ws: import('ws')|null, ready: Promise<void>|null, seq: number, pending: Map<number, {resolve: Function, reject: Function, timer: NodeJS.Timeout}> }} */
const conn = { ws: null, ready: null, seq: 0, pending: new Map() };

function isAllowed(method) {
  return typeof method === 'string' && ALLOWED_METHODS.has(method);
}

function rejectAllPending(err) {
  for (const { reject, timer } of conn.pending.values()) {
    clearTimeout(timer);
    reject(err);
  }
  conn.pending.clear();
}

function connect() {
  if (conn.ready) {
    return conn.ready;
  }
  conn.ready = (async () => {
    const ticket = await obtainWsTicket();
    await new Promise((resolve, reject) => {
      // The gateway requires BOTH the stable protocol and the ticket-bearing protocol in the
      // Sec-WebSocket-Protocol set; it selects the stable one on accept.
      const socket = new WebSocket(
        GATEWAY_URL(),
        [WS_PROTOCOL, `${WS_TICKET_SUBPROTOCOL_PREFIX}${ticket}`],
        { handshakeTimeout: CONNECT_TIMEOUT_MS },
      );
      conn.ws = socket;

      socket.on('open', () => resolve());
      socket.on('message', (data) => onMessage(data));
      socket.on('close', () => {
        conn.ws = null;
        conn.ready = null;
        rejectAllPending(new Error('hermes gateway connection closed'));
      });
      socket.on('error', (err) => {
        conn.ready = null;
        rejectAllPending(err);
        reject(err);
      });
    });
  })();
  conn.ready.catch(() => {
    conn.ready = null;
  });
  return conn.ready;
}

function onMessage(data) {
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return;
  }
  const id = frame?.id;
  if (id == null || !conn.pending.has(id)) {
    return;
  }
  const entry = conn.pending.get(id);
  conn.pending.delete(id);
  clearTimeout(entry.timer);
  if (frame.error) {
    entry.reject(new Error(frame.error.message || `gateway error ${frame.error.code ?? ''}`));
    return;
  }
  entry.resolve(frame.result);
}

/**
 * Invoke a single gateway RPC method. Rejects if the method is not allow-listed, the gateway is
 * unreachable, or the call times out.
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @returns {Promise<unknown>}
 */
async function call(method, params = {}) {
  if (!isAllowed(method)) {
    throw new Error(`method not allowed: ${method}`);
  }
  await connect();
  const id = ++conn.seq;
  const frame = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new Error(`gateway rpc timeout: ${method}`));
    }, REQUEST_TIMEOUT_MS);
    conn.pending.set(id, { resolve, reject, timer });
    try {
      conn.ws.send(`${JSON.stringify(frame)}\n`);
    } catch (err) {
      conn.pending.delete(id);
      clearTimeout(timer);
      reject(err);
    }
  });
}

const configured = () =>
  Boolean(process.env.HERMES_GATEWAY_URL || process.env.HERMES_GATEWAY_TOKEN);

module.exports = { call, isAllowed, configured, ALLOWED_METHODS };
