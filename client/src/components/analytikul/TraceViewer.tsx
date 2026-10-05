import { useState } from 'react';
import { useLocalize } from '~/hooks';
import { OutputRenderer } from './renderers';
import type { AgentEvent } from './useAgentStream';

/**
 * Live agent trace: one row per significant event with expandable tool output,
 * per-call cost rows, and a running total in the header. This is the
 * observability surface Hermes Desktop lacks — every step is inspectable.
 */
export default function TraceViewer({
  events,
  totalCostUsd,
  totalTokens,
}: {
  events: AgentEvent[];
  totalCostUsd: number;
  totalTokens: number;
}) {
  const localize = useLocalize();
  const visible = events.filter((event) =>
    ['status', 'step', 'tool_start', 'tool_complete', 'cost_event', 'error'].includes(event.type),
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between rounded-md bg-surface-tertiary px-2 py-1 text-xs text-text-secondary">
        <span>
          {localize('com_atk_trace')} · {visible.length}
        </span>
        <span aria-live="polite">
          {`${totalTokens.toLocaleString()} ${localize('com_atk_tokens_unit')} · $${totalCostUsd.toFixed(4)}`}
        </span>
      </div>
      {visible.map((event) => (
        <TraceRow key={event.seq} event={event} />
      ))}
    </div>
  );
}

function TraceRow({ event }: { event: AgentEvent }) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);

  const time = new Date(event.ts * 1000).toLocaleTimeString();

  if (event.type === 'cost_event') {
    return (
      <div className="flex items-center justify-between px-2 py-0.5 text-xs text-text-tertiary">
        <span>
          {`⚡ ${event.model} · ${(event.input_tokens ?? 0).toLocaleString()}→${(
            event.output_tokens ?? 0
          ).toLocaleString()} ${localize('com_atk_tokens_unit')}`}
        </span>
        <span>{event.cost_usd != null ? `$${event.cost_usd.toFixed(5)}` : '—'}</span>
      </div>
    );
  }

  if (event.type === 'status' || event.type === 'step' || event.type === 'error') {
    return (
      <div
        className={`px-2 py-0.5 text-xs ${
          event.type === 'error' ? 'text-text-destructive' : 'text-text-tertiary'
        }`}
      >
        {event.type === 'status' && `● ${event.state}${event.model ? ` · ${event.model}` : ''}`}
        {event.type === 'step' && `↻ ${localize('com_atk_step')} ${event.seq}`}
        {event.type === 'error' && `✕ ${event.message}`}
      </div>
    );
  }

  const isComplete = event.type === 'tool_complete';
  const expandable = isComplete && Boolean(event.output);

  return (
    <div className="rounded-md border border-border-light bg-surface-primary-alt">
      <button
        type="button"
        className="flex w-full items-center justify-between px-2 py-1 text-left text-xs text-text-primary"
        onClick={() => expandable && setOpen((prev) => !prev)}
        aria-expanded={open}
        disabled={!expandable}
      >
        <span className="truncate">
          {isComplete ? '✓' : '▶'} <strong>{event.tool}</strong>
          {!isComplete && event.args != null && (
            <span className="text-text-tertiary"> {previewArgs(event.args)}</span>
          )}
        </span>
        <span className="ml-2 shrink-0 text-text-tertiary">{time}</span>
      </button>
      {open && event.output && (
        <div className="border-t border-border-light p-2">
          <OutputRenderer output={event.output} />
        </div>
      )}
    </div>
  );
}

function previewArgs(args: unknown): string {
  try {
    const text = JSON.stringify(args);
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  } catch {
    return '';
  }
}
