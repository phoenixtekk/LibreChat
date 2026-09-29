import { useEffect, useMemo, useState, useRef } from 'react';
import debounce from 'lodash/debounce';
import { Search as SearchIcon, X } from 'lucide-react';
import { useRecoilState } from 'recoil';
import { Spinner, useToastContext } from '@librechat/client';
import MinimalMessagesWrapper from '~/components/Chat/Messages/MinimalMessages';
import { useNavScrolling, useLocalize, useAuthContext } from '~/hooks';
import SearchMessage from '~/components/Chat/Messages/SearchMessage';
import { useMessagesInfiniteQuery } from '~/data-provider';
import { useFileMapContext } from '~/Providers';
import store from '~/store';

export default function Search() {
  const localize = useLocalize();
  const fileMap = useFileMapContext();
  const { showToast } = useToastContext();
  const { isAuthenticated } = useAuthContext();
  const [search, setSearchState] = useRecoilState(store.search);
  const searchQuery = search.debouncedQuery;

  const [text, setText] = useState(search.query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const debouncedSetQuery = useMemo(
    () =>
      debounce((value: string) => {
        setSearchState((prev) => ({ ...prev, debouncedQuery: value, isTyping: false }));
      }, 400),
    [setSearchState],
  );

  const onChangeQuery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setText(value);
    setSearchState((prev) => ({ ...prev, query: value, isTyping: true }));
    debouncedSetQuery(value);
  };

  const clearQuery = () => {
    setText('');
    setSearchState((prev) => ({ ...prev, query: '', debouncedQuery: '', isTyping: false }));
    inputRef.current?.focus();
  };

  const {
    data: searchMessages,
    isLoading,
    isError,
    fetchNextPage,
    isFetchingNextPage,
    hasNextPage: _hasNextPage,
  } = useMessagesInfiniteQuery(
    {
      search: searchQuery || undefined,
    },
    {
      enabled: isAuthenticated && !!searchQuery,
      staleTime: 30000,
      cacheTime: 300000,
    },
  );

  const { containerRef } = useNavScrolling({
    nextCursor: searchMessages?.pages[searchMessages.pages.length - 1]?.nextCursor,
    setShowLoading: () => ({}),
    fetchNextPage: fetchNextPage,
    isFetchingNext: isFetchingNextPage,
  });

  const messages = useMemo(() => {
    const msgs =
      searchMessages?.pages.flatMap((page) =>
        page.messages.map((message) => {
          if (!message.files || !fileMap) {
            return message;
          }
          return {
            ...message,
            files: message.files.map((file) => fileMap[file.file_id ?? ''] ?? file),
          };
        }),
      ) || [];

    return msgs.length === 0 ? null : msgs;
  }, [fileMap, searchMessages?.pages]);

  useEffect(() => {
    if (isError && searchQuery) {
      showToast({ message: 'An error occurred during search', status: 'error' });
    }
  }, [isError, searchQuery, showToast]);

  const resultsCount = messages?.length ?? 0;
  const resultsAnnouncement = useMemo(() => {
    if (resultsCount === 0) {
      return localize('com_ui_nothing_found');
    }
    if (resultsCount === 1) {
      return localize('com_ui_result_found', { count: resultsCount });
    }
    return localize('com_ui_results_found', { count: resultsCount });
  }, [resultsCount, localize]);

  const queryEnabled = isAuthenticated && !!searchQuery;
  const isSearchLoading = search.isTyping || (queryEnabled && isLoading) || isFetchingNextPage;

  let body: JSX.Element;
  if (isSearchLoading) {
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    );
  } else if (!searchQuery) {
    body = (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <SearchIcon className="text-text-secondary" size={28} aria-hidden="true" />
          <p className="text-text-secondary">{localize('com_atk_search_prompt')}</p>
        </div>
      </div>
    );
  } else if ((messages && messages.length === 0) || messages == null) {
    body = (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-secondary">{localize('com_ui_nothing_found')}</p>
      </div>
    );
  } else {
    body = (
      <MinimalMessagesWrapper ref={containerRef} className="relative flex h-full pt-4">
        <div className="sr-only" role="alert" aria-atomic="true">
          {resultsAnnouncement}
        </div>
        {messages.map((msg) => (
          <SearchMessage key={msg.messageId} message={msg} />
        ))}
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <Spinner className="text-text-primary" />
          </div>
        )}
      </MinimalMessagesWrapper>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-2xl px-4 pt-6">
        <div className="relative">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={onChangeQuery}
            autoComplete="off"
            dir="auto"
            aria-label={localize('com_nav_search_placeholder')}
            placeholder={localize('com_nav_search_placeholder')}
            className="w-full rounded-xl border border-border-light bg-surface-secondary py-2.5 pl-9 pr-9 text-sm text-text-primary placeholder-text-secondary focus:border-border-heavy focus:outline-none"
          />
          {text && (
            <button
              type="button"
              aria-label={localize('com_ui_clear_search')}
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
              onClick={clearQuery}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
