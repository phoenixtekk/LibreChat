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
  AdapterError,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { AgentTrace, Note } = require('~/db/models');

const router = express.Router();
const taskMeta = new Map();
const TASK_META_MAX = 1000;

router.use(requireJwtAuth);

router.post('/agent/run', async (req, res) => {
  try {
    const { message, conversationId, model, provider, baseUrl } = req.body ?? {};
    if (!message || !conversationId) {
      return res.status(400).json({ message: 'message and conversationId are required' });
    }
    const budget = await checkBudget(req.user.id, req.user.tenantId ?? 'default');
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
      req.user.tenantId ?? 'default',
    );
    const ctx = {
      userId: req.user.id,
      tenantId: req.user.tenantId,
      apiKey: vaultedKey ?? process.env.AGENT_DEFAULT_API_KEY,
    };
    const { taskId } = await startAgentRun(
      {
        message,
        conversationId,
        model: model ?? process.env.AGENT_DEFAULT_MODEL,
        provider: provider ?? process.env.AGENT_DEFAULT_PROVIDER,
        baseUrl: baseUrl ?? process.env.AGENT_DEFAULT_BASE_URL,
      },
      ctx,
    );
    if (taskMeta.size >= TASK_META_MAX) {
      taskMeta.delete(taskMeta.keys().next().value);
    }
    taskMeta.set(taskId, {
      userId: req.user.id,
      tenantId: req.user.tenantId,
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
  if (req.params.view === 'users' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'admin only' });
  }
  try {
    const url = new URL(ANALYTICS_URL + upstreamPath);
    url.searchParams.set('orgId', req.user.tenantId ?? 'default');
    const days = Number(req.query.days);
    if (Number.isFinite(days)) {
      url.searchParams.set('days', String(Math.min(days, 365)));
    }
    if (req.params.view === 'conversations') {
      url.searchParams.set('userId', req.user.id);
    }
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] analytics proxy failed', error);
    res.status(502).json({ message: 'analytics service unavailable' });
  }
});

router.get('/keys', async (req, res) => {
  try {
    res.status(200).json({ keys: await listVaultKeys(req.user.id, req.user.tenantId ?? 'default') });
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
    const key = await putVaultKey(req.user.id, provider, apiKey, req.user.tenantId ?? 'default');
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
    req.user.tenantId ?? 'default',
  );
  res.status(deleted ? 200 : 404).json({ deleted });
});

/* ---------------- Notes (Open WebUI-parity notes workspace) ---------------- */

const noteScope = (req) => ({
  $or: [{ user: req.user.id }, { tenantId: req.user.tenantId ?? 'default', sharedWithOrg: true }],
});

router.get('/notes', async (req, res) => {
  try {
    const q = (req.query.q ?? '').toString().trim();
    const filter = q
      ? { $and: [noteScope(req), { $or: [{ title: { $regex: q, $options: 'i' } }, { content: { $regex: q, $options: 'i' } }] }] }
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
      tenantId: req.user.tenantId ?? 'default',
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

router.post('/notes/ai', async (req, res) => {
  try {
    const { action, text, noteId } = req.body ?? {};
    const prompt = NOTE_AI_PROMPTS[action];
    if (!prompt || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ message: 'action (enhance|summarize|continue) and text required' });
    }
    const budget = await checkBudget(req.user.id, req.user.tenantId ?? 'default');
    if (!budget.allowed) {
      return res.status(402).json({ message: 'Budget exceeded', budget });
    }
    const effectiveProvider = process.env.AGENT_DEFAULT_PROVIDER ?? 'anthropic';
    const vaultedKey = await getVaultedKey(req.user.id, effectiveProvider, req.user.tenantId ?? 'default');
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
        tenantId: req.user.tenantId,
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

const GATEWAY_URL = process.env.GATEWAY_SERVICE_URL ?? 'http://localhost:8014';

router.post('/telegram/link-code', async (req, res) => {
  try {
    const upstream = await fetch(`${GATEWAY_URL}/telegram/link-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: req.user.tenantId ?? 'default', user_id: req.user.id }),
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
    url.searchParams.set('orgId', req.user.tenantId ?? 'default');
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: req.user.tenantId ?? 'default',
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
    url.searchParams.set('orgId', req.user.tenantId ?? 'default');
    const upstream = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
    res.status(upstream.status).json(await upstream.json());
  } catch (error) {
    logger.error('[analytikul] memory delete failed', error);
    res.status(502).json({ message: 'memory service unavailable' });
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
