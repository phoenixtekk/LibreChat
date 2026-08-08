// Thin JS wrapper per workspace rules — all logic lives in @librechat/api (packages/api/src/analytikul).
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  startAgentRun,
  startDeploy,
  collectAgentRun,
  cancelAgentRun,
  respondAgentApproval,
  sendAgentToolResult,
  getAgentTools,
  pipeAgentStream,
  createTraceRecorder,
  checkBudget,
  getVaultedKey,
  listVaultKeys,
  putVaultKey,
  deleteVaultKey,
  validateUrl,
  AdapterError,
  getOrgEntitlements,
  forbiddenToolsetsForPlan,
  createCheckout,
} = require('@librechat/api');
const {
  listUserEndpoints,
  createUserEndpoint,
  updateUserEndpoint,
  deleteUserEndpoint,
} = require('~/models');
const { fetchEndpointModels } = require('~/server/services/Config/fetchEndpointModels');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { AgentTrace, Note, Annotation } = require('~/db/models');
const mongoose = require('mongoose');

const router = express.Router();

// Per-route rate limiters. Per-USER (authenticated) is the right key here; IP
// is a fallback when the request slips in before JWT auth would have run. The IP
// fallback runs through express-rate-limit's ipKeyGenerator so IPv6 clients are
// keyed by /56 subnet (raw req.ip would let a /64-holder rotate past the limit —
// ERR_ERL_KEY_GEN_IPV6).
const userKey = (req) =>
  req.user && req.user.id ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
// Expensive: every call spawns an agent run (token spend + adapter session).
const agentRunLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { message: 'Too many agent runs in a minute — please slow down.' },
});
// Medium: every call calls the LLM (notes AI action — todo toolset only).
const notesAiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { message: 'Too many notes AI requests in a minute.' },
});
// Cheap reads/writes (vault list/put, memory list/put, etc.) — generous cap that
// still stops scripted abuse against the internal services.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { message: 'Too many requests.' },
});
const taskMeta = new Map();
const TASK_META_MAX = 1000;

// --- Analytikul Coder: local-bridge relay ------------------------------------------
// Browsers block a public HTTPS site from calling a service on the user's machine, so
// the bridge dials OUT and long-polls here. When a run with exec_target=bridge emits a
// `tool_dispatch` event, we hand it to that user's paired bridge and post its result
// back to the agent. Registry is in-process (single app instance).
const crypto = require('node:crypto');
const fsMod = require('node:fs');
const http = require('node:http');
const ocGate = require('~/server/openclawGate');
const BRIDGE_CODE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // long-lived device pairing
const BRIDGE_POLL_MS = 25_000;
const BRIDGE_TOOL_TIMEOUT_MS = 20 * 60 * 1000;
const BRIDGE_FS_TIMEOUT_MS = 20_000;
const BRIDGE_TOKENS_FILE = process.env.BRIDGE_TOKENS_FILE || '/app/api/logs/.bridge-tokens.json';
const bridgeCodes = new Map(); // code -> { userId, expires }
const bridgeQueue = new Map(); // userId -> [dispatch,...] awaiting delivery
const bridgeWaiter = new Map(); // userId -> { res, timer } parked long-poll
const bridgePending = new Map(); // request_id -> { taskId, userId, timer }  (tool results)
const bridgeFsPending = new Map(); // request_id -> { resolve, timer }  (Files-tab queries)

// Persist pairings so they survive an app restart (written to a mounted volume).
const saveBridgeCodes = () => {
  try {
    const obj = {};
    for (const [code, rec] of bridgeCodes.entries()) obj[code] = rec;
    fsMod.writeFileSync(BRIDGE_TOKENS_FILE, JSON.stringify(obj), { mode: 0o600 });
  } catch (e) {
    logger.warn(`[analytikul] could not persist bridge tokens: ${e.message}`);
  }
};
const loadBridgeCodes = () => {
  try {
    const obj = JSON.parse(fsMod.readFileSync(BRIDGE_TOKENS_FILE, 'utf8'));
    const now = Date.now();
    for (const [code, rec] of Object.entries(obj)) {
      if (rec && rec.expires > now) bridgeCodes.set(code, rec);
    }
  } catch {
    /* no persisted tokens yet */
  }
};
loadBridgeCodes();

const bridgeUserForCode = (code) => {
  const rec = code ? bridgeCodes.get(code) : null;
  if (!rec) return null;
  if (rec.expires < Date.now()) {
    bridgeCodes.delete(code);
    return null;
  }
  return rec.userId;
};
const bridgeUserPaired = (userId) => {
  for (const rec of bridgeCodes.values()) {
    if (rec.userId === userId && rec.expires >= Date.now()) return true;
  }
  return false;
};
const bridgeDeliver = (userId, dispatch) => {
  const waiter = bridgeWaiter.get(userId);
  if (waiter) {
    clearTimeout(waiter.timer);
    bridgeWaiter.delete(userId);
    if (!waiter.res.writableEnded) waiter.res.status(200).json({ dispatches: [dispatch] });
    return;
  }
  const q = bridgeQueue.get(userId) || [];
  q.push(dispatch);
  bridgeQueue.set(userId, q);
};
function relayToolDispatch(meta, taskId, event) {
  const requestId = event.request_id;
  if (!requestId) return;
  const finish = (result) => {
    const p = bridgePending.get(requestId);
    if (p) {
      clearTimeout(p.timer);
      bridgePending.delete(requestId);
    }
    sendAgentToolResult(taskId, requestId, result).catch(() => undefined);
  };
  if (!bridgeUserPaired(meta.userId)) {
    return finish(JSON.stringify({ error: 'no paired bridge — start the local bridge and pair it' }));
  }
  const timer = setTimeout(
    () => finish(JSON.stringify({ error: 'bridge did not respond in time' })),
    BRIDGE_TOOL_TIMEOUT_MS,
  );
  bridgePending.set(requestId, { taskId, userId: meta.userId, timer });
  bridgeDeliver(meta.userId, {
    request_id: requestId,
    tool: event.tool,
    args: event.args || {},
    project: meta.workspace || 'default',
    permissionMode: meta.permissionMode || 'auto',
  });
}

// Bridge long-polls for the next tool call(s). Auth = pairing code (NOT a JWT), so this
// is registered before requireJwtAuth below.
router.get('/bridge/poll', (req, res) => {
  const code = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userId = bridgeUserForCode(code);
  if (!userId) return res.status(401).json({ error: 'unpaired' });
  const q = bridgeQueue.get(userId);
  if (q && q.length) {
    bridgeQueue.delete(userId);
    return res.status(200).json({ dispatches: q });
  }
  const prev = bridgeWaiter.get(userId);
  if (prev) {
    clearTimeout(prev.timer);
    bridgeWaiter.delete(userId);
    if (!prev.res.writableEnded) prev.res.status(204).end();
  }
  const timer = setTimeout(() => {
    bridgeWaiter.delete(userId);
    if (!res.writableEnded) res.status(204).end();
  }, BRIDGE_POLL_MS);
  bridgeWaiter.set(userId, { res, timer });
  res.on('close', () => {
    clearTimeout(timer);
    if (bridgeWaiter.get(userId)?.res === res) bridgeWaiter.delete(userId);
  });
});

// Bridge posts a tool result back. Auth = pairing code.
router.post('/bridge/result', express.json({ limit: '8mb' }), (req, res) => {
  const code = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userId = bridgeUserForCode(code);
  if (!userId) return res.status(401).json({ error: 'unpaired' });
  const { request_id: requestId, result } = req.body ?? {};
  if (!requestId || typeof result !== 'string') {
    return res.status(400).json({ message: 'request_id and a string result are required' });
  }
  const p = bridgePending.get(requestId);
  if (p && p.userId === userId) {
    clearTimeout(p.timer);
    bridgePending.delete(requestId);
    sendAgentToolResult(p.taskId, requestId, result).catch(() => undefined);
    return res.status(200).json({ ok: true });
  }
  const f = bridgeFsPending.get(requestId);
  if (f) {
    clearTimeout(f.timer);
    bridgeFsPending.delete(requestId);
    f.resolve(result);
    return res.status(200).json({ ok: true });
  }
  return res.status(404).json({ ok: false });
});

// Shared secret for calls into the internal services (billing/analytics/memory/gateway).
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const internalHeaders = (extra = {}) =>
  INTERNAL_TOKEN ? { ...extra, 'x-internal-token': INTERNAL_TOKEN } : extra;
// Escape user input before using it as a Mongo $regex (prevents ReDoS / regex injection).
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Tenant/org scope for the caller. Users in an org share its tenantId; a solo
// user (no tenantId) is isolated to their own id — NEVER collapsed into a shared
// 'default' bucket (that leaked org-shared notes / memory / analytics across all
// un-tenanted users).
const tenantOf = (req) => req.user.tenantId || String(req.user.id);

// --- OpenClaw embed: admin-gated reverse proxy to the containerized gateway ---
// Cookie-gated (cookie issued by /oc-authorize, which IS JWT+admin-gated). Registered
// before requireJwtAuth so the browser's iframe/asset requests (which carry the cookie,
// not the Bearer JWT) reach it. The gateway bearer token is injected upstream.
router.use('/openclaw', (req, res) => {
  if (!ocGate.valid(req.headers.cookie)) {
    return res.status(401).json({ error: 'openclaw: unauthorized — open it from the OpenClaw tab' });
  }
  let target;
  try {
    target = new URL(ocGate.targetUrl());
  } catch {
    return res.status(500).json({ error: 'openclaw target misconfigured' });
  }
  const headers = { ...req.headers };
  headers.host = target.host;
  headers.authorization = `Bearer ${ocGate.gatewayToken()}`;
  delete headers.cookie;
  let bodyBuf = null;
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    bodyBuf = Buffer.from(JSON.stringify(req.body));
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(bodyBuf.length);
  }
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path: req.originalUrl, headers },
    (r) => {
      // The Control UI is served same-origin (from analytikul.ai via this proxy), so allow
      // framing: drop X-Frame-Options: DENY and rewrite CSP frame-ancestors to 'self'.
      const h = { ...r.headers };
      delete h['x-frame-options'];
      if (typeof h['content-security-policy'] === 'string') {
        h['content-security-policy'] = h['content-security-policy'].replace(
          /frame-ancestors[^;]*/i,
          "frame-ancestors 'self'",
        );
      }
      // Helmet (app middleware) sets X-Frame-Options: DENY on every response; writeHead
      // only merges, so remove it explicitly to allow the same-origin iframe.
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.writeHead(r.statusCode || 502, h);
      r.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.status(502).end('openclaw gateway unreachable');
    }
  });
  if (bodyBuf) {
    upstream.end(bodyBuf);
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
});

router.use(requireJwtAuth);
// Apply a generous baseline cap to every authenticated /api/analytikul call.
// Expensive routes layer a stricter limiter on top.
router.use(generalLimiter);

router.post('/agent/run', agentRunLimiter, async (req, res) => {
  try {
    const {
      message,
      conversationId,
      model,
      provider,
      baseUrl,
      enabledToolsets,
      disabledToolsets,
      workspace,
      permissionMode,
      execTarget,
    } = req.body ?? {};
    if (!message || !conversationId) {
      return res.status(400).json({ message: 'message and conversationId are required' });
    }
    // SECURITY + ENTITLEMENT: per-plan toolset floor (Agent Power Tools).
    //  - terminal + computer_use stay HARD-floored for everyone until per-task
    //    sandbox/VM isolation ships (they run host commands / drive a desktop).
    //  - messaging + homeassistant are PLAN-GATED (Team+); stripped below that.
    // code_execution + file are allowed (gVisor-sandboxed since 2026-06-20).
    // Entitlements fail closed to free/no-addon if billing is unreachable.
    const ent = await getOrgEntitlements(tenantOf(req));
    const FORBIDDEN_TOOLSETS = forbiddenToolsetsForPlan(ent.plan, ent.powerTools);
    const safeEnabled = Array.isArray(enabledToolsets)
      ? enabledToolsets.filter((t) => !FORBIDDEN_TOOLSETS.includes(t))
      : undefined;
    const safeDisabled = Array.from(
      new Set([
        ...(Array.isArray(disabledToolsets) ? disabledToolsets : []),
        ...FORBIDDEN_TOOLSETS,
      ]),
    );
    const budget = await checkBudget(req.user.id, tenantOf(req));
    if (!budget.allowed) {
      return res.status(402).json({
        message: `Budget exceeded: $${budget.spent?.toFixed(4)} of $${budget.limit?.toFixed(2)} (${budget.scope} ${budget.period} limit). Agent runs are paused until the period resets or an admin raises the limit.`,
        budget,
      });
    }
    const effectiveProvider = provider ?? process.env.AGENT_DEFAULT_PROVIDER ?? 'anthropic';
    const vaultedKey = await getVaultedKey(
      req.user.id,
      effectiveProvider,
      tenantOf(req),
    );
    // Fail closed for platform-key runs we can't budget-check: if the budget
    // service was unreachable (degraded fail-open) and the user has no BYOK key,
    // the run would bill the shared platform key uncapped — refuse it. BYOK users
    // are unaffected.
    if (budget.degraded && !vaultedKey) {
      return res.status(503).json({
        message:
          'Budget service unavailable; platform-key runs are paused. Add your own API key to continue.',
      });
    }
    const ctx = {
      userId: req.user.id,
      tenantId: tenantOf(req),
      apiKey: vaultedKey ?? process.env.AGENT_DEFAULT_API_KEY,
    };
    const { taskId } = await startAgentRun(
      {
        message,
        conversationId,
        model: model ?? process.env.AGENT_DEFAULT_MODEL,
        provider: provider ?? process.env.AGENT_DEFAULT_PROVIDER,
        baseUrl: baseUrl ?? process.env.AGENT_DEFAULT_BASE_URL,
        enabledToolsets: safeEnabled,
        disabledToolsets: safeDisabled,
        workspace,
        permissionMode,
        execTarget: execTarget === 'bridge' ? 'bridge' : 'container',
      },
      ctx,
    );
    if (taskMeta.size >= TASK_META_MAX) {
      taskMeta.delete(taskMeta.keys().next().value);
    }
    taskMeta.set(taskId, {
      userId: req.user.id,
      tenantId: tenantOf(req),
      conversationId,
      model: model ?? process.env.AGENT_DEFAULT_MODEL ?? '',
      provider: provider ?? process.env.AGENT_DEFAULT_PROVIDER ?? 'openrouter',
      workspace,
      permissionMode,
      execTarget: execTarget === 'bridge' ? 'bridge' : 'container',
    });
    res.status(200).json({ taskId });
  } catch (error) {
    logger.error('[analytikul] run failed', error);
    const status = error instanceof AdapterError ? error.status : 500;
    res.status(status).json({ message: error.message ?? 'agent run failed' });
  }
});

router.get('/agent/stream/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const meta = taskMeta.get(taskId);
  if (meta == null || meta.userId !== req.user.id) {
    return res.status(404).json({ message: 'unknown task' });
  }
  try {
    const recorder = createTraceRecorder(AgentTrace, {
      taskId,
      userId: meta.userId,
      tenantId: meta.tenantId,
      conversationId: meta.conversationId,
      model: meta.model,
      provider: meta.provider,
    });
    // Server-side bridge relay: hand any tool_dispatch to the user's paired local bridge.
    const onEvent = (event) => {
      recorder.onEvent(event);
      if (event && event.type === 'tool_dispatch') {
        relayToolDispatch(meta, taskId, event);
      }
    };
    await pipeAgentStream(taskId, res, onEvent);
  } catch (error) {
    logger.error(`[analytikul] stream ${taskId} failed`, error);
    if (!res.headersSent) {
      const status = error instanceof AdapterError ? error.status : 500;
      res.status(status).json({ message: error.message ?? 'stream failed' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

router.post('/agent/cancel/:taskId', async (req, res) => {
  const meta = taskMeta.get(req.params.taskId);
  if (meta == null || meta.userId !== req.user.id) {
    return res.status(404).json({ message: 'unknown task' });
  }
  const cancelled = await cancelAgentRun(req.params.taskId);
  res.status(cancelled ? 200 : 404).json({ cancelled });
});

/* Analytikul Coder — first-class Deploy. Deterministically build+ship a workspace
 * project to a fleet server under pm2, then surface the Cloudflare route. Gated on
 * POWER_MODE (personal single-tenant posture): deploy runs shell on production
 * servers, so it's only exposed in the trusted power-mode setup. */
const DEPLOY_ENABLED = () => String(process.env.POWER_MODE || '').toLowerCase() === 'true';
const FLEET_SERVERS = ['linuxg1', 'linuxg2', 'linuxg3', 'linuxg4', 'linuxg5', 'linuxg6'];

router.get('/agent/deploy/servers', (req, res) => {
  res.status(200).json({ enabled: DEPLOY_ENABLED(), servers: FLEET_SERVERS });
});

router.post('/agent/deploy', agentRunLimiter, async (req, res) => {
  if (!DEPLOY_ENABLED()) {
    return res.status(403).json({ message: 'Deploy is disabled (POWER_MODE off).' });
  }
  try {
    const { workspace, server, domain, subdomain, appType } = req.body ?? {};
    if (!workspace || !server) {
      return res.status(400).json({ message: 'workspace and server are required' });
    }
    if (!FLEET_SERVERS.includes(server)) {
      return res.status(400).json({ message: `server must be one of: ${FLEET_SERVERS.join(', ')}` });
    }
    const { taskId } = await startDeploy(
      { workspace, server, domain, subdomain, appType },
      req.user.id,
    );
    if (taskMeta.size >= TASK_META_MAX) {
      taskMeta.delete(taskMeta.keys().next().value);
    }
    taskMeta.set(taskId, { userId: req.user.id, tenantId: tenantOf(req), kind: 'deploy' });
    res.status(200).json({ taskId });
  } catch (error) {
    logger.error('[analytikul] deploy failed', error);
    const status = error instanceof AdapterError ? error.status : 500;
    res.status(status).json({ message: error.message ?? 'deploy failed' });
  }
});

router.get('/agent/deploy/stream/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const meta = taskMeta.get(taskId);
  if (meta == null || meta.userId !== req.user.id) {
    return res.status(404).json({ message: 'unknown task' });
  }
  try {
    // Deploy is not an agent run — no trace recorder, just pipe the SSE through.
    await pipeAgentStream(taskId, res);
  } catch (error) {
    logger.error(`[analytikul] deploy stream ${taskId} failed`, error);
    if (!res.headersSent) {
      const status = error instanceof AdapterError ? error.status : 500;
      res.status(status).json({ message: error.message ?? 'stream failed' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

router.get('/agent/tools', async (req, res) => {
  try {
    res.status(200).json(await getAgentTools());
  } catch (error) {
    logger.error('[analytikul] tools failed', error);
    const status = error instanceof AdapterError ? error.status : 500;
    res.status(status).json({ message: error.message ?? 'tools unavailable' });
  }
});

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? 'http://localhost:8011';
const ANALYTICS_VIEWS = {
  daily: '/summary/daily',
  models: '/summary/models',
  conversations: '/summary/conversations',
  events: '/events/recent',
  unpriced: '/summary/unpriced',
  users: '/summary/users',
};

router.get('/analytics/:view', async (req, res) => {
  const upstreamPath = ANALYTICS_VIEWS[req.params.view];
  if (upstreamPath == null) {
    return res.status(404).json({ message: 'unknown analytics view' });
  }
  // Raw, per-event and per-user views can expose other org members' activity;
  // restrict them to admins. Aggregate cost views (daily/models/conversations)
  // are fine for any org member (and conversations is self-scoped below).
  const ADMIN_ONLY_VIEWS = new Set(['users', 'events', 'unpriced']);
  if (ADMIN_ONLY_VIEWS.has(req.params.view) && req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'admin only' });
  }
  try {
    const url = new URL(ANALYTICS_URL + upstreamPath);
    url.searchParams.set('orgId', tenantOf(req));
    const days = Number(req.query.days);
    if (Number.isFinite(days)) {
      url.searchParams.set('days', String(Math.min(days, 365)));
    }
    if (req.params.view === 'conversations') {
      url.searchParams.set('userId', req.user.id);
    }
    const upstream = await fetch(url, {
      headers: internalHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] analytics proxy failed', error);
    res.status(502).json({ message: 'analytics service unavailable' });
  }
});

router.get('/keys', async (req, res) => {
  try {
    res.status(200).json({ keys: await listVaultKeys(req.user.id, tenantOf(req)) });
  } catch (error) {
    logger.error('[analytikul] vault list failed', error);
    res.status(502).json({ message: 'vault unavailable' });
  }
});

router.put('/keys', async (req, res) => {
  try {
    const { provider, apiKey } = req.body ?? {};
    if (!provider || !apiKey) {
      return res.status(400).json({ message: 'provider and apiKey required' });
    }
    const key = await putVaultKey(req.user.id, provider, apiKey, tenantOf(req));
    res.status(200).json({ key });
  } catch (error) {
    logger.error('[analytikul] vault put failed', error);
    res.status(502).json({ message: 'vault unavailable' });
  }
});

router.delete('/keys/:provider', async (req, res) => {
  const deleted = await deleteVaultKey(
    req.user.id,
    req.params.provider,
    tenantOf(req),
  );
  res.status(deleted ? 200 : 404).json({ deleted });
});

/* ---------------- User-defined custom endpoints (BYOK, Feature 2a) ----------------
 * Each user registers their own OpenAI-compatible endpoints, visible ONLY in
 * their picker. Every baseURL is run through the SSRF guard before storage so
 * a user can't point the platform at an internal service. The API key is
 * encrypted at rest by the data-schemas methods (encryptV2). */

const NAME_RE = /^[\w .-]{1,48}$/;

/** Names that collide with a built-in provider would create a confusing
 *  duplicate in the picker (two "OpenAI" entries — one BYOK-via-vault, one
 *  custom), so we reserve them. Compared case-insensitively. */
const RESERVED_ENDPOINT_NAMES = new Set([
  'openai',
  'azureopenai',
  'google',
  'anthropic',
  'bedrock',
  'assistants',
  'azureassistants',
  'agents',
  'custom',
  'gptplugins',
  'chatgptbrowser',
  'bingai',
]);

function reservedNameMessage(name) {
  return `"${name}" is a reserved provider name. Pick a different name (e.g. "My ${name}").`;
}

/** Map an SSRF rejection to a user-facing message without leaking internals. */
const SSRF_MESSAGES = {
  invalid_url: 'That does not look like a valid URL.',
  scheme_blocked: 'Only http and https URLs are allowed.',
  hostname_pattern_blocked: 'That host is not allowed.',
  port_blocked: 'That port is not allowed.',
  dns_failed: 'The host could not be resolved.',
  ip_private: 'That URL resolves to a private address and is not allowed.',
  ip_loopback: 'That URL resolves to a loopback address and is not allowed.',
  ip_link_local: 'That URL resolves to a link-local address and is not allowed.',
  ip_multicast: 'That URL resolves to a multicast address and is not allowed.',
  ip_reserved: 'That URL resolves to a reserved address and is not allowed.',
  timeout: 'Validating the host timed out. Try again.',
};

function validateModelsField(models) {
  if (models == null) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(models) || models.length > 64) {
    return { ok: false, message: 'models must be an array of up to 64 strings' };
  }
  for (const m of models) {
    if (typeof m !== 'string' || m.length === 0 || m.length > 128) {
      return { ok: false, message: 'each model must be a non-empty string (<=128 chars)' };
    }
  }
  return { ok: true, value: models };
}

/* List the models an OpenAI-compatible endpoint serves, for the agent model picker.
 * In POWER_MODE (self-hosted single-tenant) a private/LAN endpoint — e.g. a local
 * vLLM/Ollama — is allowed; otherwise the SSRF guard refuses private addresses.
 * Read-only, no persistence: the client calls this to populate a model dropdown. */
router.get('/agent/models', async (req, res) => {
  const baseUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
  const apiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey : '';
  if (!baseUrl) {
    return res.status(400).json({ message: 'baseUrl is required' });
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return res.status(400).json({ message: SSRF_MESSAGES.invalid_url });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ message: SSRF_MESSAGES.scheme_blocked });
  }
  const powerMode = process.env.POWER_MODE === 'true';
  const PRIVATE_OK = new Set(['ip_private', 'ip_loopback', 'ip_link_local']);
  try {
    const decision = await validateUrl(baseUrl);
    let resolvedIp = decision.resolvedIp;
    if (!decision.allowed) {
      if (!(powerMode && PRIVATE_OK.has(decision.reason))) {
        return res.status(400).json({
          message: SSRF_MESSAGES[decision.reason] ?? 'That URL is not allowed.',
          reason: decision.reason,
        });
      }
      // Trusted self-hosted operator pointing at their own LAN/local endpoint —
      // resolve the host ourselves so fetchEndpointModels has a pinned IP.
      if (!resolvedIp) {
        resolvedIp = require('net').isIP(parsed.hostname)
          ? parsed.hostname
          : (await require('dns').promises.lookup(parsed.hostname)).address;
      }
    }
    const models = await fetchEndpointModels(baseUrl, apiKey, resolvedIp);
    return res.status(200).json({ models: Array.isArray(models) ? models : [] });
  } catch (error) {
    logger.warn(`[analytikul] agent model list failed for ${baseUrl}: ${error.message}`);
    return res.status(502).json({ message: 'Could not reach the endpoint to list models.' });
  }
});

/* Analytikul Coder workspace projects: list/create project folders under the host
 * workspace root (WORKSPACE_HOST_DIR, bind-mounted into the agent as /workspace).
 * Only project names (single top-level folders) are accepted — no path traversal. */
const PROJECT_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

router.get('/agent/workspaces', async (req, res) => {
  const hostDir = process.env.WORKSPACE_HOST_DIR || '';
  if (!hostDir) {
    return res.status(200).json({ configured: false, hostDir: '', projects: [] });
  }
  try {
    const entries = await require('fs').promises.readdir(hostDir, { withFileTypes: true });
    const projects = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
    return res.status(200).json({ configured: true, hostDir, projects });
  } catch (error) {
    logger.warn(`[analytikul] list workspaces failed: ${error.message}`);
    return res.status(200).json({ configured: true, hostDir, projects: [] });
  }
});

router.post('/agent/workspaces', async (req, res) => {
  const hostDir = process.env.WORKSPACE_HOST_DIR || '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!hostDir) {
    return res.status(400).json({ message: 'No workspace root configured (WORKSPACE_HOST_DIR).' });
  }
  if (!PROJECT_NAME_RE.test(name)) {
    return res.status(400).json({ message: 'Project name must be 1-64 chars: letters, numbers, . _ -' });
  }
  try {
    const target = require('path').join(hostDir, name);
    await require('fs').promises.mkdir(target, { recursive: true });
    return res.status(201).json({ name });
  } catch (error) {
    logger.warn(`[analytikul] create workspace failed: ${error.message}`);
    return res.status(500).json({ message: 'Could not create the project folder.' });
  }
});

/* Cockpit (M4): read-only workspace file tree + file contents, scoped to a project
 * folder under the host workspace root. Path traversal is rejected; heavy dirs are
 * skipped and results are bounded. */
const COCKPIT_IGNORE = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo', '.venv', '__pycache__',
]);

function cockpitProjectDir(project) {
  const hostDir = process.env.WORKSPACE_HOST_DIR || '';
  const name = String(project || 'default').trim();
  if (!hostDir || !name || name.includes('/') || name.includes('\\') || name === '..') {
    return null;
  }
  return require('path').join(hostDir, name);
}

router.get('/agent/workspace/tree', async (req, res) => {
  const root = cockpitProjectDir(req.query.project);
  if (!root) {
    return res.status(400).json({ message: 'invalid project' });
  }
  const path = require('path');
  const fsp = require('fs').promises;
  const entries = [];
  const MAX = 3000;
  async function walk(dir, rel, depth) {
    if (entries.length >= MAX || depth > 8) {
      return;
    }
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
    );
    for (const e of dirents) {
      if (entries.length >= MAX) {
        break;
      }
      if (COCKPIT_IGNORE.has(e.name)) {
        continue;
      }
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        entries.push({ path: childRel, type: 'dir' });
        await walk(path.join(dir, e.name), childRel, depth + 1);
      } else if (e.isFile()) {
        entries.push({ path: childRel, type: 'file' });
      }
    }
  }
  await walk(root, '', 0);
  return res.status(200).json({ entries, truncated: entries.length >= MAX });
});

router.get('/agent/workspace/file', async (req, res) => {
  const root = cockpitProjectDir(req.query.project);
  if (!root) {
    return res.status(400).json({ message: 'invalid project' });
  }
  const path = require('path');
  const target = path.resolve(root, String(req.query.path || ''));
  if (target !== root && !target.startsWith(root + path.sep)) {
    return res.status(400).json({ message: 'path outside workspace' });
  }
  try {
    const fsp = require('fs').promises;
    const stat = await fsp.stat(target);
    if (!stat.isFile()) {
      return res.status(400).json({ message: 'not a file' });
    }
    if (stat.size > 512 * 1024) {
      return res.status(413).json({ message: 'file too large to preview', size: stat.size });
    }
    const content = await fsp.readFile(target, 'utf-8');
    return res.status(200).json({ path: String(req.query.path || ''), content, size: stat.size });
  } catch {
    return res.status(404).json({ message: 'file not found' });
  }
});

// Deliver a permission decision (allow | deny | always) for a paused agent run.
router.post('/agent/respond/:taskId', async (req, res) => {
  try {
    const { requestId, decision } = req.body ?? {};
    if (!requestId || !['allow', 'deny', 'always'].includes(decision)) {
      return res.status(400).json({ message: 'requestId and a valid decision are required' });
    }
    const ok = await respondAgentApproval(req.params.taskId, requestId, decision);
    return res.status(ok ? 200 : 404).json({ ok });
  } catch (error) {
    logger.error('[analytikul] approval respond failed', error);
    return res.status(500).json({ message: 'could not deliver decision' });
  }
});

// Return a client-executed (bridge) tool result to a run paused on tool_dispatch.
router.post('/agent/tool_result/:taskId', async (req, res) => {
  const meta = taskMeta.get(req.params.taskId);
  if (meta == null || meta.userId !== req.user.id) {
    return res.status(404).json({ message: 'unknown task' });
  }
  try {
    const { requestId, result } = req.body ?? {};
    if (!requestId || typeof result !== 'string') {
      return res.status(400).json({ message: 'requestId and a string result are required' });
    }
    const ok = await sendAgentToolResult(req.params.taskId, requestId, result);
    return res.status(ok ? 200 : 404).json({ ok });
  } catch (error) {
    logger.error('[analytikul] tool_result deliver failed', error);
    return res.status(500).json({ message: 'could not deliver tool result' });
  }
});

// Pair the current (logged-in) user with a local bridge: returns a one-time code the
// user pastes into the bridge process, authenticating it as this user thereafter.
router.post('/bridge/pair', (req, res) => {
  const code = crypto.randomBytes(18).toString('hex');
  bridgeCodes.set(code, { userId: req.user.id, expires: Date.now() + BRIDGE_CODE_TTL_MS });
  saveBridgeCodes();
  res.status(200).json({ code, server: process.env.APP_URL || '' });
});

// Issue the short-lived OpenClaw embed cookie (admin only). The iframe/assets/WS then
// carry this cookie; the /openclaw proxy validates it and injects the gateway token.
router.post('/oc-authorize', (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'admin only' });
  }
  res.cookie(ocGate.COOKIE, ocGate.issue(String(req.user.id)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/api/analytikul/openclaw',
    maxAge: ocGate.TTL_MS,
  });
  res.status(200).json({ ok: true, enabled: Boolean(ocGate.gatewayToken()) });
});

// Files tab → the user's paired bridge: list projects / tree / read a file on their machine.
router.post('/bridge/fs', async (req, res) => {
  const { op, project, path: relPath, message } = req.body ?? {};
  if (!['projects', 'tree', 'read', 'git-status', 'git-commit'].includes(op)) {
    return res.status(400).json({ error: 'unknown op' });
  }
  if (!bridgeUserPaired(req.user.id)) {
    return res.status(409).json({ error: 'no paired bridge' });
  }
  const requestId = crypto.randomBytes(9).toString('hex');
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      bridgeFsPending.delete(requestId);
      resolve(JSON.stringify({ error: 'bridge did not respond' }));
    }, BRIDGE_FS_TIMEOUT_MS);
    bridgeFsPending.set(requestId, { resolve, timer });
    bridgeDeliver(req.user.id, { kind: 'fs', request_id: requestId, op, project, path: relPath, message });
  });
  try {
    return res.status(200).json(JSON.parse(result));
  } catch {
    return res.status(200).json({ error: 'invalid bridge response' });
  }
});

router.get('/endpoints', async (req, res) => {
  try {
    const endpoints = await listUserEndpoints({ userId: req.user.id });
    res.status(200).json({ endpoints });
  } catch (error) {
    logger.error('[analytikul] list user endpoints failed', error);
    res.status(500).json({ message: 'could not load endpoints' });
  }
});

router.post('/endpoints', async (req, res) => {
  try {
    const { name, baseURL, apiKey, models } = req.body ?? {};
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      return res
        .status(400)
        .json({ message: 'name must be 1-48 chars (letters, numbers, space, . _ -)' });
    }
    if (RESERVED_ENDPOINT_NAMES.has(name.trim().toLowerCase())) {
      return res.status(400).json({ message: reservedNameMessage(name) });
    }
    if (typeof baseURL !== 'string' || baseURL.length === 0) {
      return res.status(400).json({ message: 'baseURL required' });
    }
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return res.status(400).json({ message: 'apiKey required' });
    }
    const modelsCheck = validateModelsField(models);
    if (!modelsCheck.ok) {
      return res.status(400).json({ message: modelsCheck.message });
    }
    const decision = await validateUrl(baseURL);
    if (!decision.allowed) {
      return res.status(400).json({
        message: SSRF_MESSAGES[decision.reason] ?? 'That URL is not allowed.',
        reason: decision.reason,
      });
    }
    // When the user leaves models blank, auto-detect them from the endpoint's
    // /models, pinned to the SSRF-validated IP (one-shot at creation — runtime
    // stays fetch:false so we never re-resolve a user URL per request).
    let resolvedModels = modelsCheck.value;
    if (resolvedModels.length === 0) {
      try {
        resolvedModels = await fetchEndpointModels(baseURL, apiKey, decision.resolvedIp);
      } catch (error) {
        logger.warn(`[analytikul] model auto-fetch failed for ${name}: ${error.message}`);
        resolvedModels = [];
      }
    }
    const endpoint = await createUserEndpoint({
      userId: req.user.id,
      name,
      baseURL,
      apiKey,
      models: resolvedModels,
    });
    res.status(201).json({ endpoint });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'you already have an endpoint with that name' });
    }
    logger.error('[analytikul] create user endpoint failed', error);
    res.status(500).json({ message: 'could not create endpoint' });
  }
});

router.put('/endpoints/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'endpoint not found' });
    }
    const { name, baseURL, apiKey, models } = req.body ?? {};
    const updates = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !NAME_RE.test(name)) {
        return res
          .status(400)
          .json({ message: 'name must be 1-48 chars (letters, numbers, space, . _ -)' });
      }
      if (RESERVED_ENDPOINT_NAMES.has(name.trim().toLowerCase())) {
        return res.status(400).json({ message: reservedNameMessage(name) });
      }
      updates.name = name;
    }
    if (baseURL !== undefined) {
      if (typeof baseURL !== 'string' || baseURL.length === 0) {
        return res.status(400).json({ message: 'baseURL must be a non-empty string' });
      }
      const decision = await validateUrl(baseURL);
      if (!decision.allowed) {
        return res.status(400).json({
          message: SSRF_MESSAGES[decision.reason] ?? 'That URL is not allowed.',
          reason: decision.reason,
        });
      }
      updates.baseURL = baseURL;
    }
    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        return res.status(400).json({ message: 'apiKey must be a non-empty string' });
      }
      updates.apiKey = apiKey;
    }
    if (models !== undefined) {
      const modelsCheck = validateModelsField(models);
      if (!modelsCheck.ok) {
        return res.status(400).json({ message: modelsCheck.message });
      }
      updates.models = modelsCheck.value;
    }
    const endpoint = await updateUserEndpoint({ userId: req.user.id, id: req.params.id, updates });
    if (!endpoint) {
      return res.status(404).json({ message: 'endpoint not found' });
    }
    res.status(200).json({ endpoint });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'you already have an endpoint with that name' });
    }
    logger.error('[analytikul] update user endpoint failed', error);
    res.status(500).json({ message: 'could not update endpoint' });
  }
});

router.delete('/endpoints/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'endpoint not found' });
    }
    const deleted = await deleteUserEndpoint({ userId: req.user.id, id: req.params.id });
    res.status(deleted ? 200 : 404).json({ deleted });
  } catch (error) {
    logger.error('[analytikul] delete user endpoint failed', error);
    res.status(500).json({ message: 'could not delete endpoint' });
  }
});

/* ---------------- Notes (Open WebUI-parity notes workspace) ---------------- */

const noteScope = (req) => ({
  $or: [{ user: req.user.id }, { tenantId: tenantOf(req), sharedWithOrg: true }],
});

router.get('/notes', async (req, res) => {
  try {
    const q = (req.query.q ?? '').toString().trim().slice(0, 200);
    const safeQ = escapeRegex(q);
    const filter = q
      ? { $and: [noteScope(req), { $or: [{ title: { $regex: safeQ, $options: 'i' } }, { content: { $regex: safeQ, $options: 'i' } }] }] }
      : noteScope(req);
    const notes = await Note.find(filter)
      .select('title user sharedWithOrg pinnedBy updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    res.status(200).json({ notes });
  } catch (error) {
    logger.error('[analytikul] notes list failed', error);
    res.status(500).json({ message: 'failed to list notes' });
  }
});

router.post('/notes', async (req, res) => {
  try {
    const note = await Note.create({
      user: req.user.id,
      tenantId: tenantOf(req),
      title: req.body?.title ?? 'Untitled',
      content: req.body?.content ?? '',
    });
    res.status(201).json({ note });
  } catch (error) {
    logger.error('[analytikul] note create failed', error);
    res.status(500).json({ message: 'failed to create note' });
  }
});

router.get('/notes/:id', async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, ...noteScope(req) }).lean();
  if (note == null) {
    return res.status(404).json({ message: 'note not found' });
  }
  res.status(200).json({ note });
});

router.put('/notes/:id', async (req, res) => {
  const update = {};
  for (const field of ['title', 'content', 'sharedWithOrg']) {
    if (req.body?.[field] !== undefined) {
      update[field] = req.body[field];
    }
  }
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    { $set: update },
    { new: true },
  ).lean();
  if (note == null) {
    return res.status(404).json({ message: 'note not found or not yours' });
  }
  res.status(200).json({ note });
});

router.delete('/notes/:id', async (req, res) => {
  const result = await Note.deleteOne({ _id: req.params.id, user: req.user.id });
  res.status(result.deletedCount > 0 ? 200 : 404).json({ deleted: result.deletedCount > 0 });
});

router.post('/notes/:id/pin', async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, ...noteScope(req) });
  if (note == null) {
    return res.status(404).json({ message: 'note not found' });
  }
  const pinned = note.pinnedBy.includes(req.user.id);
  await Note.updateOne(
    { _id: note._id },
    pinned ? { $pull: { pinnedBy: req.user.id } } : { $addToSet: { pinnedBy: req.user.id } },
    { timestamps: false },
  );
  res.status(200).json({ pinned: !pinned });
});

const NOTE_AI_PROMPTS = {
  enhance:
    'Improve the following text: fix grammar and spelling, tighten wording, keep the original meaning, tone, language, and markdown formatting. Reply with ONLY the improved text, no preamble.',
  summarize:
    'Summarize the following text as concise markdown bullet points. Reply with ONLY the summary, no preamble.',
  continue:
    'Continue writing the following text in the same style, tone, and language. Reply with ONLY the continuation (do not repeat the original), no preamble.',
};

router.post('/notes/ai', notesAiLimiter, async (req, res) => {
  try {
    const { action, text, noteId } = req.body ?? {};
    const prompt = NOTE_AI_PROMPTS[action];
    if (!prompt || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ message: 'action (enhance|summarize|continue) and text required' });
    }
    const budget = await checkBudget(req.user.id, tenantOf(req));
    if (!budget.allowed) {
      return res.status(402).json({ message: 'Budget exceeded', budget });
    }
    const effectiveProvider = process.env.AGENT_DEFAULT_PROVIDER ?? 'anthropic';
    const vaultedKey = await getVaultedKey(req.user.id, effectiveProvider, tenantOf(req));
    if (budget.degraded && !vaultedKey) {
      return res
        .status(503)
        .json({ message: 'Budget service unavailable; platform-key runs are paused.' });
    }
    const result = await collectAgentRun(
      {
        message: `${prompt}\n\n<text>\n${text.slice(0, 24000)}\n</text>`,
        conversationId: `note-${noteId ?? 'scratch'}`,
        model: process.env.AGENT_DEFAULT_MODEL,
        provider: effectiveProvider,
        baseUrl: process.env.AGENT_DEFAULT_BASE_URL,
        // Smallest real toolset: an empty list is falsy in the runtime and would
        // enable everything. 'todo' gives one harmless tool the model won't use.
        enabledToolsets: ['todo'],
      },
      {
        userId: req.user.id,
        tenantId: tenantOf(req),
        apiKey: vaultedKey ?? process.env.AGENT_DEFAULT_API_KEY,
      },
    );
    res.status(200).json({ result });
  } catch (error) {
    logger.error('[analytikul] note ai failed', error);
    const status = error instanceof AdapterError ? error.status : 500;
    res.status(status).json({ message: error.message ?? 'note ai failed' });
  }
});

/* ---------------- Annotations (Diigo-style highlights on chat content) ---------------- */
// Annotations are PRIVATE per user (no shared-with-org for MVP). Each is tied
// to one assistant message in one conversation; the sidebar tree groups them
// by conversation, the chat re-injects them as <mark> spans on render.
const ANNOTATION_LIMITS = {
  highlightedText: 8000,
  containingParagraph: 16000,
  context: 200,
  note: 2000,
};
const clampStr = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const validId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128;

router.get('/annotations', async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? String(req.query.conversationId).slice(0, 128)
      : null;
    const filter = { user: req.user.id };
    if (conversationId) {
      filter.conversationId = conversationId;
    }
    const annotations = await Annotation.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.status(200).json({ annotations });
  } catch (error) {
    logger.error('[analytikul] annotations list failed', error);
    res.status(500).json({ message: 'failed to list annotations' });
  }
});

router.get('/annotations/conversations', async (req, res) => {
  try {
    // Aggregate: distinct conversationIds with counts + most recent createdAt
    // for ordering the sidebar tree.
    const rows = await Annotation.aggregate([
      { $match: { user: req.user.id } },
      {
        $group: {
          _id: '$conversationId',
          count: { $sum: 1 },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: 500 },
    ]);
    const conversations = rows.map((r) => ({
      conversationId: r._id,
      count: r.count,
      lastAt: r.lastAt,
    }));
    res.status(200).json({ conversations });
  } catch (error) {
    logger.error('[analytikul] annotations conversations failed', error);
    res.status(500).json({ message: 'failed to list annotation conversations' });
  }
});

router.post('/annotations', async (req, res) => {
  try {
    const { conversationId, messageId } = req.body ?? {};
    if (!validId(conversationId) || !validId(messageId)) {
      return res.status(400).json({ message: 'conversationId and messageId are required' });
    }
    const highlightedText = clampStr(req.body?.highlightedText, ANNOTATION_LIMITS.highlightedText);
    if (!highlightedText.trim()) {
      return res.status(400).json({ message: 'highlightedText is required' });
    }
    const annotation = await Annotation.create({
      user: req.user.id,
      tenantId: tenantOf(req),
      conversationId,
      messageId,
      highlightedText,
      containingParagraph: clampStr(req.body?.containingParagraph, ANNOTATION_LIMITS.containingParagraph),
      contextBefore: clampStr(req.body?.contextBefore, ANNOTATION_LIMITS.context),
      contextAfter: clampStr(req.body?.contextAfter, ANNOTATION_LIMITS.context),
      note: clampStr(req.body?.note, ANNOTATION_LIMITS.note),
    });
    res.status(201).json({ annotation });
  } catch (error) {
    logger.error('[analytikul] annotation create failed', error);
    res.status(500).json({ message: 'failed to create annotation' });
  }
});

router.put('/annotations/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'invalid annotation id' });
  }
  // Allowlist: only `note` is mutable post-create.
  const update = {};
  if (req.body?.note !== undefined) {
    update.note = clampStr(req.body.note, ANNOTATION_LIMITS.note);
  }
  const annotation = await Annotation.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    { $set: update },
    { new: true },
  ).lean();
  if (annotation == null) {
    return res.status(404).json({ message: 'annotation not found or not yours' });
  }
  res.status(200).json({ annotation });
});

router.delete('/annotations/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'invalid annotation id' });
  }
  const result = await Annotation.deleteOne({ _id: req.params.id, user: req.user.id });
  res.status(result.deletedCount > 0 ? 200 : 404).json({ deleted: result.deletedCount > 0 });
});

// Cascade: caller (the conversation-delete proxy) hits this when a conversation
// is removed so its annotations don't orphan. Scoped by owner.
router.delete('/annotations/by-conversation/:conversationId', async (req, res) => {
  const conversationId = String(req.params.conversationId).slice(0, 128);
  const result = await Annotation.deleteMany({ user: req.user.id, conversationId });
  res.status(200).json({ deleted: result.deletedCount });
});

const GATEWAY_URL = process.env.GATEWAY_SERVICE_URL ?? 'http://localhost:8014';

router.post('/telegram/link-code', async (req, res) => {
  try {
    const upstream = await fetch(`${GATEWAY_URL}/telegram/link-code`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ org_id: tenantOf(req), user_id: req.user.id }),
      signal: AbortSignal.timeout(5000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] telegram link-code failed', error);
    res.status(502).json({ message: 'gateway unavailable' });
  }
});

const MEMORY_URL = process.env.MEMORY_SERVICE_URL ?? 'http://localhost:8012';

router.get('/memory', async (req, res) => {
  try {
    const url = new URL(`${MEMORY_URL}/memories`);
    url.searchParams.set('orgId', tenantOf(req));
    const upstream = await fetch(url, {
      headers: internalHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] memory list failed', error);
    res.status(502).json({ message: 'memory service unavailable' });
  }
});

router.post('/memory', async (req, res) => {
  try {
    const upstream = await fetch(`${MEMORY_URL}/memories`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        orgId: tenantOf(req),
        content: req.body?.content,
        tags: req.body?.tags ?? [],
        sourceUserId: req.user.id,
        sourceConversationId: req.body?.conversationId,
      }),
      signal: AbortSignal.timeout(10000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] memory save failed', error);
    res.status(502).json({ message: 'memory service unavailable' });
  }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    const url = new URL(`${MEMORY_URL}/memories/${encodeURIComponent(req.params.id)}`);
    url.searchParams.set('orgId', tenantOf(req));
    const upstream = await fetch(url, {
      method: 'DELETE',
      headers: internalHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] memory delete failed', error);
    res.status(502).json({ message: 'memory service unavailable' });
  }
});

// Daily Logs (per-user, read-only) — proxied from the memory engine, scoped to req.user.id.
router.get('/daily-logs', async (req, res) => {
  try {
    const url = new URL(`${MEMORY_URL}/daily-logs`);
    url.searchParams.set('userId', req.user.id);
    if (req.query.limit) {
      url.searchParams.set('limit', String(req.query.limit));
    }
    const upstream = await fetch(url, {
      headers: internalHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] daily-logs list failed', error);
    res.status(502).json({ message: 'memory service unavailable' });
  }
});

router.get('/daily-logs/:date', async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ message: 'invalid date' });
    }
    const url = new URL(`${MEMORY_URL}/daily-logs/${req.params.date}`);
    url.searchParams.set('userId', req.user.id);
    const upstream = await fetch(url, {
      headers: internalHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] daily-log get failed', error);
    res.status(502).json({ message: 'memory service unavailable' });
  }
});

// Start a Stripe Checkout for a plan/add-on. Authed (req.user); the client calls this with the
// bearer token and redirects the browser to the returned Stripe URL.
const CHECKOUT_PLANS = new Set(['pro', 'team', 'powertools']);
router.post('/billing/checkout', async (req, res) => {
  try {
    const plan = req.body?.plan;
    if (!CHECKOUT_PLANS.has(plan)) {
      return res.status(400).json({ message: 'invalid plan' });
    }
    const interval = req.body?.interval === 'year' ? 'year' : 'month';
    const base = process.env.DOMAIN_CLIENT || 'https://analytikul.ai';
    const out = await createCheckout({
      orgId: tenantOf(req),
      plan,
      interval,
      successUrl: `${base}/chat?upgraded=1`,
      cancelUrl: `${base}/pricing`,
    });
    res.json(out);
  } catch (error) {
    logger.error('[analytikul] checkout failed', error);
    res.status(502).json({ message: 'billing unavailable' });
  }
});

// The caller's org plan — used by the Agent panel to reflect tool entitlements.
router.get('/plan', async (req, res) => {
  try {
    res.json(await getOrgEntitlements(tenantOf(req)));
  } catch (error) {
    logger.error('[analytikul] plan lookup failed', error);
    res.json({ plan: 'free', powerTools: false });
  }
});

router.get('/agent/traces/:conversationId', async (req, res) => {
  try {
    const traces = await AgentTrace.find({
      user: req.user.id,
      conversationId: req.params.conversationId,
    })
      .sort({ startedAt: -1 })
      .limit(20)
      .lean();
    res.status(200).json({ traces });
  } catch (error) {
    logger.error('[analytikul] traces failed', error);
    res.status(500).json({ message: 'failed to load traces' });
  }
});

// List the user's recent agent sessions (one row per conversation). The client
// groups these by project folder for a Claude-Code-Desktop-style session switcher.
router.get('/agent/sessions', async (req, res) => {
  try {
    const rows = await AgentTrace.aggregate([
      { $match: { user: req.user.id } },
      { $sort: { startedAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          lastActivity: { $first: '$startedAt' },
          model: { $first: '$model' },
          status: { $first: '$status' },
          final: { $first: '$finalResponse' },
          runs: { $sum: 1 },
        },
      },
      { $sort: { lastActivity: -1 } },
      { $limit: 40 },
    ]);
    res.status(200).json({
      sessions: rows.map((s) => ({
        conversationId: s._id,
        lastActivity: s.lastActivity,
        model: s.model,
        status: s.status,
        final: typeof s.final === 'string' ? s.final.slice(0, 120) : '',
        runs: s.runs,
      })),
    });
  } catch (error) {
    logger.error('[analytikul] sessions failed', error);
    res.status(500).json({ message: 'failed to load sessions' });
  }
});

module.exports = router;
