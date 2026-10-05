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
  Compass,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

/** Collapse state for a nav group, persisted per-group in localStorage (defaults open). */
function usePersistedOpen(key: string) {
  const storageKey = `atk_nav_${key}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* private mode / blocked storage — state still toggles for this session */
      }
      return next;
    });
  }, [storageKey]);
  return [open, toggle] as const;
}

interface NavLink {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
}

/** One nav row — identical shape for every item so the rail reads as one system. */
function NavRow({ icon: Icon, label, active, onClick }: Omit<NavLink, 'id'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary',
        active ? 'bg-surface-active text-text-primary' : '',
      )}
    >
      <Icon size={16} strokeWidth={2} aria-hidden={true} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** A collapsible category: one consistent header + its rows. Open state persists. */
function SidebarGroup({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, toggle] = usePersistedOpen(id);
  return (
    <div className="mt-1">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary transition hover:text-text-secondary"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>{label}</span>
        <ChevronDown
          size={13}
          className={cn('transition-transform', open ? '' : '-rotate-90')}
          aria-hidden="true"
        />
      </button>
      {open && <div className="mt-px flex flex-col gap-px">{children}</div>}
    </div>
  );
}

/**
 * Analytikul nav rail: a pinned action row, then unified collapsible categories
 * (Workspace, Knowledge), the conversation history, and the account footer.
 * Every row shares one shape; categories remember their collapsed state; the
 * nav region scrolls so nothing is clipped on a short window.
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

  const pinned: NavLink[] = [
    {
      id: 'new-chat',
      label: localize('com_atk_new_chat'),
      icon: PenSquare,
      onClick: handleNewChat,
    },
    {
      id: 'search',
      label: localize('com_atk_sb_search'),
      icon: Search,
      onClick: () => go('/search'),
      active: location.pathname === '/search',
    },
  ];

  const workspace: NavLink[] = [
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
      active: location.pathname.startsWith('/agents'),
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

  const knowledge: NavLink[] = [
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

      <div className="shrink-0 px-2 pt-1">
        {pinned.map((item) => (
          <NavRow key={item.id} {...item} />
        ))}
      </div>

      {/* Collapsible categories — capped height so they always scroll instead of
          clipping on a short window, leaving the conversation list its own space. */}
      <div className="max-h-[52%] min-h-0 shrink overflow-y-auto px-2">
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

      <div className="mt-1 min-h-0 flex-1 overflow-hidden">
        <SidebarChatProvider>
          <ActivePanelProvider>
            <ConversationsSection hideSearch />
          </ActivePanelProvider>
        </SidebarChatProvider>
      </div>

      <div className="shrink-0 px-1.5 pb-2 pt-1.5">
        <div className="px-0.5">
          <NavRow
            icon={KeyRound}
            label={localize('com_atk_sb_keys')}
            onClick={() => openRail('keys')}
          />
        </div>
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
