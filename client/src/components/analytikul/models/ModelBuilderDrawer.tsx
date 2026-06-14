import React, { memo, useEffect, Component } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentPanelProvider, useAgentPanelContext } from '~/Providers/AgentPanelContext';
import AgentPanel from '~/components/SidePanel/Agents/AgentPanel';
import { Panel } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Drives the shared Agent Builder to create (id undefined) or edit a model. */
function BuilderDriver({ agentId }: { agentId?: string }) {
  const { setCurrentAgentId, setActivePanel } = useAgentPanelContext();
  useEffect(() => {
    setCurrentAgentId(agentId);
    setActivePanel(Panel.builder);
  }, [agentId, setCurrentAgentId, setActivePanel]);
  return <AgentPanel />;
}

/** Isolates any builder render failure so the Models grid stays usable. */
class BuilderBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ModelBuilderDrawer({
  open,
  agentId,
  isNew,
  onClose,
}: {
  open: boolean;
  agentId?: string;
  isNew: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[120] bg-black/40"
          role="presentation"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed right-0 top-0 z-[121] flex h-full w-[min(96vw,460px)] flex-col bg-surface-primary-alt shadow-2xl',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ transition: 'transform 280ms cubic-bezier(0.2, 0, 0, 1)' }}
        aria-hidden={!open}
        inert={!open ? '' : undefined}
      >
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
          <span className="text-sm font-semibold text-text-primary">
            {isNew ? localize('com_atk_model_new') : localize('com_atk_model_edit')}
          </span>
          <button
            type="button"
            className="rounded-xl p-1.5 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open && (
            <BuilderBoundary
              fallback={
                <div className="flex flex-col items-center gap-3 p-6 text-center">
                  <p className="text-sm text-text-secondary">{localize('com_atk_model_builder_fallback')}</p>
                  <button
                    type="button"
                    className="rounded-lg bg-surface-tertiary px-3 py-1.5 text-sm text-text-primary transition hover:bg-surface-hover"
                    onClick={() => navigate('/agents')}
                  >
                    {localize('com_atk_model_open_agents')}
                  </button>
                </div>
              }
            >
              <AgentPanelProvider>
                <BuilderDriver agentId={agentId} />
              </AgentPanelProvider>
            </BuilderBoundary>
          )}
        </div>
      </aside>
    </>
  );
}

export default memo(ModelBuilderDrawer);
