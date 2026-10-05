import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import { useLocalize, useAuthContext } from '~/hooks';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import store from '~/store';

interface DailyLogItem {
  id: string;
  log_date: string;
  title: string;
  source: string;
  created_at: string;
  updated_at: string;
}

const dateKey = (isoOrDate: string) => isoOrDate.slice(0, 10);

const prettyDate = (isoOrDate: string) => {
  const [y, m, d] = dateKey(isoOrDate).split('-').map(Number);
  if (!y || !m || !d) {
    return dateKey(isoOrDate);
  }
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

/** Read-only list of the user's system-generated Daily Logs, newest first. */
export default function DailyLogsList() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { token } = useAuthContext();
  const [logs, setLogs] = useState<DailyLogItem[] | null>(null);

  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const showReopen = !sidebarExpanded && !isSmallScreen;

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    const res = await fetch('/api/analytikul/daily-logs', { headers });
    if (res.ok) {
      setLogs(((await res.json()) as { logs: DailyLogItem[] }).logs ?? []);
    } else {
      setLogs([]);
    }
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full w-full overflow-y-auto bg-surface-primary px-3 text-text-primary md:px-[18px]">
      <div className="mx-auto flex max-w-3xl flex-col pt-6">
        <div className="flex items-center gap-2 px-0.5 text-xl font-medium">
          {showReopen && <OpenSidebar className="shrink-0" />}
          {localize('com_atk_daily_logs_title')}
          {logs != null && (
            <span className="text-lg font-medium text-text-tertiary">{logs.length}</span>
          )}
        </div>
        <p className="mt-1 px-0.5 text-sm text-text-tertiary">
          {localize('com_atk_daily_logs_subtitle')}
        </p>

        {logs != null && logs.length === 0 && (
          <div className="mt-10 rounded-2xl border border-border-light p-8 text-center text-sm text-text-tertiary">
            {localize('com_atk_daily_logs_empty')}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {(logs ?? []).map((log) => {
            const key = dateKey(log.log_date);
            return (
              <button
                key={log.id}
                type="button"
                className="flex items-center justify-between rounded-2xl border border-border-light bg-surface-primary px-4 py-3 text-left transition hover:border-border-medium hover:bg-surface-secondary"
                onClick={() => navigate(`/daily-logs/${key}`)}
              >
                <span className="font-medium">{prettyDate(log.log_date)}</span>
                <span className="text-xs text-text-tertiary">{key}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
