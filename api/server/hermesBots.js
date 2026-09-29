// Server-side JSON-RPC broker to the Hermes v0.21.5 dashboard/tui_gateway (Bot Mode control
// plane). The browser never speaks to the gateway directly: the Analytikul backend holds one
// authenticated WebSocket to the gateway's `/api/ws` and forwards an allow-listed set of RPC
// methods on the caller's behalf, so the gateway credential never reaches the client.
//
// Transport: newline-delimited JSON-RPC 2.0 over WebSocket (tui_gateway/ws.py, mounted at
// `/api/ws`). We correlate responses by `id`. See docs/hermes-0.21.5-rpc-and-adapter-map.md §2.
//
// Auth to the gateway is a legacy shared token (like the OpenClaw embed injects a gateway token).
// The exact upgrade credential is finalized when the hermes-gateway service is stood up; it is
// configurable here and presented on the WS handshake. Until then this module no-ops gracefully.
const WebSocket = require('ws');
const { logger } = require('@librechat/data-schemas');

const GATEWAY_URL = () =>
  process.env.HERMES_GATEWAY_URL || 'ws://analytikul-hermes-gateway:9119/api/ws';
const GATEWAY_TOKEN = () => process.env.HERMES_GATEWAY_TOKEN || '';
const CONNECT_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 30000;

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
  conn.ready = new Promise((resolve, reject) => {
    const headers = {};
    const token = GATEWAY_TOKEN();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const socket = new WebSocket(GATEWAY_URL(), { headers, handshakeTimeout: CONNECT_TIMEOUT_MS });
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
