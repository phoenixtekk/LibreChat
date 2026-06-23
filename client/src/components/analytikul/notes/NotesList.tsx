import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import { useLocalize, useAuthContext } from '~/hooks';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import store from '~/store';
import { dayjs, groupByTimeRange } from './time';

export interface NoteSummary {
  _id: string;
  title: string;
  user: string;
  userName?: string;
  sharedWithOrg: boolean;
  pinnedBy: string[];
  updatedAt: string;
  createdAt: string;
}

type ViewOption = 'all' | 'created' | 'shared';
type Permission = 'write' | 'readonly';
type DropdownKey = 'view' | 'permission' | 'display';

interface DropdownChoice<T extends string> {
  value: T;
  label: string;
}

/**
 * Open WebUI-style notes list: "Notes <count>" header, pill search bar,
 * + New Note button, a controls row (scope / permission / List·Grid dropdowns),
 * and time-grouped rows (Today / Yesterday / Previous 7 days / …) with relative
 * time, "By <user>", and a ⋯ menu (pin, download .md, delete).
 */
export default function NotesList() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { token, user } = useAuthContext();
  const userId = user?.id ?? '';
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [viewOption, setViewOption] = useState<ViewOption>('all');
  const [permission, setPermission] = useState<Permission>('write');
  const [grid, setGrid] = useState(() => localStorage.getItem('atk-notes-view') === 'grid');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);
  // Reopen affordance when the sidebar is collapsed on desktop (no chat header
  // here to host the usual toggle). Mobile has the sidebar's own drawer toggle.
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const showReopen = !sidebarExpanded && !isSmallScreen;

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/analytikul/notes${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      { headers },
    );
    if (res.ok) {
      setNotes(((await res.json()) as { notes: NoteSummary[] }).notes);
    }
  }, [headers, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const createNote = useCallback(async () => {
    const res = await fetch('/api/analytikul/notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: dayjs().format('YYYY-MM-DD') }),
    });
    if (res.ok) {
      const { note } = (await res.json()) as { note: { _id: string } };
      navigate(`/notes/${note._id}`);
    }
  }, [headers, navigate]);

  const togglePin = useCallback(
    async (id: string) => {
      await fetch(`/api/analytikul/notes/${id}/pin`, { method: 'POST', headers });
      setMenuFor(null);
      void load();
    },
    [headers, load],
  );

  const removeNote = useCallback(
    async (id: string) => {
      await fetch(`/api/analytikul/notes/${id}`, { method: 'DELETE', headers });
      setMenuFor(null);
      void load();
    },
    [headers, load],
  );

  const downloadNote = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/analytikul/notes/${id}`, { headers });
      if (!res.ok) {
        return;
      }
      const { note } = (await res.json()) as { note: { title: string; content: string } };
      const blob = new Blob([`# ${note.title}\n\n${note.content}`], { type: 'text/markdown' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${note.title.replace(/[^\w\- ]+/g, '').trim() || 'note'}.md`;
      link.click();
      URL.revokeObjectURL(link.href);
      setMenuFor(null);
    },
    [headers],
  );

  const showPermission = viewOption === 'all' || viewOption === 'shared';

  const filtered = useMemo(() => {
    return (notes ?? []).filter((note) => {
      if (viewOption === 'created' && note.user !== userId) {
        return false;
      }
      if (viewOption === 'shared' && !note.sharedWithOrg) {
        return false;
      }
      if (showPermission && permission === 'readonly' && note.user === userId) {
        return false;
      }
      return true;
    });
  }, [notes, viewOption, permission, showPermission, userId]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const pinDiff = Number(b.pinnedBy.includes(userId)) - Number(a.pinnedBy.includes(userId));
      return pinDiff !== 0 ? pinDiff : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [filtered, userId]);

  const groups = useMemo(() => groupByTimeRange(sorted, (note) => note.updatedAt), [sorted]);

  const setView = (value: boolean) => {
    setGrid(value);
    localStorage.setItem('atk-notes-view', value ? 'grid' : 'list');
  };

  const closeOverlays = () => {
    setMenuFor(null);
    setOpenDropdown(null);
  };

  const viewChoices: DropdownChoice<ViewOption>[] = [
    { value: 'all', label: localize('com_atk_notes_filter_all') },
    { value: 'created', label: localize('com_atk_notes_filter_created') },
    { value: 'shared', label: localize('com_atk_notes_filter_shared') },
  ];
  const permissionChoices: DropdownChoice<Permission>[] = [
    { value: 'write', label: localize('com_atk_notes_perm_write') },
    { value: 'readonly', label: localize('com_atk_notes_perm_readonly') },
  ];
  const displayChoices: DropdownChoice<'list' | 'grid'>[] = [
    { value: 'list', label: localize('com_atk_notes_view_list') },
    { value: 'grid', label: localize('com_atk_notes_view_grid') },
  ];

  return (
    <div
      className="h-full w-full overflow-y-auto bg-surface-primary px-3 text-text-primary md:px-[18px]"
      onClick={closeOverlays}
    >
      <div className="mx-auto flex max-w-5xl flex-col pt-6">
        <div className="flex items-center justify-between px-0.5">
          <div className="flex shrink-0 items-center gap-2 text-xl font-medium">
            {showReopen && <OpenSidebar className="shrink-0" />}
            {localize('com_atk_notes_title')}
            <span className="text-lg font-medium text-text-tertiary">{sorted.length}</span>
          </div>
          <button
            type="button"
            className="flex items-center rounded-xl bg-text-primary px-2 py-1.5 text-sm font-medium text-surface-primary transition hover:opacity-90"
            onClick={() => void createNote()}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="ml-1 text-xs">{localize('com_atk_notes_new')}</span>
          </button>
        </div>

        <div className="mt-3 flex w-full items-center rounded-3xl border border-border-light bg-surface-primary py-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className="ml-3 mr-2 shrink-0 text-text-tertiary"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            placeholder={localize('com_atk_notes_search')}
            className="w-full rounded-r-xl bg-transparent py-1 pr-3 text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between px-0.5">
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <PillDropdown
              open={openDropdown === 'view'}
              label={viewChoices.find((choice) => choice.value === viewOption)?.label ?? ''}
              choices={viewChoices}
              selected={viewOption}
              onToggle={() => setOpenDropdown((prev) => (prev === 'view' ? null : 'view'))}
              onSelect={(value) => {
                setViewOption(value);
                setOpenDropdown(null);
              }}
            />
            {showPermission && (
              <PillDropdown
                open={openDropdown === 'permission'}
                label={permissionChoices.find((choice) => choice.value === permission)?.label ?? ''}
                choices={permissionChoices}
                selected={permission}
                onToggle={() =>
                  setOpenDropdown((prev) => (prev === 'permission' ? null : 'permission'))
                }
                onSelect={(value) => {
                  setPermission(value);
                  setOpenDropdown(null);
                }}
              />
            )}
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <PillDropdown
              open={openDropdown === 'display'}
              align="right"
              label={
                grid ? localize('com_atk_notes_view_grid') : localize('com_atk_notes_view_list')
              }
              choices={displayChoices}
              selected={grid ? 'grid' : 'list'}
              onToggle={() => setOpenDropdown((prev) => (prev === 'display' ? null : 'display'))}
              onSelect={(value) => {
                setView(value === 'grid');
                setOpenDropdown(null);
              }}
            />
          </div>
        </div>

        <div className="mt-4 pb-16">
          {notes != null && sorted.length === 0 && (
            <div className="flex w-full flex-col items-center justify-center py-20 text-center">
              <div className="text-sm text-text-tertiary">{localize('com_atk_notes_none')}</div>
              <div className="mt-1 text-xs text-text-tertiary opacity-70">
                {localize('com_atk_notes_none_hint')}
              </div>
            </div>
          )}
          {groups.map(([range, rangeNotes]) => (
            <div key={range} className="mb-3">
              <div className="w-full px-2.5 pb-2.5 text-xs font-medium text-text-tertiary">
                {range}
              </div>
              <div
                className={
                  grid
                    ? 'grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                    : 'flex flex-col gap-1.5'
                }
              >
                {rangeNotes.map((note) => (
                  <NoteRow
                    key={note._id}
                    note={note}
                    grid={grid}
                    isPinned={note.pinnedBy.includes(userId)}
                    menuOpen={menuFor === note._id}
                    onOpen={() => navigate(`/notes/${note._id}`)}
                    onMenu={(event) => {
                      event.stopPropagation();
                      setOpenDropdown(null);
                      setMenuFor((prev) => (prev === note._id ? null : note._id));
                    }}
                    onPin={() => void togglePin(note._id)}
                    onDownload={() => void downloadNote(note._id)}
                    onDelete={() => void removeNote(note._id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PillDropdown<T extends string>({
  open,
  label,
  choices,
  selected,
  align = 'left',
  onToggle,
  onSelect,
}: {
  open: boolean;
  label: string;
  choices: DropdownChoice<T>[];
  selected: T;
  align?: 'left' | 'right';
  onToggle: () => void;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-tertiary px-3 py-1.5 text-sm text-text-primary transition hover:bg-surface-hover"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          className="text-text-tertiary"
          aria-hidden="true"
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-9 z-20 w-44 rounded-xl border border-border-light bg-surface-dialog py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitem"
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-surface-hover ${
                choice.value === selected ? 'text-text-primary' : 'text-text-secondary'
              }`}
              onClick={() => onSelect(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRow({
  note,
  grid,
  isPinned,
  menuOpen,
  onOpen,
  onMenu,
  onPin,
  onDownload,
  onDelete,
}: {
  note: NoteSummary;
  grid: boolean;
  isPinned: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: (event: React.MouseEvent) => void;
  onPin: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const byName =
    note.user === user?.id ? (user?.name ?? user?.username ?? '') : (note.userName ?? '');

  return (
    <div
      role="button"
      tabIndex={0}
      className={`relative w-full cursor-pointer rounded-2xl border border-border-light bg-transparent transition hover:bg-surface-primary-alt ${
        grid ? 'px-4 py-4' : 'px-3.5 py-1.5'
      }`}
      onClick={onOpen}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
    >
      <div className="flex items-center justify-between gap-2 self-center">
        <div
          className={`line-clamp-1 w-full flex-1 text-sm font-medium capitalize ${grid ? 'font-semibold' : ''}`}
        >
          {isPinned && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              className="mr-1 inline-block shrink-0 align-[-1px] text-text-tertiary"
              aria-hidden="true"
            >
              <path
                d="M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {note.title}
          {note.sharedWithOrg && (
            <span className="ml-1 text-xs font-normal text-text-tertiary">
              {localize('com_atk_notes_shared_badge')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5 text-xs text-text-tertiary">
          <span title={dayjs(note.updatedAt).format('LLLL')}>
            {dayjs(note.updatedAt).fromNow()}
          </span>
          {byName !== '' && (
            <span className="shrink-0">{`${localize('com_atk_notes_by')} ${byName}`}</span>
          )}
          <button
            type="button"
            className="w-fit self-center rounded-xl p-1 text-sm hover:bg-surface-hover"
            aria-label={localize('com_atk_notes_menu')}
            aria-expanded={menuOpen}
            onClick={onMenu}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        </div>
      </div>
      {menuOpen && (
        <div
          className="absolute right-2 top-9 z-20 w-44 rounded-xl border border-border-light bg-surface-dialog py-1 shadow-lg"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <MenuItem
            label={isPinned ? localize('com_atk_notes_unpin') : localize('com_atk_notes_pin')}
            onClick={onPin}
          />
          <MenuItem label={localize('com_atk_notes_download_md')} onClick={onDownload} />
          <MenuItem label={localize('com_atk_notes_delete')} destructive onClick={onDelete} />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  destructive = false,
  onClick,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-surface-hover ${
        destructive ? 'text-text-destructive' : 'text-text-primary'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
