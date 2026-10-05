#!/usr/bin/env node
// Analytikul — OpenClaw ops helper.
// A minimal internal service with the docker socket, scoped to EXACTLY ONE container
// (analytikul-openclaw). It exposes status/start/stop/restart/logs over the internal
// network, gated by the shared INTERNAL_SERVICE_TOKEN. This keeps docker-socket access
// out of analytikul-app: even if the app is compromised, this helper can only touch the
// one whitelisted container. Zero external dependencies.

import http from 'node:http';

const PORT = Number(process.env.OPS_PORT || 9099);
const HOST = '0.0.0.0';
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const SOCK = process.env.DOCKER_SOCK || '/var/run/docker.sock';
const CONTAINER = process.env.OPS_CONTAINER || 'analytikul-openclaw';
const ALLOWED = new Set(['start', 'stop', 'restart']);

function docker(method, path) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath: SOCK, method, path, headers: { host: 'docker' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, buf: Buffer.concat(chunks) }));
    });
    req.on('error', (e) => resolve({ status: 0, buf: Buffer.from(String(e)) }));
    req.end();
  });
}

// Docker multiplexed log stream: 8-byte header {stream,0,0,0,len32} per frame.
function demux(buf) {
  let out = '';
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    if (len <= 0 || i + 8 + len > buf.length) break;
    out += buf.slice(i + 8, i + 8 + len).toString('utf8');
    i += 8 + len;
  }
  return out || buf.toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (!TOKEN || (req.headers['x-internal-token'] || '') !== TOKEN) {
    return send(401, { error: 'unauthorized' });
  }
  const url = new URL(req.url, 'http://ops');

  if (req.method === 'GET' && url.pathname === '/status') {
    const r = await docker('GET', `/containers/${CONTAINER}/json`);
    if (r.status !== 200) return send(200, { name: CONTAINER, running: false, status: 'not found' });
    let j = {};
    try {
      j = JSON.parse(r.buf.toString());
    } catch {
      /* ignore */
    }
    const s = j.State || {};
    return send(200, {
      name: CONTAINER,
      status: s.Status || 'unknown',
      running: !!s.Running,
      health: (s.Health && s.Health.Status) || null,
      startedAt: s.StartedAt || null,
      image: (j.Config && j.Config.Image) || null,
    });
  }

  if (req.method === 'POST' && url.pathname === '/action') {
    let body = '';
    for await (const c of req) body += c;
    let action = '';
    try {
      action = JSON.parse(body || '{}').action;
    } catch {
      /* ignore */
    }
    if (!ALLOWED.has(action)) return send(400, { error: 'invalid action' });
    const r = await docker('POST', `/containers/${CONTAINER}/${action}?t=10`);
    const ok = r.status === 204 || r.status === 304;
    return send(ok ? 200 : r.status || 502, { ok, action, dockerStatus: r.status });
  }

  if (req.method === 'GET' && url.pathname === '/logs') {
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail') || 200), 1), 2000);
    const r = await docker('GET', `/containers/${CONTAINER}/logs?stdout=1&stderr=1&tail=${tail}`);
    return send(200, { logs: demux(r.buf).slice(-60000) });
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[openclaw-ops] listening ${HOST}:${PORT} scoped to container '${CONTAINER}'`);
  if (!TOKEN) console.error('[openclaw-ops] WARNING: INTERNAL_SERVICE_TOKEN unset — all requests rejected');
});
