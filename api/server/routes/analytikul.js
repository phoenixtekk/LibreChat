// Thin JS wrapper per workspace rules — all logic lives in @librechat/api (packages/api/src/analytikul).
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  startAgentRun,
  collectAgentRun,
  cancelAgentRun,
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
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { AgentTrace, Note, Annotation } = require('~/db/models');
const mongoose = require('mongoose');

const router = express.Router();

// Per-route rate limiters. Per-USER (authenticated) is the right key here; IP
// is a fallback when the request slips in before JWT auth would have run.
const userKey = (req) => (req.user && req.user.id ? `u:${req.user.id}` : `ip:${req.ip}`);
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

router.use(requireJwtAuth);
// Apply a generous baseline cap to every authenticated /api/analytikul call.
// Expensive routes layer a stricter limiter on top.
router.use(generalLimiter);

router.post('/agent/run', agentRunLimiter, async (req, res) => {
  try {
    const { message, conversationId, model, provider, baseUrl, enabledToolsets, disabledToolsets } =
      req.body ?? {};
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
    await pipeAgentStream(taskId, res, recorder.onEvent);
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

module.exports = router;
