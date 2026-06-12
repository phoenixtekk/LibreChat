import { useEffect } from 'react';
import { useLocalize } from '~/hooks';
import AgentPanel from './AgentPanel';
import AnalyticsDashboard from './AnalyticsDashboard';
import OrgMemoryPanel from './OrgMemoryPanel';
import { OutputRenderer, latestRenderableOutput } from './renderers';
import type { AgentStreamApi } from './useAgentStream';

export type RailTab = 'agent' | 'preview' | 'costs' | 'memory' | 'files';

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

  useEffect(() => {
    if (stream.state === 'running' && latestOutput != null && tab === 'files') {
      setTab('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestOutput != null]);

  const tabs: { id: RailTab; label: string }[] = [
    { id: 'agent', label: localize('com_atk_agent') },
    { id: 'preview', label: localize('com_atk_preview') },
    { id: 'costs', label: localize('com_atk_costs') },
    { id: 'memory', label: localize('com_atk_memory') },
    { id: 'files', label: localize('com_atk_files') },
  ];

  return (
    <aside className="atk-preview-rail" data-open={open} aria-hidden={!open}>
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
        {tab === 'preview' &&
          (latestOutput != null ? (
            <OutputRenderer output={latestOutput} />
          ) : (
            <div className="atk-empty-state">
              <strong>{localize('com_atk_preview_rail')}</strong>
              <span>{localize('com_atk_preview_empty')}</span>
            </div>
          ))}
        {tab === 'files' && (
          <div className="atk-empty-state">
            <strong>{localize('com_atk_file_browser')}</strong>
            <span>{localize('com_atk_files_empty')}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
