import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { ReactNode } from 'react';
import { useLocalize, useAuthContext } from '~/hooks';

interface DailyLog {
  log_date: string;
  title: string;
  content: string;
}

const md = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-3 mt-1 text-2xl font-semibold">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-2 mt-6 text-lg font-semibold text-text-primary">{children}</h2>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-3 leading-relaxed text-text-secondary">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-text-secondary">{children}</ul>
  ),
  li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
};

/** Read-only viewer for one day's Daily Log (system-generated markdown). */
export default function DailyLogsViewer() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { date } = useParams<{ date: string }>();
  const { token } = useAuthContext();
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [log, setLog] = useState<DailyLog | null>(null);

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    if (!date) {
      setState('missing');
      return;
    }
    const res = await fetch(`/api/analytikul/daily-logs/${date}`, { headers });
    if (!res.ok) {
      setState('missing');
      return;
    }
    const body = (await res.json()) as { log: DailyLog | null };
    if (!body.log) {
      setState('missing');
      return;
    }
    setLog(body.log);
    setState('ready');
  }, [date, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full w-full overflow-y-auto bg-surface-primary px-3 text-text-primary md:px-[18px]">
      <div className="mx-auto flex max-w-3xl flex-col pt-6">
        <button
          type="button"
          className="mb-4 flex w-fit items-center gap-1.5 rounded-xl px-2 py-1 text-sm text-text-tertiary transition hover:bg-surface-secondary hover:text-text-primary"
          onClick={() => navigate('/daily-logs')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {localize('com_atk_daily_logs_back')}
        </button>

        {state === 'loading' && (
          <div className="text-sm text-text-tertiary">{localize('com_atk_daily_logs_loading')}</div>
        )}
        {state === 'missing' && (
          <div className="rounded-2xl border border-border-light p-8 text-center text-sm text-text-tertiary">
            {localize('com_atk_daily_logs_notfound')}
          </div>
        )}
        {state === 'ready' && log && (
          <article className="pb-16">
            <ReactMarkdown components={md}>{log.content}</ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
