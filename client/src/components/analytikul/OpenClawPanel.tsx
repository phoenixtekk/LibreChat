import { useEffect, useRef, useState } from 'react';
import { useAuthContext } from '~/hooks';

/**
 * Admin-only embed of the containerized OpenClaw Control UI, reverse-proxied under
 * Analytikul (/api/analytikul/openclaw). Authorizes once (sets the gate cookie), then
 * iframes the Control UI — the proxy injects the gateway token and relays WebSockets.
 */
export default function OpenClawPanel() {
  const { token } = useAuthContext();
  const [status, setStatus] = useState<'authorizing' | 'ready' | 'denied' | 'error'>('authorizing');
  const authed = useRef(false);

  useEffect(() => {
    if (authed.current) {
      return;
    }
    authed.current = true;
    fetch('/api/analytikul/oc-authorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 403) {
          setStatus('denied');
          return null;
        }
        if (!r.ok) {
          setStatus('error');
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setStatus('ready');
        }
      })
      .catch(() => setStatus('error'));
  }, [token]);

  if (status === 'authorizing') {
    return <div className="p-3 text-xs text-text-tertiary">Connecting to OpenClaw…</div>;
  }
  if (status === 'denied') {
    return <div className="p-3 text-xs text-text-tertiary">OpenClaw is admin-only.</div>;
  }
  if (status === 'error') {
    return (
      <div className="p-3 text-xs text-text-destructive">
        Couldn’t reach OpenClaw. Is the gateway container running?
      </div>
    );
  }
  return (
    <iframe
      title="OpenClaw"
      src="/api/analytikul/openclaw/"
      className="h-full w-full border-0"
      allow="clipboard-read; clipboard-write; microphone; camera"
    />
  );
}
