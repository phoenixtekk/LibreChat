import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PermissionBits, PermissionTypes, Permissions } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import { Plus, Search, MoreHorizontal, Pencil, Copy, Trash2, Compass } from 'lucide-react';
import {
  useListAgentsQuery,
  useDeleteAgentMutation,
  useDuplicateAgentMutation,
} from '~/data-provider';
import ModelBuilderDrawer from './ModelBuilderDrawer';
import { useLocalize, useHasAccess } from '~/hooks';
import { cn } from '~/utils';

function ModelCard({
  agent,
  onEdit,
  onDuplicate,
  onDelete,
  canEdit,
}: {
  agent: Agent;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const localize = useLocalize();
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarUrl = agent.avatar?.filepath;

  return (
    <div className="group relative flex items-start gap-3 rounded-2xl border border-border-light bg-surface-secondary p-4 transition hover:border-border-medium">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        onClick={onEdit}
        disabled={!canEdit}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
            aria-hidden="true"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold text-text-secondary">
            {(agent.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">
            {agent.name ?? localize('com_atk_model_untitled')}
          </div>
          {agent.description ? (
            <div className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {agent.description}
            </div>
          ) : (
            <div className="mt-0.5 truncate text-xs text-text-tertiary">
              {agent.provider ?? ''} {agent.model ?? ''}
            </div>
          )}
        </div>
      </button>

      {canEdit && (
        <div className="relative shrink-0">
          <button
            type="button"
            className="rounded-lg p-1.5 text-text-secondary opacity-0 transition hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100"
            aria-label={localize('com_atk_model_actions')}
            onClick={() => setMenuOpen((p) => !p)}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-[60]"
                role="presentation"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-8 z-[61] w-36 overflow-hidden rounded-xl border border-border-light bg-surface-primary-alt py-1 shadow-xl">
                {[
                  { icon: Pencil, label: localize('com_atk_model_edit'), run: onEdit },
                  { icon: Copy, label: localize('com_atk_model_duplicate'), run: onDuplicate },
                  { icon: Trash2, label: localize('com_atk_model_delete'), run: onDelete, danger: true },
                ].map(({ icon: Icon, label, run, danger }) => (
                  <button
                    key={label}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition hover:bg-surface-hover',
                      danger ? 'text-red-500' : 'text-text-primary',
                    )}
                    onClick={() => {
                      setMenuOpen(false);
                      run();
                    }}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ModelsWorkspace() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [builder, setBuilder] = useState<{ open: boolean; agentId?: string; isNew: boolean }>({
    open: false,
    isNew: true,
  });

  const hasAccessToAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });
  const canCreate = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.CREATE,
  });

  const { data, isLoading } = useListAgentsQuery(
    { requiredPermission: PermissionBits.EDIT, limit: 100 },
    { enabled: hasAccessToAgents },
  );

  const duplicateAgent = useDuplicateAgentMutation();
  const deleteAgent = useDeleteAgentMutation();

  const agents = useMemo(() => data?.data ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return agents;
    }
    return agents.filter(
      (a) =>
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [agents, query]);

  const openNew = useCallback(() => setBuilder({ open: true, isNew: true, agentId: undefined }), []);
  const openEdit = useCallback(
    (id: string) => setBuilder({ open: true, isNew: false, agentId: id }),
    [],
  );
  const closeBuilder = useCallback(() => setBuilder((p) => ({ ...p, open: false })), []);

  const tabs = [
    { id: 'models', label: localize('com_atk_tab_models'), active: true, onClick: () => undefined },
    { id: 'prompts', label: localize('com_atk_sb_prompts'), onClick: () => navigate('/prompts/new') },
    { id: 'skills', label: localize('com_atk_sb_skills'), onClick: () => navigate('/skills') },
  ];

  return (
    <div className="h-full overflow-y-auto bg-surface-primary">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-5 flex items-center gap-5 border-b border-border-light pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(
                'relative pb-2 text-sm transition',
                t.active
                  ? 'font-semibold text-text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-blue-500'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              onClick={t.onClick}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-text-primary">
            {localize('com_atk_tab_models')}{' '}
            <span className="text-text-tertiary">{agents.length}</span>
          </h1>
          {canCreate && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600"
              onClick={openNew}
            >
              <Plus size={15} aria-hidden="true" />
              {localize('com_atk_model_new')}
            </button>
          )}
        </div>

        <div className="relative mb-5">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <input
            className="w-full rounded-xl border border-border-light bg-surface-secondary py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-secondary focus:border-border-medium focus:outline-none"
            placeholder={localize('com_atk_model_search_ph')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-text-secondary">{localize('com_ui_loading')}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-text-secondary">{localize('com_atk_model_empty')}</p>
            {canCreate && (
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600"
                onClick={openNew}
              >
                <Plus size={15} aria-hidden="true" />
                {localize('com_atk_model_new')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filtered.map((agent) => (
              <ModelCard
                key={agent.id}
                agent={agent}
                canEdit={canCreate}
                onEdit={() => openEdit(agent.id)}
                onDuplicate={() => duplicateAgent.mutate({ agent_id: agent.id })}
                onDelete={() => {
                  if (window.confirm(localize('com_atk_model_delete_confirm'))) {
                    deleteAgent.mutate({ agent_id: agent.id });
                  }
                }}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          className="mt-8 flex w-full items-center gap-3 rounded-2xl border border-border-light bg-surface-secondary p-4 text-left transition hover:border-border-medium"
          onClick={() => navigate('/agents')}
        >
          <Compass size={20} className="shrink-0 text-text-secondary" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {localize('com_atk_model_discover')}
            </div>
            <div className="text-xs text-text-secondary">
              {localize('com_atk_model_discover_sub')}
            </div>
          </div>
        </button>
      </div>

      <ModelBuilderDrawer
        open={builder.open}
        agentId={builder.agentId}
        isNew={builder.isNew}
        onClose={closeBuilder}
      />
    </div>
  );
}
