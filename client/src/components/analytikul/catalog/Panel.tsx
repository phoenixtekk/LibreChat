import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { X, Search as SearchIcon, Sparkles } from 'lucide-react';
import { useLocalize } from '~/hooks';
import store from '~/store';
import { cn } from '~/utils';
import { CATALOG, WHATS_NEW, type WhatsNewItem } from './entries';
import { CATEGORIES } from './categories';
import type { CatalogEntry, CatalogAction, CatalogState } from './types';

type WhatsNewResolved = WhatsNewItem & { entry: CatalogEntry };

const SEEN_KEY = 'atk:catalog:seen';
const SHOW_SOON_KEY = 'atk:catalog:showSoon';
const WHATS_NEW_DISMISSED_KEY = 'atk:catalog:whatsNewDismissed';

function readSeenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistSeen(set: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore — best-effort */
  }
}

function readShowSoon(): boolean {
  try {
    return localStorage.getItem(SHOW_SOON_KEY) === 'true';
  } catch {
    return false;
  }
}

function readWhatsNewDismissed(): boolean {
  try {
    return localStorage.getItem(WHATS_NEW_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function matchesQuery(entry: CatalogEntry, q: string): boolean {
  if (!q) {
    return true;
  }
  const needle = q.toLowerCase();
  if (entry.title.toLowerCase().includes(needle)) {
    return true;
  }
  if (entry.summary.toLowerCase().includes(needle)) {
    return true;
  }
  for (const tag of entry.tags) {
    if (tag.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function statePillClass(state: CatalogState): string {
  switch (state) {
    case 'live':
      return 'atk-catalog-pill atk-catalog-pill-live';
    case 'beta':
      return 'atk-catalog-pill atk-catalog-pill-beta';
    case 'gated':
      return 'atk-catalog-pill atk-catalog-pill-gated';
    case 'soon':
      return 'atk-catalog-pill atk-catalog-pill-soon';
  }
}

function stateLabel(state: CatalogState, localize: ReturnType<typeof useLocalize>): string {
  switch (state) {
    case 'live':
      return localize('com_atk_discover_state_live');
    case 'beta':
      return localize('com_atk_discover_state_beta');
    case 'gated':
      return localize('com_atk_discover_state_gated');
    case 'soon':
      return localize('com_atk_discover_state_soon');
  }
}

export default function CatalogPanel() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [panel, setPanel] = useRecoilState(store.catalogPanel);
  const setRail = useSetRecoilState(store.previewRail);
  const [query, setQuery] = useState('');
  const [showSoon, setShowSoon] = useState<boolean>(() => readShowSoon());
  const [seen, setSeen] = useState<Set<string>>(() => readSeenSet());
  const [whatsNewDismissed, setWhatsNewDismissed] = useState<boolean>(() => readWhatsNewDismissed());
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setPanel({ open: false }), [setPanel]);

  useEffect(() => {
    if (!panel.open) {
      setQuery('');
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [panel.open, close]);

  const markSeen = useCallback(
    (id: string) => {
      setSeen((prev) => {
        if (prev.has(id)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(id);
        persistSeen(next);
        return next;
      });
    },
    [],
  );

  const toggleShowSoon = useCallback(() => {
    setShowSoon((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_SOON_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const dismissWhatsNew = useCallback(() => {
    setWhatsNewDismissed(true);
    try {
      localStorage.setItem(WHATS_NEW_DISMISSED_KEY, 'true');
    } catch {
      /* ignore */
    }
  }, []);

  const runAction = useCallback(
    (entry: CatalogEntry) => {
      markSeen(entry.id);
      const a = entry.action;
      if (a.kind === 'navigate') {
        navigate(a.path);
        close();
        return;
      }
      if (a.kind === 'panel') {
        setRail({ open: true, tab: a.tab });
        close();
        return;
      }
      if (a.kind === 'external') {
        window.open(a.href, '_blank', 'noopener,noreferrer');
        return;
      }
      // 'slash' / 'composer' / 'none' — no-op for v1; surface via slash later.
      close();
    },
    [navigate, setRail, close, markSeen],
  );

  const filtered = useMemo(() => {
    return CATALOG.filter((entry) => {
      if (!showSoon && entry.state === 'soon') {
        return false;
      }
      return matchesQuery(entry, query);
    });
  }, [query, showSoon]);

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const entry of filtered) {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return groups;
  }, [filtered]);

  const whatsNewItems = useMemo(() => {
    if (whatsNewDismissed || query) {
      return [];
    }
    const out: WhatsNewResolved[] = [];
    for (const item of WHATS_NEW) {
      const entry = CATALOG.find((e) => e.id === item.id);
      if (entry) {
        out.push({ ...item, entry });
      }
    }
    return out;
  }, [whatsNewDismissed, query]);

  return (
    <>
      {panel.open && (
        <div
          className="atk-catalog-backdrop"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <aside
        className="atk-catalog-panel"
        data-open={panel.open ? 'true' : 'false'}
        aria-hidden={!panel.open}
        aria-label={localize('com_atk_discover')}
        role="dialog"
      >
        <div className="atk-catalog-inner">
          <header className="atk-catalog-header">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-text-secondary" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {localize('com_atk_discover')}
                </div>
                <div className="text-xs text-text-tertiary">
                  {localize('com_atk_discover_subtitle')}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
              onClick={close}
              aria-label={localize('com_atk_discover_close')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="atk-catalog-search">
            <SearchIcon size={14} className="text-text-tertiary" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={localize('com_atk_discover_search_placeholder')}
              className="atk-catalog-search-input"
              aria-label={localize('com_atk_discover_search_placeholder')}
            />
          </div>

          <div className="atk-catalog-toolbar">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={showSoon}
                onChange={toggleShowSoon}
                className="atk-catalog-checkbox"
              />
              {localize('com_atk_discover_show_soon')}
            </label>
          </div>

          <div className="atk-catalog-body">
            {whatsNewItems.length > 0 && (
              <section className="atk-catalog-whatsnew">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {localize('com_atk_discover_whats_new')}
                  </div>
                  <button
                    type="button"
                    onClick={dismissWhatsNew}
                    className="text-xs text-text-tertiary hover:text-text-primary"
                  >
                    {localize('com_atk_discover_dismiss_new')}
                  </button>
                </div>
                <ul className="mt-1 flex flex-col gap-1">
                  {whatsNewItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover"
                        onClick={() => runAction(item.entry)}
                      >
                        <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue" aria-hidden="true" />
                        <span className="flex-1">
                          <span className="block text-sm text-text-primary">{item.headline}</span>
                          <span className="block text-xs text-text-tertiary">{item.date}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-sm text-text-tertiary">
                {localize('com_atk_discover_no_results')}
              </div>
            ) : (
              CATEGORIES.map((cat) => {
                const items = groupedByCategory.get(cat.id);
                if (!items || items.length === 0) {
                  return null;
                }
                return (
                  <section key={cat.id} className="atk-catalog-section">
                    <div className="atk-catalog-section-header">
                      <div className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                        {cat.label}
                      </div>
                      <div className="text-xs text-text-tertiary">{cat.blurb}</div>
                    </div>
                    <ul className="flex flex-col">
                      {items.map((entry) => (
                        <li key={entry.id}>
                          <CatalogEntryCard
                            entry={entry}
                            isNewToUser={!seen.has(entry.id)}
                            onAction={() => runAction(entry)}
                            actionLabel={actionButtonLabel(entry.action, localize)}
                            statePillLabel={stateLabel(entry.state, localize)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function actionButtonLabel(action: CatalogAction, localize: ReturnType<typeof useLocalize>): string | null {
  if (action.kind === 'navigate' || action.kind === 'panel' || action.kind === 'external') {
    return action.label;
  }
  return null;
}

function CatalogEntryCard({
  entry,
  isNewToUser,
  onAction,
  actionLabel,
  statePillLabel,
}: {
  entry: CatalogEntry;
  isNewToUser: boolean;
  onAction: () => void;
  actionLabel: string | null;
  statePillLabel: string;
}) {
  const localize = useLocalize();
  const clickable = actionLabel !== null;
  return (
    <div
      className={cn(
        'atk-catalog-entry',
        clickable ? 'atk-catalog-entry-clickable' : '',
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onAction : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAction();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{entry.title}</span>
            {isNewToUser && clickable && (
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue"
                aria-label={localize('com_atk_discover_new_dot')}
              />
            )}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-text-secondary">{entry.summary}</p>
          {entry.body && (
            <p className="mt-1 text-xs leading-snug text-text-tertiary">{entry.body}</p>
          )}
        </div>
        <span className={statePillClass(entry.state)}>{statePillLabel}</span>
      </div>
      {clickable && (
        <div className="mt-2 text-xs font-medium text-brand-blue">
          {actionLabel} →
        </div>
      )}
    </div>
  );
}
