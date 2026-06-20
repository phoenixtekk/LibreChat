import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, ExternalLink, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { useMCPServersQuery } from '~/data-provider';
import { useMCPConnectionStatus, useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** /mcp page (Option 2a) — viewer/directory of MCP servers configured on the
 *  platform. Each card shows name, description, connection status, and a
 *  "Use in chat" CTA that opens a new conversation where the existing MCP
 *  selector in the composer handles per-user configuration.
 *
 *  This is NOT a per-user CRUD page (2b) — adding/removing MCP servers
 *  requires admin access to librechat.yaml. If demand justifies it, 2b
 *  becomes a follow-up build with a new user_mcp_servers data layer. */
export default function McpServers() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data, isLoading, error } = useMCPServersQuery();
  const { connectionStatus } = useMCPConnectionStatus();

  const servers = useMemo(() => Object.values(data ?? {}), [data]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="border-b border-border-light px-6 py-4">
        <div className="flex items-center gap-2">
          <Server size={18} className="text-text-secondary" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-text-primary">
            {localize('com_atk_mcp_title')}
          </h1>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          {localize('com_atk_mcp_subtitle')}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border-medium bg-surface-secondary px-4 py-6 text-sm text-text-secondary">
            {localize('com_atk_mcp_error')}
          </div>
        ) : servers.length === 0 ? (
          <EmptyState localize={localize} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {servers.map((server) => (
              <ServerCard
                key={server.serverName}
                server={server}
                state={connectionStatus?.[server.serverName]?.connectionState ?? 'disconnected'}
                onUseInChat={() => navigate('/c/new')}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

function ServerCard({
  server,
  state,
  onUseInChat,
}: {
  server: {
    serverName: string;
    title?: string;
    description?: string;
    iconPath?: string;
    customUserVars?: Record<string, unknown>;
  };
  state: ConnectionState | string;
  onUseInChat: () => void;
}) {
  const localize = useLocalize();
  const name = server.title || server.serverName;
  const description = server.description;
  const hasUserVars =
    !!server.customUserVars && Object.keys(server.customUserVars).length > 0;

  return (
    <li className="flex flex-col rounded-xl border border-border-light bg-surface-secondary p-4 transition hover:border-border-medium">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
          {server.iconPath ? (
            <img
              src={server.iconPath}
              alt=""
              aria-hidden="true"
              className="h-6 w-6 rounded"
            />
          ) : (
            <Server size={16} className="text-text-secondary" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium text-text-primary">{name}</h2>
            <StateBadge state={state as ConnectionState} localize={localize} />
          </div>
          {description && (
            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{description}</p>
          )}
        </div>
      </div>

      {hasUserVars && (
        <p className="mt-3 text-[11px] text-text-tertiary">
          {localize('com_atk_mcp_requires_config')}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onUseInChat}
          className="inline-flex items-center gap-1.5 rounded-md bg-surface-submit px-3 py-1.5 text-xs font-medium text-white transition hover:bg-surface-submit-hover"
        >
          <ExternalLink size={12} aria-hidden="true" />
          {localize('com_atk_mcp_use_in_chat')}
        </button>
      </div>
    </li>
  );
}

function StateBadge({
  state,
  localize,
}: {
  state: ConnectionState;
  localize: ReturnType<typeof useLocalize>;
}) {
  const map: Record<ConnectionState, { Icon: typeof CheckCircle2; classes: string; label: string }> = {
    connected: {
      Icon: CheckCircle2,
      classes: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30',
      label: localize('com_ui_active'),
    },
    connecting: {
      Icon: Clock,
      classes: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30',
      label: localize('com_ui_connecting'),
    },
    error: {
      Icon: AlertCircle,
      classes: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30',
      label: localize('com_ui_error'),
    },
    disconnected: {
      Icon: AlertCircle,
      classes: 'text-gray-700 bg-gray-200 dark:text-gray-300 dark:bg-gray-700/40',
      label: localize('com_ui_offline'),
    },
  };
  const entry = map[state] ?? map.disconnected;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        entry.classes,
      )}
    >
      <entry.Icon size={10} aria-hidden="true" />
      {entry.label}
    </span>
  );
}

function EmptyState({ localize }: { localize: ReturnType<typeof useLocalize> }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Server size={36} className="mb-3 text-text-tertiary" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-text-primary">
        {localize('com_atk_mcp_empty_title')}
      </h2>
      <p className="mt-1 max-w-md text-xs text-text-tertiary">
        {localize('com_atk_mcp_empty_body')}
      </p>
    </div>
  );
}
