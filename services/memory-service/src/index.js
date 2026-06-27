// Analytikul memory-service — organizational memory with lineage.
// pgvector store under Postgres RLS (org isolation enforced in the database,
// not just the application), local transformers.js embeddings (no API key).
import http from 'node:http';
import crypto from 'node:crypto';
import { warmup } from './embedder.js';
import {
  migrate,
  saveMemory,
  searchMemories,
  listMemories,
  deleteMemory,
  upsertActiveEpisode,
  listEpisodes,
  listDailyLogs,
  getDailyLog,
  markDirty,
  retrieveContext,
  decayEpisodes,
} from './store.js';
import { startObserver, runObserverOnce, backfillRecent } from './observer.js';
import { startConsolidator, consolidateDay } from './consolidate.js';

const PORT = process.env.MEMORY_PORT || 8012;
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const log = (msg) => console.log(`[memory] ${msg}`);

async function collect(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks;
}

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

await migrate();
log('postgres schema ready (RLS enforced)');
if (!INTERNAL_TOKEN) {
  log('WARNING: INTERNAL_SERVICE_TOKEN unset — memory endpoints are unauthenticated. Set it in prod.');
}
warmup(log).catch((err) => log(`embedder warmup failed: ${err.message}`));

if (process.env.MEMORY_OBSERVER_ENABLED !== 'false') {
  startObserver(log);
  startConsolidator(log);
  const decayMs = Number(process.env.MEMORY_DECAY_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
  const decayDays = Number(process.env.MEMORY_DECAY_DAYS ?? 90);
  setInterval(() => {
    decayEpisodes({ days: decayDays })
      .then((n) => n && log(`decay: lowered importance on ${n} episodes`))
      .catch((e) => log(`decay error: ${e.message}`));
  }, decayMs);
  log('observer + consolidator + decay started');
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
        return send(200, { status: 'ok', service: 'memory-service' });
      }

      if (!authorized(req)) {
        return send(401, { error: 'unauthorized' });
      }

      const orgId = url.searchParams.get('orgId') ?? 'default';

      if (url.pathname === '/memories' && req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!body.content || !body.sourceUserId) {
          return send(400, { error: 'content and sourceUserId required' });
        }
        const saved = await saveMemory({ orgId: body.orgId ?? orgId, ...body });
        return send(201, { memory: saved });
      }

      if (url.pathname === '/memories/search') {
        const query = url.searchParams.get('q');
        if (!query) {
          return send(400, { error: 'q required' });
        }
        const limit = Number(url.searchParams.get('limit') ?? 5);
        return send(200, { memories: await searchMemories({ orgId, query, limit }) });
      }

      if (url.pathname === '/memories' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return send(200, { memories: await listMemories({ orgId, limit }) });
      }

      const deleteMatch = url.pathname.match(/^\/memories\/(\d+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        const deleted = await deleteMemory({ orgId, id: Number(deleteMatch[1]) });
        return send(deleted ? 200 : 404, { deleted });
      }

      const userId = url.searchParams.get('userId');

      if (url.pathname === '/episodes' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(await collect(req)).toString() || '{}');
        if (!body.userId || !body.conversationId || !body.summary) {
          return send(400, { error: 'userId, conversationId, summary required' });
        }
        return send(201, { episode: await upsertActiveEpisode(body) });
      }

      if (url.pathname === '/episodes' && req.method === 'GET') {
        if (!userId) {
          return send(400, { error: 'userId required' });
        }
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return send(200, { episodes: await listEpisodes({ userId, limit }) });
      }

      if (url.pathname === '/observer/dirty' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(await collect(req)).toString() || '{}');
        if (!body.userId || !body.conversationId) {
          return send(400, { error: 'userId, conversationId required' });
        }
        await markDirty(body);
        return send(202, { ok: true });
      }

      if (url.pathname === '/daily-logs' && req.method === 'GET') {
        if (!userId) {
          return send(400, { error: 'userId required' });
        }
        const limit = Number(url.searchParams.get('limit') ?? 90);
        return send(200, { logs: await listDailyLogs({ userId, limit }) });
      }

      // Retrieval for chat injection: per-user recap + relevant episodes + facts + prefs.
      if (url.pathname === '/retrieve' && req.method === 'GET') {
        if (!userId) {
          return send(400, { error: 'userId required' });
        }
        const query = url.searchParams.get('q') ?? '';
        return send(200, await retrieveContext({ userId, query }));
      }

      const dailyLogMatch = url.pathname.match(/^\/daily-logs\/(\d{4}-\d{2}-\d{2})$/);
      if (dailyLogMatch && req.method === 'GET') {
        if (!userId) {
          return send(400, { error: 'userId required' });
        }
        const logDoc = await getDailyLog({ userId, date: dailyLogMatch[1] });
        return send(logDoc ? 200 : 404, { log: logDoc });
      }

      // ── ops triggers (internal): run a cycle on demand ──
      if (url.pathname === '/observe' && req.method === 'POST') {
        await runObserverOnce(log);
        return send(200, { ok: true });
      }

      if (url.pathname === '/consolidate' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(await collect(req)).toString() || '{}');
        const written = await consolidateDay({ date: body.date }, log);
        return send(200, { written });
      }

      if (url.pathname === '/backfill' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(await collect(req)).toString() || '{}');
        const result = await backfillRecent({ days: body.days ?? 7, limit: body.limit ?? 25 }, log);
        return send(200, result);
      }

      return send(404, { error: 'not found' });
    } catch (err) {
      log(`api error ${url.pathname}: ${err.message}`);
      return send(500, { error: 'internal error' });
    }
  })
  .listen(PORT, () => log(`listening on :${PORT}`));
