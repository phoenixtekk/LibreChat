import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocalize, useAuthContext } from '~/hooks';

interface NoteSummary {
  _id: string;
  title: string;
  user: string;
  sharedWithOrg: boolean;
  pinnedBy: string[];
  updatedAt: string;
}

interface Note extends NoteSummary {
  content: string;
}

type AiAction = 'enhance' | 'summarize' | 'continue';

const AUTOSAVE_MS = 1200;

/**
 * Notes workspace (Open WebUI parity): searchable list with per-user pins,
 * markdown editor with formatting toolbar + live preview, autosave, export,
 * org sharing, and AI actions (enhance / summarize / continue) that run as
 * metered agent calls — they appear in the Costs dashboard like everything else.
 */
export default function NotesPage() {
  const localize = useLocalize();
  const { token, user } = useAuthContext();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Note | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [aiBusy, setAiBusy] = useState<AiAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const loadList = useCallback(async () => {
    const res = await fetch(
      `/api/analytikul/notes${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      { headers },
    );
    if (res.ok) {
      setNotes(((await res.json()) as { notes: NoteSummary[] }).notes);
    }
  }, [headers, query]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openNote = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/analytikul/notes/${id}`, { headers });
      if (res.ok) {
        setActive(((await res.json()) as { note: Note }).note);
        setSaving('idle');
        setPreview(false);
      }
    },
    [headers],
  );

  const createNote = useCallback(async () => {
    const res = await fetch('/api/analytikul/notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: localize('com_atk_notes_untitled') }),
    });
    if (res.ok) {
      const { note } = (await res.json()) as { note: Note };
      setActive(note);
      void loadList();
    }
  }, [headers, loadList, localize]);

  const persist = useCallback(
    async (note: Note) => {
      setSaving('saving');
      const res = await fetch(`/api/analytikul/notes/${note._id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          title: note.title,
          content: note.content,
          sharedWithOrg: note.sharedWithOrg,
        }),
      });
      setSaving(res.ok ? 'saved' : 'dirty');
      if (res.ok) {
        void loadList();
      }
    },
    [headers, loadList],
  );

  const mutateActive = useCallback(
    (patch: Partial<Note>) => {
      setActive((prev) => {
        if (prev == null) {
          return prev;
        }
        const next = { ...prev, ...patch };
        setSaving('dirty');
        if (saveTimer.current != null) {
          clearTimeout(saveTimer.current);
        }
        saveTimer.current = setTimeout(() => void persist(next), AUTOSAVE_MS);
        return next;
      });
    },
    [persist],
  );

  const togglePin = useCallback(
    async (id: string) => {
      await fetch(`/api/analytikul/notes/${id}/pin`, { method: 'POST', headers });
      void loadList();
    },
    [headers, loadList],
  );

  const removeNote = useCallback(
    async (id: string) => {
      await fetch(`/api/analytikul/notes/${id}`, { method: 'DELETE', headers });
      setActive((prev) => (prev?._id === id ? null : prev));
      void loadList();
    },
    [headers, loadList],
  );

  const exportNote = useCallback(() => {
    if (active == null) {
      return;
    }
    const blob = new Blob([`# ${active.title}\n\n${active.content}`], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${active.title.replace(/[^\w\- ]+/g, '').trim() || 'note'}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [active]);

  const insertAtCursor = useCallback(
    (before: string, after = '') => {
      const textarea = textareaRef.current;
      if (textarea == null || active == null) {
        return;
      }
      const { selectionStart, selectionEnd, value } = textarea;
      const selected = value.slice(selectionStart, selectionEnd);
      const next =
        value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
      mutateActive({ content: next });
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(selectionStart + before.length, selectionEnd + before.length);
      });
    },
    [active, mutateActive],
  );

  const runAi = useCallback(
    async (action: AiAction) => {
      const textarea = textareaRef.current;
      if (active == null || aiBusy != null) {
        return;
      }
      const selStart = textarea?.selectionStart ?? 0;
      const selEnd = textarea?.selectionEnd ?? 0;
      const hasSelection = selEnd > selStart;
      const inputText =
        hasSelection && action !== 'continue'
          ? active.content.slice(selStart, selEnd)
          : active.content;
      if (inputText.trim() === '') {
        return;
      }
      setAiBusy(action);
      setError(null);
      try {
        const res = await fetch('/api/analytikul/notes/ai', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action, text: inputText, noteId: active._id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `AI action failed (${res.status})`);
        }
        const { result } = (await res.json()) as { result: string };
        if (action === 'continue') {
          mutateActive({ content: `${active.content.replace(/\s+$/, '')}\n\n${result}` });
        } else if (action === 'summarize' && !hasSelection) {
          mutateActive({
            content: `${active.content}\n\n## ${localize('com_atk_notes_summary')}\n\n${result}`,
          });
        } else if (hasSelection) {
          mutateActive({
            content: active.content.slice(0, selStart) + result + active.content.slice(selEnd),
          });
        } else {
          mutateActive({ content: result });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI action failed');
      } finally {
        setAiBusy(null);
      }
    },
    [active, aiBusy, headers, mutateActive, localize],
  );

  const sorted = useMemo(() => {
    const userId = user?.id ?? '';
    return [...notes].sort((a, b) => {
      const pinDiff = Number(b.pinnedBy.includes(userId)) - Number(a.pinnedBy.includes(userId));
      return pinDiff !== 0 ? pinDiff : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [notes, user?.id]);

  const wordCount = useMemo(
    () => (active?.content.trim() ? active.content.trim().split(/\s+/).length : 0),
    [active?.content],
  );

  const toolbar: { label: string; title: string; action: () => void }[] = [
    { label: 'B', title: localize('com_atk_notes_bold'), action: () => insertAtCursor('**', '**') },
    { label: 'I', title: localize('com_atk_notes_italic'), action: () => insertAtCursor('*', '*') },
    { label: 'H2', title: localize('com_atk_notes_heading'), action: () => insertAtCursor('\n## ') },
    { label: '•', title: localize('com_atk_notes_list'), action: () => insertAtCursor('\n- ') },
    { label: '☑', title: localize('com_atk_notes_task'), action: () => insertAtCursor('\n- [ ] ') },
    { label: '</>', title: localize('com_atk_notes_code'), action: () => insertAtCursor('\n```\n', '\n```\n') },
  ];

  return (
    <div className="flex h-full w-full bg-surface-primary text-text-primary">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border-light bg-surface-primary-alt">
        <div className="flex items-center gap-2 p-2">
          <input
            value={query}
            placeholder={localize('com_atk_notes_search')}
            className="min-w-0 flex-1 rounded-md border border-border-medium bg-surface-primary p-1.5 text-sm outline-none focus:border-border-heavy"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="rounded-md bg-surface-submit px-2.5 py-1.5 text-sm text-white hover:bg-surface-submit-hover"
            aria-label={localize('com_atk_notes_new')}
            onClick={() => void createNote()}
          >
            +
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sorted.length === 0 && (
            <div className="p-3 text-center text-xs text-text-tertiary">
              {localize('com_atk_notes_empty')}
            </div>
          )}
          {sorted.map((note) => (
            <button
              key={note._id}
              type="button"
              className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover ${
                active?._id === note._id ? 'bg-surface-active' : ''
              }`}
              onClick={() => void openNote(note._id)}
            >
              <span className="min-w-0 flex-1 truncate">
                {note.pinnedBy.includes(user?.id ?? '') && <span aria-hidden="true">📌 </span>}
                {note.title}
                {note.sharedWithOrg && (
                  <span className="ml-1 text-xs text-text-tertiary">
                    {localize('com_atk_notes_shared_badge')}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {active == null ? (
          <div className="atk-empty-state">
            <strong>{localize('com_atk_notes_title')}</strong>
            <span>{localize('com_atk_notes_hint')}</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-border-light p-2">
              <input
                value={active.title}
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
                aria-label={localize('com_atk_notes_note_title')}
                onChange={(event) => mutateActive({ title: event.target.value })}
              />
              <span className="px-2 text-xs text-text-tertiary" aria-live="polite">
                {`${wordCount} ${localize('com_atk_notes_words')} · ${
                  saving === 'saving'
                    ? localize('com_atk_notes_saving')
                    : saving === 'dirty'
                      ? localize('com_atk_notes_unsaved')
                      : localize('com_atk_notes_saved')
                }`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1 border-b border-border-light p-1.5">
              {toolbar.map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  title={btn.title}
                  className="rounded-md border border-border-light px-2 py-0.5 text-xs hover:bg-surface-hover"
                  onClick={btn.action}
                >
                  {btn.label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border-medium" aria-hidden="true" />
              {(['enhance', 'summarize', 'continue'] as AiAction[]).map((action) => (
                <button
                  key={action}
                  type="button"
                  className="rounded-md border border-border-light px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                  disabled={aiBusy != null}
                  onClick={() => void runAi(action)}
                >
                  {aiBusy === action ? '…' : localize(`com_atk_notes_ai_${action}`)}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border-medium" aria-hidden="true" />
              <button
                type="button"
                className="rounded-md border border-border-light px-2 py-0.5 text-xs hover:bg-surface-hover"
                aria-pressed={preview}
                onClick={() => setPreview((prev) => !prev)}
              >
                {preview ? localize('com_atk_notes_edit') : localize('com_atk_notes_preview')}
              </button>
              <button
                type="button"
                className="rounded-md border border-border-light px-2 py-0.5 text-xs hover:bg-surface-hover"
                onClick={() => void togglePin(active._id)}
              >
                {active.pinnedBy.includes(user?.id ?? '')
                  ? localize('com_atk_notes_unpin')
                  : localize('com_atk_notes_pin')}
              </button>
              <label className="flex items-center gap-1 px-1 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={active.sharedWithOrg}
                  onChange={(event) => mutateActive({ sharedWithOrg: event.target.checked })}
                />
                {localize('com_atk_notes_share_org')}
              </label>
              <button
                type="button"
                className="rounded-md border border-border-light px-2 py-0.5 text-xs hover:bg-surface-hover"
                onClick={exportNote}
              >
                {localize('com_atk_notes_export')}
              </button>
              <button
                type="button"
                className="rounded-md border border-border-light px-2 py-0.5 text-xs text-text-destructive hover:bg-surface-hover"
                onClick={() => void removeNote(active._id)}
              >
                {localize('com_atk_notes_delete')}
              </button>
            </div>

            {error != null && (
              <div className="border-b border-border-destructive px-3 py-1 text-xs text-text-destructive">
                {error}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {preview ? (
                <div className="prose max-w-3xl p-4 dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{active.content}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={active.content}
                  placeholder={localize('com_atk_notes_placeholder')}
                  className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-6 text-text-primary outline-none"
                  onChange={(event) => mutateActive({ content: event.target.value })}
                />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
