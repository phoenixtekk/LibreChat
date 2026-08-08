import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';

interface OcStatus {
  running?: boolean;
  status?: string;
  health?: string | null;
  image?: string | null;
  startedAt?: string | null;
}

const BTN =
  'rounded border border-border-medium px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40';

/**
 * Admin-only OpenClaw surface: a manage bar (status + start/stop/restart + logs, via the
 * scoped ops helper) above the embedded Control UI (reverse-proxied under Analytikul).
 */
export default function OpenClawPanel() {
  const { token } = useAuthContext();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const [phase, setPhase] = useState<'authorizing' | 'ready' | 'denied' | 'error'>('authorizing');
  const [gatewayToken, setGatewayToken] = useState('');
  const [status, setStatus] = useState<OcStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [logs, setLogs] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const authed = useRef(false);

  const fetchStatus = useCallback(() => {
    fetch('/api/analytikul/oc-manage/status', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OcStatus | null) => {
        if (d) {
          setStatus(d);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (authed.current) {
      return;
    }
    authed.current = true;
    fetch('/api/analytikul/oc-authorize', { method: 'POST', headers: authHeaders })
      .then((r) => {
        if (r.status === 403) {
          setPhase('denied');
          return null;
        }
        if (!r.ok) {
          setPhase('error');
          return null;
        }
        return r.json();
      })
      .then((d: { token?: string } | null) => {
        if (d) {
          setGatewayToken(d.token ?? '');
          setPhase('ready');
          fetchStatus();
        }
      })
      .catch(() => setPhase('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, fetchStatus]);

  useEffect(() => {
    if (phase !== 'ready') {
      return;
    }
    const id = setInterval(fetchStatus, 15000);
    return () => clearInterval(id);
  }, [phase, fetchStatus]);

  const doAction = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      setBusy(action);
      try {
        await fetch('/api/analytikul/oc-manage/action', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        fetchStatus();
        if (action !== 'stop') {
          setIframeKey((k) => k + 1);
        }
        setBusy('');
      }, 3500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, fetchStatus],
  );

  const toggleLogs = useCallback(() => {
    if (logs !== null) {
      setLogs(null);
      return;
    }
    setLogs('loading…');
    fetch('/api/analytikul/oc-manage/logs?tail=300', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : { logs: 'error' }))
      .then((d: { logs?: string }) => setLogs(d.logs || '(empty)'))
      .catch(() => setLogs('error fetching logs'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, logs]);

  if (phase === 'authorizing') {
    return <div className="p-3 text-xs text-text-tertiary">Connecting to OpenClaw…</div>;
  }
  if (phase === 'denied') {
    return <div className="p-3 text-xs text-text-tertiary">OpenClaw is admin-only.</div>;
  }
  if (phase === 'error') {
    return <div className="p-3 text-xs text-text-destructive">Couldn’t reach OpenClaw.</div>;
  }

  const running = status?.running;
  const dot = running
    ? status?.health && status.health !== 'healthy'
      ? 'bg-yellow-500'
      : 'bg-green-500'
    : 'bg-red-500';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-light px-2 py-1.5 text-[11px]">
        <span className="flex items-center gap-1.5 text-text-secondary" title={status?.image || ''}>
          <span className={cn('inline-block h-2 w-2 rounded-full', dot)} aria-hidden="true" />
          {status ? (running ? `running${status.health ? ` · ${status.health}` : ''}` : status.status || 'stopped') : '…'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={BTN} disabled={!!busy || running} onClick={() => doAction('start')}>
            Start
          </button>
          <button type="button" className={BTN} disabled={!!busy || !running} onClick={() => doAction('stop')}>
            Stop
          </button>
          <button type="button" className={BTN} disabled={!!busy} onClick={() => doAction('restart')}>
            {busy === 'restart' ? 'Restarting…' : 'Restart'}
          </button>
          <button type="button" className={BTN} onClick={toggleLogs}>
            {logs !== null ? 'Hide logs' : 'Logs'}
          </button>
        </div>
      </div>
      {logs !== null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-b border-border-light bg-surface-primary p-2 font-mono text-[10px] text-text-secondary">
          {logs}
        </pre>
      )}
      {running ? (
        <iframe
          key={iframeKey}
          title="OpenClaw"
          src={`/api/analytikul/openclaw/${gatewayToken ? `#token=${encodeURIComponent(gatewayToken)}` : ''}`}
          className="w-full flex-1 border-0"
          allow="clipboard-read; clipboard-write; microphone; camera"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-text-tertiary">
          OpenClaw is stopped — click Start.
        </div>
      )}
    </div>
  );
}
