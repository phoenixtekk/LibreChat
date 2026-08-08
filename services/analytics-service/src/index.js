// Analytikul analytics-service — FinOps core.
// Consumes analytikul:cost_events (Redis Stream) into Postgres rollups and
// serves the summary/budget REST API used by the Express backend.
import http from 'node:http';
import crypto from 'node:crypto';
import { migrate } from './db.js';
import { handleApi } from './api.js';
import { startConsumer } from './consumer.js';

const PORT = process.env.ANALYTICS_PORT || 8011;
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const MAX_BODY = 256 * 1024;
const log = (msg) => console.log(`[analytics] ${msg}`);

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
log('postgres schema ready');
if (!INTERNAL_TOKEN) {
  log('WARNING: INTERNAL_SERVICE_TOKEN unset — analytics endpoints are unauthenticated. Set it in prod.');
}

startConsumer(log).catch((err) => {
  log(`consumer crashed: ${err.message}`);
  process.exit(1);
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/health' && !authorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body = null;
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'request body too large' }));
          return;
        }
        chunks.push(chunk);
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || 'null');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
    }
    try {
      const result = await handleApi(url, req.method, body);
      const status = result._status ?? 200;
      delete result._status;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      log(`api error ${url.pathname}: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  })
  .listen(PORT, () => log(`listening on :${PORT}`));
