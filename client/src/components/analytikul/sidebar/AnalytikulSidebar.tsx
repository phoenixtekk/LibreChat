import { memo, useCallback, useState, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, PermissionTypes, Permissions } from 'librechat-data-provider';
import { useMediaQuery } from '@librechat/client';
import {
  PenSquare,
  Search,
  NotebookPen,
  CalendarDays,
  LayoutGrid,
  ScrollText,
  MessageSquareText,
  Brain,
  KeyRound,
  Boxes,
  Compass,
  Store,
} from 'lucide-react';
import type { PreviewRailTab } from '~/store/misc';
import type { ChatFormValues } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { ChatContext, ChatFormProvider, ActivePanelProvider } from '~/Providers';
import AccountSettings from '~/components/Nav/AccountSettings';
import AnnotationsTree from '~/components/analytikul/annotations/AnnotationsTree';
import { useLocalize, useNewConvo, useChatHelpers, useHasAccess } from '~/hooks';
import { SidebarGroup, NavRow } from './SidebarGroup';
import store from '~/store';
import { cn } from '~/utils';

const BookmarkNav = lazy(() => import('~/components/Nav/Bookmarks/BookmarkNav'));

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
 * Analytikul nav rail: four pinned actions (New chat, Search, Bookmarks, Agent
 * Marketplace), then unified collapsible categories (Workspace, Knowledge, and
 * Favorites/Projects/Chats from the conversation section), with API Keys + the
 * account menu pinned to the footer. Every row and header shares one look;
 * categories remember their collapsed state; the nav scrolls so nothing clips.
 */
function AnalytikulSidebar() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const [expanded, setExpanded] = useRecoilState(store.sidebarExpanded);
  const setPreviewRail = useSetRecoilState(store.previewRail);
  const setCatalog = useSetRecoilState(store.catalogPanel);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [tags, setTags] = useState<string[]>([]);

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });

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

  const workspace = [
    {
      id: 'models',
      label: localize('com_atk_tab_models'),
      icon: Boxes,
      onClick: () => go('/workspace/models'),
      active: location.pathname.startsWith('/workspace/models'),
    },
    {
      id: 'agents',
      label: localize('com_atk_sb_agents'),
      icon: LayoutGrid,
      onClick: () => go('/agents'),
      active: location.pathname === '/agents',
    },
    {
      id: 'prompts',
      label: localize('com_atk_sb_prompts'),
      icon: MessageSquareText,
      onClick: () => go('/prompts/new'),
      active: location.pathname.startsWith('/prompts'),
    },
    {
      id: 'skills',
      label: localize('com_atk_sb_skills'),
      icon: ScrollText,
      onClick: () => go('/skills'),
      active: location.pathname.startsWith('/skills'),
    },
    {
      id: 'discover',
      label: localize('com_atk_discover'),
      icon: Compass,
      onClick: () => {
        setCatalog({ open: true });
        closeOnMobile();
      },
    },
  ];

  const knowledge = [
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
    {
      id: 'memory',
      label: localize('com_atk_sb_memory'),
      icon: Brain,
      onClick: () => openRail('memory'),
    },
  ];

  const body = (
    <div className="flex h-full w-full flex-col bg-surface-primary-alt">
      <div className="flex shrink-0 items-center justify-between px-2.5 pb-1.5 pt-2">
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

      {/* Pinned actions — the only rows without a category. */}
      <div className="shrink-0 px-2 pt-1">
        <NavRow icon={PenSquare} label={localize('com_atk_new_chat')} onClick={handleNewChat} />
        <NavRow
          icon={Search}
          label={localize('com_atk_sb_search')}
          active={location.pathname === '/search'}
          onClick={() => go('/search')}
        />
        {hasAccessToBookmarks && (
          <Suspense fallback={null}>
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary">
              <BookmarkNav tags={tags} setTags={setTags} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => document.getElementById('bookmark-nav-menu-button')?.click()}
              >
                {localize('com_ui_bookmarks')}
              </button>
            </div>
          </Suspense>
        )}
        <NavRow
          icon={Store}
          label={localize('com_agents_marketplace')}
          active={location.pathname === '/agents'}
          onClick={() => go('/agents')}
        />
      </div>

      {/* Collapsible categories — capped height so they always scroll instead of
          clipping on a short window, leaving the conversation list its own space. */}
      <div className="max-h-[46%] min-h-0 shrink overflow-y-auto px-2">
        <SidebarGroup id="workspace" label={localize('com_atk_sb_workspace')}>
          {workspace.map((item) => (
            <NavRow key={item.id} {...item} />
          ))}
        </SidebarGroup>
        <SidebarGroup id="knowledge" label={localize('com_atk_sb_knowledge')}>
          {knowledge.map((item) => (
            <NavRow key={item.id} {...item} />
          ))}
          <AnnotationsTree />
        </SidebarGroup>
      </div>

      {/* Favorites / Projects / Chats — unified category headers rendered inside. */}
      <div className="mt-1 min-h-0 flex-1 overflow-hidden px-2">
        <SidebarChatProvider>
          <ActivePanelProvider>
            <ConversationsSection hideSearch hideMarketplace tags={tags} />
          </ActivePanelProvider>
        </SidebarChatProvider>
      </div>

      <div className="shrink-0 px-2 pb-2 pt-1.5">
        <NavRow
          icon={KeyRound}
          label={localize('com_atk_sb_keys')}
          onClick={() => openRail('keys')}
        />
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
    </div>
  );
}

export default memo(AnalytikulSidebar);
