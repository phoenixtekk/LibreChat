import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { Spinner } from '@librechat/client';
import {
  useGetConversationTags,
  useConversationsInfiniteQuery,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Bookmarks page — lists every conversation that has at least one tag,
 *  groupable by tag via filter chips at top. Click a row to jump to the
 *  conversation. Empty state if no tags exist yet. */
export default function Bookmarks() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { data: allTags = [] } = useGetConversationTags();

  const tagList = useMemo(
    () => allTags.filter((t) => (t.count ?? 0) > 0),
    [allTags],
  );

  const queryTags = selectedTags.length > 0
    ? selectedTags
    : tagList.map((t) => t.tag);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useConversationsInfiniteQuery(
      { tags: queryTags, isArchived: false },
      { enabled: queryTags.length > 0 },
    );

  const conversations = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.pages.flatMap((page) => page.conversations ?? []);
  }, [data]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const clearTags = () => setSelectedTags([]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="border-b border-border-light px-6 py-4">
        <div className="flex items-center gap-2">
          <Bookmark size={18} className="text-text-secondary" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-text-primary">
            {localize('com_ui_bookmarks')}
          </h1>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          {localize('com_atk_bookmarks_subtitle')}
        </p>
      </header>

      {tagList.length === 0 ? (
        <EmptyState localize={localize} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border-light px-6 py-3">
            <button
              type="button"
              onClick={clearTags}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                selectedTags.length === 0
                  ? 'border-brand-blue bg-brand-blue/10 text-brand-blue'
                  : 'border-border-medium text-text-secondary hover:bg-surface-hover',
              )}
            >
              {localize('com_atk_bookmarks_all', { 0: tagList.length })}
            </button>
            {tagList.map((t) => {
              const active = selectedTags.includes(t.tag);
              return (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => toggleTag(t.tag)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                    active
                      ? 'border-brand-blue bg-brand-blue/10 text-brand-blue'
                      : 'border-border-medium text-text-secondary hover:bg-surface-hover',
                  )}
                >
                  {t.tag}
                  <span className="ml-1 text-text-tertiary">{t.count}</span>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner />
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-6 py-8 text-sm text-text-tertiary">
                {localize('com_atk_bookmarks_empty_for_filter')}
              </div>
            ) : (
              <ul className="flex flex-col">
                {conversations.map((conv) => (
                  <li key={conv.conversationId}>
                    <button
                      type="button"
                      onClick={() => navigate(`/c/${conv.conversationId}`)}
                      className="flex w-full flex-col items-start gap-1 rounded-lg px-4 py-3 text-left transition hover:bg-surface-hover"
                    >
                      <span className="line-clamp-1 text-sm font-medium text-text-primary">
                        {conv.title || localize('com_ui_untitled')}
                      </span>
                      {(conv.tags?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {conv.tags?.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
                {hasNextPage && (
                  <li>
                    <button
                      type="button"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="mx-2 mt-2 w-[calc(100%-1rem)] rounded-lg border border-border-light py-2 text-xs text-text-secondary transition hover:bg-surface-hover disabled:opacity-50"
                    >
                      {isFetchingNextPage
                        ? localize('com_ui_loading')
                        : localize('com_atk_bookmarks_load_more')}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ localize }: { localize: ReturnType<typeof useLocalize> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <Bookmark size={36} className="mb-3 text-text-tertiary" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-text-primary">
        {localize('com_atk_bookmarks_empty_title')}
      </h2>
      <p className="mt-1 max-w-md text-xs text-text-tertiary">
        {localize('com_atk_bookmarks_empty_body')}
      </p>
    </div>
  );
}
