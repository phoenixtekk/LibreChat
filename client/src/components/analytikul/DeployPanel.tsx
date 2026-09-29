import { useCallback, useEffect, useRef, useState } from 'react';
import { SSE } from 'sse.js';
import { useAuthContext } from '~/hooks';

/**
 * Deploy panel — Analytikul Coder's first-class Deploy. Ships a workspace project
 * to a fleet server (build → rsync → pm2 → verify) and surfaces the Cloudflare
 * route to wire up. Progress streams over the shared SSE endpoint (status | log |
 * done | error) — the same transport the agent trace uses.
 */

type DeployState = 'idle' | 'starting' | 'running' | 'done' | 'error';
const APP_TYPES = ['auto', 'static', 'node', 'next'] as const;
const STORE_KEY = 'atk:deploy:last';

interface DonePayload {
  ok?: boolean;
  server?: string;
  app_type?: string;
  port?: number;
  pm2_name?: string;
  remote_dir?: string;
  local_url?: string;
  http_code?: string;
  host?: string;
  cloudflare_route?: string | null;
  summary?: string;
}

export default function DeployPanel() {
  const { token } = useAuthContext();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [servers, setServers] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);

  const [project, setProject] = useState('');
  const [server, setServer] = useState('');
  const [appType, setAppType] = useState<string>('auto');
  const [domain, setDomain] = useState('');
  const [subdomain, setSubdomain] = useState('');

  const [state, setState] = useState<DeployState>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState<DonePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sseRef = useRef<SSE | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Load servers + projects, and restore last-used selections.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [srvRes, wsRes] = await Promise.all([
          fetch('/api/analytikul/agent/deploy/servers', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/analytikul/agent/workspaces', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const srv = (await srvRes.json().catch(() => ({}))) as {
          enabled?: boolean;
          servers?: string[];
        };
        const ws = (await wsRes.json().catch(() => ({}))) as { projects?: string[] };
        if (!alive) {
          return;
        }
        setEnabled(srv.enabled ?? false);
        setServers(srv.servers ?? []);
        setProjects(ws.projects ?? []);
        let last: { server?: string; domain?: string } = {};
        try {
          last = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        } catch {
          /* noop */
        }
        setServer(last.server && (srv.servers ?? []).includes(last.server) ? last.server : (srv.servers ?? [])[0] ?? '');
        if (last.domain) {
          setDomain(last.domain);
        }
        setProject((prev) => prev || (ws.projects ?? [])[0] || '');
      } catch {
        if (alive) {
          setEnabled(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    // auto-scroll the log
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  useEffect(() => () => sseRef.current?.close(), []);

  const deploy = useCallback(async () => {
    if (!project || !server) {
      return;
    }
    sseRef.current?.close();
    setState('starting');
    setLines([]);
    setResult(null);
    setError(null);
    setStatusMsg('Starting deploy…');
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ server, domain }));
    } catch {
      /* noop */
    }
    try {
      const res = await fetch('/api/analytikul/agent/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspace: project, server, domain, subdomain, appType }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `deploy failed (${res.status})`);
      }
      const { taskId } = (await res.json()) as { taskId: string };
      setState('running');

      const sse = new SSE(`/api/analytikul/agent/deploy/stream/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      sseRef.current = sse;
      sse.addEventListener('status', ((e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data) as { message?: string };
          if (d.message) {
            setStatusMsg(d.message);
            setLines((prev) => [...prev, `• ${d.message}`]);
          }
        } catch {
          /* noop */
        }
      }) as EventListener);
      sse.addEventListener('log', ((e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data) as { line?: string };
          if (d.line != null) {
            setLines((prev) => [...prev, d.line as string]);
          }
        } catch {
          /* noop */
        }
      }) as EventListener);
      sse.addEventListener('done', ((e: MessageEvent) => {
        try {
          setResult(JSON.parse(e.data) as DonePayload);
        } catch {
          /* noop */
        }
        setState('done');
        sse.close();
      }) as EventListener);
      sse.addEventListener('error', ((e: MessageEvent) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as { message?: string };
          if (d?.message) {
            setError(d.message);
          }
        } catch {
          /* noop */
        }
        setState((prev) => (prev === 'done' ? prev : 'error'));
      }) as EventListener);
      sse.stream();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deploy failed');
      setState('error');
    }
  }, [project, server, domain, subdomain, appType, token]);

  const busy = state === 'starting' || state === 'running';

  if (enabled === false) {
    return (
      <div className="atk-deploy" style={{ padding: '1rem' }}>
        <p style={{ opacity: 0.8 }}>
          Deploy is disabled. It requires <code>POWER_MODE</code> (the trusted single-tenant
          setup), since it runs commands on production fleet servers.
        </p>
      </div>
    );
  }

  return (
    <div className="atk-deploy" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.6rem', padding: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)} disabled={busy} style={inputStyle}>
            {projects.length === 0 && <option value="">(no projects)</option>}
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Server</span>
          <select value={server} onChange={(e) => setServer(e.target.value)} disabled={busy} style={inputStyle}>
            {servers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>App type</span>
          <select value={appType} onChange={(e) => setAppType(e.target.value)} disabled={busy} style={inputStyle}>
            {APP_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Domain (optional)</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} disabled={busy} placeholder="example.com" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Subdomain (optional)</span>
          <input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} disabled={busy} placeholder="app (blank = www)" style={inputStyle} />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            type="button"
            onClick={deploy}
            disabled={busy || !project || !server}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: 8,
              border: 'none',
              background: busy ? '#64748b' : '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: busy || !project ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Deploying…' : 'Deploy'}
          </button>
        </div>
      </div>

      {statusMsg && state !== 'idle' && (
        <div style={{ fontSize: 13, fontWeight: 600, color: state === 'error' ? '#dc2626' : '#2563eb' }}>
          {statusMsg}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13, color: '#dc2626', whiteSpace: 'pre-wrap' }}>⚠ {error}</div>
      )}

      {result && (
        <div style={{ border: '1px solid var(--border-medium,#334155)', borderRadius: 8, padding: '0.6rem', fontSize: 13, background: 'var(--surface-secondary,#0f172a11)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {result.ok ? '✅ Deployed' : '⚠ Finished with warnings'}
          </div>
          {result.summary && <div style={{ marginBottom: 6 }}>{result.summary}</div>}
          <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
            <div>server: {result.server} · type: {result.app_type} · port: {result.port} · http: {result.http_code}</div>
            <div>pm2: {result.pm2_name} · dir: {result.remote_dir}</div>
            <div>local: {result.local_url}</div>
          </div>
          {result.cloudflare_route ? (
            <div style={{ marginTop: 8, padding: '0.5rem', borderRadius: 6, background: '#2563eb18', border: '1px dashed #2563eb' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Add this Cloudflare route to go live:</div>
              <code style={{ fontSize: 12 }}>{result.cloudflare_route}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(result.cloudflare_route || '')}
                style={{ marginLeft: 8, fontSize: 11, cursor: 'pointer', background: 'transparent', border: '1px solid #2563eb', borderRadius: 4, color: '#2563eb', padding: '1px 6px' }}
              >
                copy
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              No domain given — add one above to get a Cloudflare route. The app is reachable on the
              server at the local URL above (behind the fleet firewall).
            </div>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <div
          ref={logRef}
          style={{
            flex: 1,
            minHeight: 120,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: 11.5,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            background: 'var(--surface-primary,#0b0f19)',
            color: 'var(--text-secondary,#cbd5e1)',
            borderRadius: 8,
            padding: '0.5rem 0.6rem',
            border: '1px solid var(--border-medium,#334155)',
          }}
        >
          {lines.map((ln, i) => (
            <div key={i}>{ln}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, opacity: 0.75 };
const inputStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  borderRadius: 6,
  border: '1px solid var(--border-medium,#334155)',
  background: 'var(--surface-primary,#0b0f19)',
  color: 'var(--text-primary,#e2e8f0)',
  fontSize: 13,
};
