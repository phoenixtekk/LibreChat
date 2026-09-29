import { useCallback, useEffect, useRef, useState } from 'react';
import { botsRpc, type ChatMessage, type SessionResumeResult } from './rpc';

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;
const BOT_CHAT_TITLE = 'Bot Chat';

/**
 * Poll-based chat against a bot's canonical "Bot Chat" session: resolve (or create) the session,
 * load its transcript with session.resume, submit via prompt.submit, then poll resume for the
 * reply. Live token streaming (broker SSE relay) is a later enhancement; polling keeps this
 * dependency-free and correct against request/response RPCs.
 */
export default function BotChat({
  botName,
  canonicalSessionId,
  token,
}: {
  botName: string;
  canonicalSessionId?: string;
  token: string | undefined;
}) {
  const [sessionId, setSessionId] = useState<string | null>(canonicalSessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const resolveSession = useCallback(async (): Promise<string> => {
    if (sessionId) {
      return sessionId;
    }
    const listed = await botsRpc<{ sessions: { id: string }[] }>(
      'session.list',
      { title: BOT_CHAT_TITLE, profile: botName, include_hidden: true },
      token,
    );
    const existing = listed.sessions?.[0]?.id;
    if (existing) {
      setSessionId(existing);
      return existing;
    }
    const created = await botsRpc<{ session_id: string }>(
      'session.create',
      { profile: botName, title: BOT_CHAT_TITLE, hidden: true },
      token,
    );
    setSessionId(created.session_id);
    return created.session_id;
  }, [sessionId, botName, token]);

  const load = useCallback(
    async (id: string) => {
      const res = await botsRpc<SessionResumeResult>('session.resume', { session_id: id }, token);
      setMessages(res.messages ?? []);
      return res.message_count ?? res.messages?.length ?? 0;
    },
    [token],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const id = await resolveSession();
        if (!cancelled) {
          await load(id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to open chat');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botName]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (body === '' || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setText('');
    try {
      const id = await resolveSession();
      const before = await load(id);
      await botsRpc('prompt.submit', { session_id: id, text: body }, token);
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const count = await load(id);
        if (count > before + 1) {
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'send failed');
    } finally {
      setBusy(false);
    }
  }, [text, busy, resolveSession, load, token]);

  return (
    <div className="mx-2 mb-1.5 flex h-72 flex-col rounded-lg bg-surface-secondary text-xs">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {messages.length === 0 && (
          <div className="text-text-tertiary">No messages yet. Say hello to {botName}.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-text-primary' : 'text-text-secondary'}>
            <span className="mr-1 text-[10px] uppercase text-text-tertiary">{m.role}</span>
            <span className="whitespace-pre-wrap">{String(m.content ?? '')}</span>
          </div>
        ))}
        {busy && <div className="text-text-tertiary">…thinking</div>}
      </div>
      {error != null && <div className="px-2 text-text-destructive">{error}</div>}
      <form
        className="flex items-end gap-1.5 border-t border-border-light p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={`Message ${botName}…`}
          aria-label={`Message ${botName}`}
          className="min-h-0 flex-1 resize-none rounded-lg bg-surface-primary px-2 py-1.5 outline-none"
        />
        <button
          type="submit"
          disabled={busy || text.trim() === ''}
          className="rounded-lg bg-surface-active px-2.5 py-1.5 text-text-primary disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
