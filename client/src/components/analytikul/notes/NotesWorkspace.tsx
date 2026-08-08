import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import { Plus, FileUp, Trash2, Loader2, StickyNote } from 'lucide-react';
import { useLocalize, useAuthContext } from '~/hooks';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { cn } from '~/utils';
import store from '~/store';
import NoteEditor from './NoteEditor';
import { dayjs } from './time';

interface NoteSummary {
  _id: string;
  title: string;
  updatedAt: string;
}

/**
 * Two-pane Notes workspace (ported from the notes-feature template): a note list on
 * the left and the full-width editor on the right — create / select / delete / import
 * inline, no page navigation. Wired to Analytikul's Mongo/Express notes API.
 */
export default function NotesWorkspace() {
  const localize = useLocalize();
  const { noteId: routeNoteId } = useParams();
  const { token } = useAuthContext();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(routeNoteId ?? null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const showReopen = !sidebarExpanded && !isSmallScreen;

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    const res = await fetch('/api/analytikul/notes', { headers });
    if (res.ok) {
      setNotes(((await res.json()) as { notes: NoteSummary[] }).notes ?? []);
    }
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const createNote = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/analytikul/notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: dayjs().format('YYYY-MM-DD') }),
      });
      if (res.ok) {
        const { note } = (await res.json()) as { note: { _id: string } };
        await load();
        setSelected(note._id);
      }
    } finally {
      setCreating(false);
    }
  }, [headers, load]);

  // Import a Markdown (.md) file as a note. Analytikul stores Markdown natively, so
  // the file text becomes the note content directly — all formatting is preserved.
  const importMarkdown = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const md = await file.text();
        const title = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported note';
        const res = await fetch('/api/analytikul/notes', {
          method: 'POST',
          headers,
          body: JSON.stringify({ title }),
        });
        if (!res.ok) {
          return;
        }
        const { note } = (await res.json()) as { note: { _id: string } };
        await fetch(`/api/analytikul/notes/${note._id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ title, content: md, sharedWithOrg: false }),
        });
        await load();
        setSelected(note._id);
      } finally {
        setImporting(false);
        if (fileInput.current) {
          fileInput.current.value = '';
        }
      }
    },
    [headers, load],
  );

  const removeNote = useCallback(
    async (id: string) => {
      await fetch(`/api/analytikul/notes/${id}`, { method: 'DELETE', headers });
      setSelected((prev) => (prev === id ? null : prev));
      void load();
    },
    [headers, load],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes ?? []).filter((n) => !q || (n.title ?? '').toLowerCase().includes(q));
  }, [notes, query]);

  return (
    <div className="flex h-full w-full bg-surface-primary text-text-primary">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border-light">
        <div className="flex items-center justify-between gap-1 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            {showReopen && <OpenSidebar className="shrink-0" />}
            <StickyNote size={15} aria-hidden="true" />
            {localize('com_atk_notes_title')}
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt,text/markdown"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void importMarkdown(file);
                }
              }}
            />
            <button
              type="button"
              title={localize('com_atk_notes_import')}
              aria-label={localize('com_atk_notes_import')}
              disabled={importing}
              className="flex items-center rounded-md border border-border-medium px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
              onClick={() => fileInput.current?.click()}
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
            </button>
            <button
              type="button"
              disabled={creating}
              className="flex items-center gap-1 rounded-md bg-text-primary px-2 py-1 text-xs text-surface-primary hover:opacity-90 disabled:opacity-50"
              onClick={() => void createNote()}
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {localize('com_atk_notes_new')}
            </button>
          </div>
        </div>

        <div className="px-2.5 pb-1.5">
          <input
            value={query}
            placeholder={localize('com_atk_notes_search')}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-border-light bg-surface-primary px-2.5 py-1.5 text-sm outline-none focus:border-border-heavy"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-1.5">
          {notes != null && filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-text-tertiary">
              {localize('com_atk_notes_empty')}
            </p>
          )}
          {filtered.map((note) => (
            <button
              key={note._id}
              type="button"
              onClick={() => setSelected(note._id)}
              className={cn(
                'group mb-0.5 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors',
                selected === note._id ? 'bg-surface-active' : 'hover:bg-surface-hover',
              )}
            >
              <span className="flex-1 truncate text-sm">
                {note.title || localize('com_atk_notes_untitled')}
              </span>
              <Trash2
                size={13}
                className="shrink-0 text-text-tertiary opacity-0 hover:text-text-destructive group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  void removeNote(note._id);
                }}
              />
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        {selected ? (
          <NoteEditor key={selected} noteId={selected} embedded onSaved={load} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-tertiary">
            <StickyNote size={40} className="opacity-30" aria-hidden="true" />
            <p className="text-sm">{localize('com_atk_notes_select_or_create')}</p>
            <button
              type="button"
              onClick={() => void createNote()}
              className="flex items-center gap-1.5 rounded-md border border-border-medium px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover"
            >
              <Plus size={15} />
              {localize('com_atk_notes_new')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
