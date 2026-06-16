import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { ChevronDown, Highlighter } from 'lucide-react';
import { useAuthContext, useLocalize } from '~/hooks';
import store from '~/store';
import { cn } from '~/utils';
import { listAnnotationConversations, type AnnotationConversation } from './api';

/** Read a conversation's current title from the React Query cache (filled by
 *  the sidebar's existing ConversationsSection / Convo components). Returns
 *  the id as a fallback while the cache loads. */
function useConversationTitle(conversationId: string): string {
  const qc = useQueryClient();
  const [title, setTitle] = useState<string>(conversationId);

  useEffect(() => {
    function read() {
      const cached = qc.getQueryData<TConversation>([QueryKeys.conversation, conversationId]);
      if (cached?.title) {
        setTitle(cached.title);
        return;
      }
      // Fall back to scanning the infinite conversations list cache.
      const lists = qc.getQueriesData<{ pages: { conversations: TConversation[] }[] }>({
        queryKey: [QueryKeys.allConversations],
      });
      for (const [, data] of lists) {
        if (!data?.pages) {
          continue;
        }
        for (const page of data.pages) {
          const match = page?.conversations?.find((c) => c.conversationId === conversationId);
          if (match?.title) {
            setTitle(match.title);
            return;
          }
        }
      }
    }
    read();
    // Subscribe to cache events.
    const unsub = qc.getQueryCache().subscribe(read);
    return () => unsub();
  }, [conversationId, qc]);

  return title;
}

function AnnotationConversationRow({
  conv,
  onOpen,
}: {
  conv: AnnotationConversation;
  onOpen: (id: string) => void;
}) {
  const title = useConversationTitle(conv.conversationId);
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between space-x-3 rounded-2xl px-2.5 py-1.5 text-sm text-text-secondary transition hover:bg-surface-hover"
      onClick={() => onOpen(conv.conversationId)}
    >
      <span className="flex min-w-0 items-center space-x-3">
        <Highlighter size={14} strokeWidth={2} aria-hidden="true" />
        <span className="truncate">{title}</span>
      </span>
      <span className="shrink-0 text-xs text-text-tertiary">{conv.count}</span>
    </button>
  );
}

/** Collapsible "Annotations" tree node for the AnalytikulSidebar. Starts
 *  collapsed. Children = conversations that have at least one annotation.
 *  Clicking a child opens the sliding second column (`store.annotationsPanel`). */
export default function AnnotationsTree() {
  const localize = useLocalize();
  const { token, isAuthenticated } = useAuthContext();
  const changedAt = useRecoilValue(store.annotationsChangedAt);
  const setPanel = useSetRecoilState(store.annotationsPanel);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AnnotationConversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated || !token) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const conversations = await listAnnotationConversations(token);
        if (!cancelled) {
          setItems(conversations);
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated, changedAt]);

  const onOpen = useCallback(
    (id: string) => {
      setPanel({ open: true, conversationId: id });
      navigate(`/c/${id}`);
    },
    [navigate, setPanel],
  );

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-2xl px-2.5 py-2 text-sm transition hover:bg-surface-hover"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="flex items-center space-x-3">
          <Highlighter size={16} strokeWidth={2} aria-hidden="true" />
          <span className="translate-y-[0.5px]">{localize('com_atk_sb_annotations')}</span>
        </span>
        <ChevronDown
          size={14}
          className={cn('transition-transform', open ? 'rotate-180' : '')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="ml-3 mt-[1px] flex flex-col border-s border-border-light pl-1">
          {!loaded ? null : items.length === 0 ? (
            <div className="px-2.5 py-1.5 text-xs text-text-tertiary">
              {localize('com_atk_sb_annotations_empty')}
            </div>
          ) : (
            items.map((c) => <AnnotationConversationRow key={c.conversationId} conv={c} onOpen={onOpen} />)
          )}
        </div>
      )}
    </>
  );
}
