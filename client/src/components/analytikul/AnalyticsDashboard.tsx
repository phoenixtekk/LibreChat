import { useEffect, useState, useCallback } from 'react';
import { useLocalize } from '~/hooks';
import { useAuthContext } from '~/hooks';

interface DailyRow {
  day: string;
  cost_usd: number;
  calls: number;
  input_tokens: string;
  output_tokens: string;
}
interface ModelRow {
  model: string;
  provider: string;
  cost_usd: number;
  calls: number;
  input_tokens: string;
  output_tokens: string;
}
interface ConversationRow {
  conversation_id: string;
  cost_usd: number | null;
  calls: number;
  tokens: string;
  last_activity: string;
}
interface EventRow {
  ts: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  priced: boolean;
}
interface UnpricedRow {
  model: string;
  provider: string;
  calls: number;
  tokens: string;
}

interface Data {
  daily: DailyRow[];
  models: ModelRow[];
  conversations: ConversationRow[];
  events: EventRow[];
  unpriced: UnpricedRow[];
}

/**
 * FinOps dashboard — the "Analytikul" identity feature. Six panels of live
 * cost attribution sourced from the analytics-service rollups, rendered with
 * dependency-free SVG charts that follow the active skin via CSS variables.
 */
export default function AnalyticsDashboard() {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const get = async <T,>(view: string, key: string): Promise<T> => {
        const res = await fetch(`/api/analytikul/analytics/${view}?days=30`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(`${view}: ${res.status}`);
        }
        const body = (await res.json()) as Record<string, T>;
        return body[key];
      };
      const [daily, models, conversations, events, unpriced] = await Promise.all([
        get<DailyRow[]>('daily', 'days'),
        get<ModelRow[]>('models', 'models'),
        get<ConversationRow[]>('conversations', 'conversations'),
        get<EventRow[]>('events', 'events'),
        get<UnpricedRow[]>('unpriced', 'unpriced'),
      ]);
      setData({ daily, models, conversations, events, unpriced });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load analytics');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error != null) {
    return (
      <div className="atk-empty-state">
        <span className="text-text-destructive">{error}</span>
        <button
          type="button"
          className="rounded-md border border-border-medium px-3 py-1 text-sm"
          onClick={() => void load()}
        >
          {localize('com_atk_retry')}
        </button>
      </div>
    );
  }
  if (data == null) {
    return <div className="atk-empty-state">{localize('com_atk_loading')}</div>;
  }

  const totalSpend = data.models.reduce((sum, m) => sum + (m.cost_usd ?? 0), 0);
  const totalCalls = data.models.reduce((sum, m) => sum + m.calls, 0);
  const totalIn = data.models.reduce((sum, m) => sum + Number(m.input_tokens), 0);
  const totalOut = data.models.reduce((sum, m) => sum + Number(m.output_tokens), 0);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <Panel title={localize('com_atk_panel_overview')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={localize('com_atk_stat_spend')} value={`$${totalSpend.toFixed(4)}`} />
          <Stat label={localize('com_atk_stat_calls')} value={totalCalls.toLocaleString()} />
          <Stat label={localize('com_atk_stat_tokens_in')} value={totalIn.toLocaleString()} />
          <Stat label={localize('com_atk_stat_tokens_out')} value={totalOut.toLocaleString()} />
        </div>
      </Panel>

      <Panel title={localize('com_atk_panel_daily')}>
        <BarChart
          rows={data.daily.map((d) => ({
            label: d.day.slice(5, 10),
            value: d.cost_usd ?? 0,
          }))}
          format={(v) => `$${v.toFixed(4)}`}
        />
      </Panel>

      <Panel title={localize('com_atk_panel_models')}>
        <BarChart
          horizontal
          rows={data.models.slice(0, 8).map((m) => ({
            label: m.model,
            value: m.cost_usd ?? 0,
          }))}
          format={(v) => `$${v.toFixed(4)}`}
        />
      </Panel>

      <Panel title={localize('com_atk_panel_conversations')}>
        <table className="w-full text-xs">
          <tbody>
            {data.conversations.slice(0, 8).map((c) => (
              <tr key={c.conversation_id} className="border-b border-border-light">
                <td className="max-w-[160px] truncate py-1 pr-2">{c.conversation_id}</td>
                <td className="py-1 pr-2 text-text-tertiary">{c.calls}×</td>
                <td className="py-1 text-right">${(c.cost_usd ?? 0).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={localize('com_atk_panel_events')}>
        <table className="w-full text-xs">
          <tbody>
            {data.events.slice(0, 10).map((e, i) => (
              <tr key={i} className="border-b border-border-light">
                <td className="py-1 pr-2 text-text-tertiary">
                  {new Date(e.ts).toLocaleTimeString()}
                </td>
                <td className="max-w-[140px] truncate py-1 pr-2">{e.model}</td>
                <td className="py-1 pr-2 text-text-tertiary">
                  {e.input_tokens}→{e.output_tokens}
                </td>
                <td className="py-1 text-right">
                  {e.cost_usd != null ? `$${e.cost_usd.toFixed(5)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {data.unpriced.length > 0 && (
        <Panel title={localize('com_atk_panel_unpriced')}>
          <div className="text-xs text-text-warning">{localize('com_atk_unpriced_hint')}</div>
          {data.unpriced.map((u) => (
            <div key={u.model} className="flex justify-between text-xs">
              <span>{u.model}</span>
              <span className="text-text-tertiary">{u.calls}×</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border-light bg-surface-primary-alt p-2">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-tertiary p-2">
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      <div className="text-xs text-text-tertiary">{label}</div>
    </div>
  );
}

function BarChart({
  rows,
  format,
  horizontal = false,
}: {
  rows: { label: string; value: number }[];
  format: (v: number) => string;
  horizontal?: boolean;
}) {
  const localize = useLocalize();
  if (rows.length === 0) {
    return <div className="text-xs text-text-tertiary">{localize('com_atk_no_data')}</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1e-9);

  if (horizontal) {
    return (
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-xs">
            <span className="w-32 truncate text-text-secondary">{row.label}</span>
            <div className="h-3 flex-1 rounded-sm bg-surface-tertiary">
              <div
                className="h-3 rounded-sm bg-surface-submit"
                style={{ width: `${Math.max((row.value / max) * 100, 1)}%` }}
              />
            </div>
            <span className="w-20 text-right text-text-tertiary">{format(row.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  const width = 360;
  const height = 120;
  const barWidth = Math.max(width / rows.length - 4, 4);
  return (
    <svg viewBox={`0 0 ${width} ${height + 18}`} className="w-full" role="img">
      {rows.map((row, i) => {
        const barHeight = Math.max((row.value / max) * height, 1);
        const x = i * (width / rows.length) + 2;
        return (
          <g key={row.label}>
            <rect
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              fill="var(--surface-submit)"
            >
              <title>{`${row.label}: ${format(row.value)}`}</title>
            </rect>
            {rows.length <= 16 && (
              <text
                x={x + barWidth / 2}
                y={height + 12}
                textAnchor="middle"
                fontSize="8"
                fill="var(--text-tertiary)"
              >
                {row.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
