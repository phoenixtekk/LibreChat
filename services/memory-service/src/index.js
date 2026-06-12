// Analytikul memory-service — organizational memory with lineage.
// pgvector store under Postgres RLS (org isolation enforced in the database,
// not just the application), local transformers.js embeddings (no API key).
import http from 'node:http';
import { warmup } from './embedder.js';
import { migrate, saveMemory, searchMemories, listMemories, deleteMemory } from './store.js';

const PORT = process.env.MEMORY_PORT || 8012;
const log = (msg) => console.log(`[memory] ${msg}`);

await migrate();
log('postgres schema ready (RLS enforced)');
warmup(log).catch((err) => log(`embedder warmup failed: ${err.message}`));

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

      return send(404, { error: 'not found' });
    } catch (err) {
      log(`api error ${url.pathname}: ${err.message}`);
      return send(500, { error: 'internal error' });
    }
  })
  .listen(PORT, () => log(`listening on :${PORT}`));
