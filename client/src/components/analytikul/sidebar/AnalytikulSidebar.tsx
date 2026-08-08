import { memo, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useMediaQuery } from '@librechat/client';
import {
  PenSquare,
  Search,
  NotebookPen,
  CalendarDays,
  LayoutGrid,
  ScrollText,
  MessageSquareText,
  ChevronDown,
  Brain,
  KeyRound,
  Boxes,
  Highlighter,
  Compass,
} from 'lucide-react';
import type { PreviewRailTab } from '~/store/misc';
import type { ChatFormValues } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { ChatContext, ChatFormProvider, ActivePanelProvider } from '~/Providers';
import AccountSettings from '~/components/Nav/AccountSettings';
import AnnotationsTree from '~/components/analytikul/annotations/AnnotationsTree';
import { useLocalize, useNewConvo, useChatHelpers } from '~/hooks';
import store from '~/store';
import { cn } from '~/utils';

/** Isolates chat Recoil subscriptions from the sidebar shell (same pattern as UnifiedSidebar). */
function SidebarChatProvider({ children }: { children: ReactNode }) {
  const chatHelpers = useChatHelpers(0);
  const sidebarFormMethods = useForm<ChatFormValues>({ defaultValues: { text: '' } });
  return (
    <ChatFormProvider {...sidebarFormMethods}>
      <ChatContext.Provider value={chatHelpers}>{children}</ChatContext.Provider>
    </ChatFormProvider>
  );
}

const SIDEBAR_WIDTH = 264;
const TRANSITION = 'transform 280ms cubic-bezier(0.2, 0, 0, 1)';

/**
 * Open WebUI-style single sidebar: logo row, New Chat / Search / Notes /
 * Workspace items, the chats section (time-grouped, with its own search),
 * and the account menu pinned to the footer. One panel, collapsible —
 * replaces LibreChat's icon-strip + tree two-part sidebar.
 */
function AnalytikulSidebar() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const [expanded, setExpanded] = useRecoilState(store.sidebarExpanded);
  const setPreviewRail = useSetRecoilState(store.previewRail);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [workspaceOpen, setWorkspaceOpen] = useState(true);

  const closeOnMobile = useCallback(() => {
    if (isSmallScreen) {
      setExpanded(false);
    }
  }, [isSmallScreen, setExpanded]);

  const handleNewChat = useCallback(() => {
    queryClient.setQueryData([QueryKeys.messages], []);
    newConversation();
    closeOnMobile();
  }, [queryClient, newConversation, closeOnMobile]);

  const go = useCallback(
    (path: string) => {
      navigate(path);
      closeOnMobile();
    },
    [navigate, closeOnMobile],
  );

  const openRail = useCallback(
    (tab: PreviewRailTab) => {
      setPreviewRail({ open: true, tab });
      closeOnMobile();
    },
    [setPreviewRail, closeOnMobile],
  );

  const setCatalog = useSetRecoilState(store.catalogPanel);

  const items = [
    {
      id: 'discover',
      label: localize('com_atk_discover'),
      icon: Compass,
      onClick: () => {
        setCatalog({ open: true });
        closeOnMobile();
      },
      active: false,
    },
    {
      id: 'new-chat',
      label: localize('com_atk_new_chat'),
      icon: PenSquare,
      onClick: handleNewChat,
      active: false,
    },
    {
      id: 'search',
      label: localize('com_atk_sb_search'),
      icon: Search,
      onClick: () => go('/search'),
      active: location.pathname === '/search',
    },
    {
      id: 'notes',
      label: localize('com_atk_notes_title'),
      icon: NotebookPen,
      onClick: () => go('/notes'),
      active: location.pathname.startsWith('/notes'),
    },
    {
      id: 'daily-logs',
      label: localize('com_atk_daily_logs_title'),
      icon: CalendarDays,
      onClick: () => go('/daily-logs'),
      active: location.pathname.startsWith('/daily-logs'),
    },
  ];

  const workspaceItems: {
    id: string;
    label: string;
    icon: typeof LayoutGrid;
    onClick: () => void;
  }[] = [
    {
      id: 'models',
      label: localize('com_atk_tab_models'),
      icon: Boxes,
      onClick: () => go('/workspace/models'),
    },
    {
      id: 'agents',
      label: localize('com_atk_sb_agents'),
      icon: LayoutGrid,
      onClick: () => go('/agents'),
    },
    {
      id: 'prompts',
      label: localize('com_atk_sb_prompts'),
      icon: MessageSquareText,
      onClick: () => go('/prompts/new'),
    },
    {
      id: 'skills',
      label: localize('com_atk_sb_skills'),
      icon: ScrollText,
      onClick: () => go('/skills'),
    },
    {
      id: 'memory',
      label: localize('com_atk_sb_memory'),
      icon: Brain,
      onClick: () => openRail('memory'),
    },
    {
      id: 'keys',
      label: localize('com_atk_sb_keys'),
      icon: KeyRound,
      onClick: () => openRail('keys'),
    },
  ];

  const body = (
    <div className="flex h-full w-full flex-col bg-surface-primary-alt">
      <div className="flex items-center justify-between px-2.5 pb-1.5 pt-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-2xl px-1.5 py-1 transition hover:bg-surface-hover"
          onClick={() => go('/c/new')}
        >
          <img
            src="/assets/favicon-32x32.png"
            alt=""
            className="h-5 w-5 rounded"
            aria-hidden="true"
          />
          {/* eslint-disable-next-line i18next/no-literal-string -- brand name, not translated */}
          <span className="atk-brand-wordmark text-sm font-semibold">Analytikul</span>
        </button>
        <button
          type="button"
          className="rounded-xl p-1.5 transition hover:bg-surface-hover"
          aria-label={localize('com_atk_sb_toggle')}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M9 4v16" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      <div className="px-2 pt-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'flex w-full items-center space-x-3 rounded-2xl px-2.5 py-2 text-sm transition hover:bg-surface-hover',
              item.active ? 'bg-surface-active' : '',
            )}
            onClick={item.onClick}
          >
            <item.icon size={16} strokeWidth={2} aria-hidden="true" />
            <span className="translate-y-[0.5px] self-center">{item.label}</span>
          </button>
        ))}

        <button
          type="button"
          className="flex w-full items-center justify-between rounded-2xl px-2.5 py-2 text-sm transition hover:bg-surface-hover"
          aria-expanded={workspaceOpen}
          onClick={() => setWorkspaceOpen((prev) => !prev)}
        >
          <span className="flex items-center space-x-3">
            <LayoutGrid size={16} strokeWidth={2} aria-hidden="true" />
            <span className="translate-y-[0.5px]">{localize('com_atk_sb_workspace')}</span>
          </span>
          <ChevronDown
            size={14}
            className={cn('transition-transform', workspaceOpen ? 'rotate-180' : '')}
            aria-hidden="true"
          />
        </button>
        {workspaceOpen && (
          <div className="ml-3 mt-[1px] flex flex-col border-s border-border-light pl-1">
            {workspaceItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center space-x-3 rounded-2xl px-2.5 py-1.5 text-sm text-text-secondary transition hover:bg-surface-hover"
                onClick={item.onClick}
              >
                <item.icon size={14} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
        <AnnotationsTree />
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        <SidebarChatProvider>
          <ActivePanelProvider>
            <ConversationsSection hideSearch />
          </ActivePanelProvider>
        </SidebarChatProvider>
      </div>

      <div className="sticky bottom-0 px-1.5 pb-2 pt-1.5">
        <AccountSettings />
      </div>
    </div>
  );

  if (isSmallScreen) {
    return (
      <>
        <div
          className={cn(
            'fixed left-0 top-0 z-[110] flex h-full bg-surface-primary-alt',
            expanded ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{ width: 'min(85vw, 380px)', transition: TRANSITION }}
          inert={!expanded ? '' : undefined}
        >
          {body}
        </div>
        <div
          className={cn(
            'fixed inset-0 z-[109] bg-black/50',
            expanded ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: 'opacity 280ms ease' }}
          role="presentation"
          onClick={() => setExpanded(false)}
        />
        {!expanded && (
          <button
            type="button"
            className="fixed left-2 top-2 z-[105] rounded-xl bg-surface-primary-alt p-2 shadow-md"
            aria-label={localize('com_atk_sb_toggle')}
            onClick={() => setExpanded(true)}
          >
            <PenSquare size={16} aria-hidden="true" />
          </button>
        )}
      </>
    );
  }

  return (
    <div
      className="relative h-full shrink-0 overflow-hidden"
      style={{
        width: expanded ? SIDEBAR_WIDTH : 0,
        transition: 'width 280ms cubic-bezier(0.2, 0, 0, 1)',
      }}
    >
      <div style={{ width: SIDEBAR_WIDTH }} className="h-full">
        {body}
      </div>
      {/* The collapsed-sidebar toggle now lives in the Chat Header
       *  (`<OpenSidebar />` rendered when `!navVisible`), which keeps it from
       *  overlapping the model selector. No floating fallback needed on
       *  desktop. */}
    </div>
  );
}

export default memo(AnalytikulSidebar);
