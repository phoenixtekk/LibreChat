// Analytikul analytics-service — FinOps core.
// Consumes analytikul:cost_events (Redis Stream) into Postgres rollups and
// serves the summary/budget REST API used by the Express backend.
import http from 'node:http';
import { migrate } from './db.js';
import { handleApi } from './api.js';
import { startConsumer } from './consumer.js';

const PORT = process.env.ANALYTICS_PORT || 8011;
const log = (msg) => console.log(`[analytics] ${msg}`);

await migrate();
log('postgres schema ready');

startConsumer(log).catch((err) => {
  log(`consumer crashed: ${err.message}`);
  process.exit(1);
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = null;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) {
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
