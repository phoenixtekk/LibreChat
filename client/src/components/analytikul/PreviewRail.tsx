import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocalize } from '~/hooks';
import AgentPanel from './AgentPanel';
import WorkspaceFiles from './WorkspaceFiles';
import TerminalConsole from './TerminalConsole';
import AnalyticsDashboard from './AnalyticsDashboard';
import OrgMemoryPanel from './OrgMemoryPanel';
import KeysPanel from './KeysPanel';
import { OutputRenderer, latestRenderableOutput } from './renderers';
import type { AgentStreamApi } from './useAgentStream';

const RAIL_MIN_PX = 440;
const RAIL_STORAGE_KEY = 'atk:previewRailWidth';

function readStoredWidth(): number | null {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n >= RAIL_MIN_PX ? n : null;
  } catch {
    return null;
  }
}

export type RailTab = 'agent' | 'preview' | 'costs' | 'memory' | 'keys' | 'files';

/**
 * Preview Rail — Hermes Desktop's side-by-side output panel. Agent tab launches
 * tasks with a live trace; Preview renders the latest tool output through the
 * renderer registry (image/html/json/terminal). Bottom sheet on mobile (CSS).
 */
export default function PreviewRail({
  open,
  onClose,
  stream,
  tab,
  setTab,
}: {
  open: boolean;
  onClose: () => void;
  stream: AgentStreamApi;
  tab: RailTab;
  setTab: (tab: RailTab) => void;
}) {
  const localize = useLocalize();
  const latestOutput = latestRenderableOutput(stream.events);
  const [width, setWidth] = useState<number>(() => readStoredWidth() ?? RAIL_MIN_PX);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (stream.state === 'running' && latestOutput != null && tab === 'files') {
      setTab('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestOutput != null]);

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (window.matchMedia('(max-width: 768px)').matches) {
        return;
      }
      event.preventDefault();
      dragStartRef.current = { startX: event.clientX, startWidth: width };
      const max = Math.round(window.innerWidth * 0.8);
      const handleMove = (e: PointerEvent) => {
        const drag = dragStartRef.current;
        if (!drag) {
          return;
        }
        const delta = drag.startX - e.clientX; // moving left = larger
        const next = Math.min(max, Math.max(RAIL_MIN_PX, drag.startWidth + delta));
        setWidth(next);
      };
      const handleEnd = () => {
        const final = dragStartRef.current;
        dragStartRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleEnd);
        window.removeEventListener('pointercancel', handleEnd);
        if (final) {
          try {
            // Persist whatever width is in state at this point (set via the
            // last handleMove); reading from the React state inside the
            // closure would be stale, so we re-read width via a ref or just
            // a final getter — simplest: persist on the next effect.
          } catch {
            /* noop */
          }
        }
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleEnd);
      window.addEventListener('pointercancel', handleEnd);
    },
    [width],
  );

  // Persist whenever width settles (debounced via effect: writes on every change).
  useEffect(() => {
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, String(width));
    } catch {
      /* noop */
    }
  }, [width]);

  const tabs: { id: RailTab; label: string }[] = [
    { id: 'agent', label: localize('com_atk_agent') },
    { id: 'preview', label: localize('com_atk_preview') },
    { id: 'costs', label: localize('com_atk_costs') },
    { id: 'memory', label: localize('com_atk_memory') },
    { id: 'keys', label: localize('com_atk_keys') },
    { id: 'files', label: localize('com_atk_files') },
  ];

  return (
    <aside
      className="atk-preview-rail"
      data-open={open}
      aria-hidden={!open}
      style={{ width: `${width}px` }}
    >
      <div
        className="atk-preview-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={localize('com_atk_resize_rail')}
        aria-valuemin={RAIL_MIN_PX}
        aria-valuenow={width}
        onPointerDown={onResizeStart}
        onDoubleClick={() => setWidth(RAIL_MIN_PX)}
      />
      <div className="atk-preview-rail-header">
        <div className="atk-preview-rail-tabs" role="tablist">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="atk-preview-rail-tab"
              data-active={tab === id}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="atk-preview-rail-tab"
          aria-label={localize('com_atk_close_rail')}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2 2l10 10M12 2L2 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="atk-preview-rail-body" role="tabpanel">
        {tab === 'agent' && <AgentPanel stream={stream} />}
        {tab === 'costs' && <AnalyticsDashboard />}
        {tab === 'memory' && <OrgMemoryPanel />}
        {tab === 'keys' && <KeysPanel />}
        {tab === 'preview' && <TerminalConsole stream={stream} />}
        {tab === 'files' && <WorkspaceFiles />}
      </div>
    </aside>
  );
}
