// Thin JS wrapper per workspace rules — all logic lives in @librechat/api (packages/api/src/analytikul).
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  startAgentRun,
  cancelAgentRun,
  getAgentTools,
  pipeAgentStream,
  createTraceRecorder,
  checkBudget,
  AdapterError,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { AgentTrace } = require('~/db/models');

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
    const ctx = {
      userId: req.user.id,
      tenantId: req.user.tenantId,
      apiKey: process.env.AGENT_DEFAULT_API_KEY,
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
