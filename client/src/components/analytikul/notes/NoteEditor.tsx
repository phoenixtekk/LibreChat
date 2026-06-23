import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/core';
import { useLocalize, useAuthContext } from '~/hooks';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import store from '~/store';
import { htmlToMarkdown, markdownToHtml } from './markdown';
import { dayjs } from './time';

interface Note {
  _id: string;
  title: string;
  content: string;
  sharedWithOrg: boolean;
  pinnedBy: string[];
  createdAt: string;
  updatedAt: string;
}

type AiAction = 'enhance' | 'summarize' | 'continue';

const AUTOSAVE_MS = 600;

/**
 * Open WebUI-style note editor: WYSIWYG TipTap (same engine Open WebUI uses)
 * with markdown in/out, title input, "<date> · N words · M characters" meta
 * line, undo/redo, bubble formatting toolbar on selection, and AI actions
 * (enhance/summarize/continue) running as metered agent calls.
 */
export default function NoteEditor() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { noteId } = useParams();
  const { token } = useAuthContext();
  // When the sidebar is collapsed on desktop, this full-page note view has no
  // chat header (where the reopen toggle normally lives), so surface one here —
  // otherwise the user is stranded with no way back. Mobile already has the
  // sidebar's own floating drawer toggle.
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const showReopen = !sidebarExpanded && !isSmallScreen;
  const [note, setNote] = useState<Note | null>(null);
  const [aiBusy, setAiBusy] = useState<AiAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<Note | null>(null);
  noteRef.current = note;
  const editorRef = useRef<Editor | null>(null);

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: localize('com_atk_notes_placeholder') }),
    ],
    editorProps: {
      attributes: {
        class:
          'atk-note-prose prose dark:prose-invert prose-sm sm:prose-base max-w-none focus:outline-none min-h-[60vh] px-1',
      },
      // Paste markdown as rich text (Open WebUI parity). Real HTML pastes (from
      // rendered sources) fall through to ProseMirror's default handling.
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html') ?? '';
        if (html.trim() !== '') {
          return false;
        }
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const active = editorRef.current;
        if (text.trim() === '' || active == null) {
          return false;
        }
        active.chain().focus().insertContent(markdownToHtml(text)).run();
        return true;
      },
    },
    onUpdate: () => scheduleSave(),
  });

  editorRef.current = editor;

  const persist = useCallback(async () => {
    const current = noteRef.current;
    if (current == null || editor == null) {
      return;
    }
    const markdown = htmlToMarkdown(editor.getHTML());
    await fetch(`/api/analytikul/notes/${current._id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        title: current.title,
        content: markdown,
        sharedWithOrg: current.sharedWithOrg,
      }),
    });
  }, [editor, headers]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current != null) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }, [persist]);

  useEffect(() => {
    if (noteId == null || editor == null) {
      return;
    }
    void (async () => {
      const res = await fetch(`/api/analytikul/notes/${noteId}`, { headers });
      if (!res.ok) {
        navigate('/notes');
        return;
      }
      const { note: loaded } = (await res.json()) as { note: Note };
      setNote(loaded);
      editor.commands.setContent(markdownToHtml(loaded.content), { emitUpdate: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editor == null]);

  const stats = useMemo(() => {
    const text = editor?.state.doc.textContent ?? '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, chars: text.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.state.doc.content.size, editor]);

  const runAi = useCallback(
    async (action: AiAction) => {
      if (editor == null || note == null || aiBusy != null) {
        return;
      }
      const { from, to, empty } = editor.state.selection;
      const markdown = htmlToMarkdown(editor.getHTML());
      const selectionText = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
      const inputText = !empty && action !== 'continue' ? selectionText : markdown;
      if (inputText.trim() === '') {
        return;
      }
      setAiBusy(action);
      setError(null);
      try {
        const res = await fetch('/api/analytikul/notes/ai', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action, text: inputText, noteId: note._id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `AI failed (${res.status})`);
        }
        const { result } = (await res.json()) as { result: string };
        if (action === 'continue') {
          editor.commands.focus('end');
          editor.commands.insertContent(markdownToHtml(result));
        } else if (!empty) {
          editor
            .chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent(markdownToHtml(result))
            .run();
        } else if (action === 'summarize') {
          editor.commands.focus('end');
          editor.commands.insertContent(
            markdownToHtml(`## ${localize('com_atk_notes_summary')}\n\n${result}`),
          );
        } else {
          editor.commands.setContent(markdownToHtml(result));
        }
        scheduleSave();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI failed');
      } finally {
        setAiBusy(null);
      }
    },
    [editor, note, aiBusy, headers, localize, scheduleSave],
  );

  if (note == null) {
    return <div className="atk-empty-state">{localize('com_atk_loading')}</div>;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-primary text-text-primary">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-3.5 pt-3">
        {showReopen && <OpenSidebar className="shrink-0" />}
        <input
          value={note.title}
          placeholder={localize('com_atk_notes_title_ph')}
          className="w-full bg-transparent text-2xl font-medium outline-none"
          aria-label={localize('com_atk_notes_note_title')}
          onChange={(event) => {
            setNote((prev) => (prev == null ? prev : { ...prev, title: event.target.value }));
            scheduleSave();
          }}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={localize('com_atk_notes_undo')}
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
            path="M9 14H4V9M4.5 13.5A8 8 0 1 1 7 18"
          />
          <IconButton
            label={localize('com_atk_notes_redo')}
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
            path="M15 14h5V9M19.5 13.5A8 8 0 1 0 17 18"
          />
          {(['enhance', 'summarize', 'continue'] as AiAction[]).map((action) => (
            <button
              key={action}
              type="button"
              className="rounded-xl px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              disabled={aiBusy != null}
              onClick={() => void runAi(action)}
            >
              {aiBusy === action ? '…' : localize(`com_atk_notes_ai_${action}`)}
            </button>
          ))}
          <label className="flex items-center gap-1 px-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={note.sharedWithOrg}
              onChange={(event) => {
                setNote((prev) =>
                  prev == null ? prev : { ...prev, sharedWithOrg: event.target.checked },
                );
                scheduleSave();
              }}
            />
            {localize('com_atk_notes_share_org')}
          </label>
        </div>
      </div>

      <div className="px-3.5 py-1 text-xs text-text-tertiary" aria-live="polite">
        {`${dayjs(note.createdAt).calendar()} · ${stats.words} ${localize('com_atk_notes_words')} ${stats.chars} ${localize('com_atk_notes_chars')}`}
      </div>

      {error != null && <div className="px-3.5 py-1 text-xs text-text-destructive">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-24 pt-2">
        {editor != null && (
          <BubbleMenu editor={editor}>
            <div className="flex items-center gap-0.5 rounded-xl border border-border-light bg-surface-dialog p-0.5 shadow-lg">
              <BubbleButton
                active={editor.isActive('heading', { level: 1 })}
                label="H1"
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              />
              <BubbleButton
                active={editor.isActive('heading', { level: 2 })}
                label="H2"
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              />
              <BubbleButton
                active={editor.isActive('heading', { level: 3 })}
                label="H3"
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              />
              <BubbleButton
                active={editor.isActive('bulletList')}
                label="•"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              />
              <BubbleButton
                active={editor.isActive('orderedList')}
                label="1."
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              />
              <BubbleButton
                active={editor.isActive('taskList')}
                label="☑"
                onClick={() => editor.chain().focus().toggleTaskList().run()}
              />
              <BubbleButton
                active={editor.isActive('bold')}
                label="B"
                bold
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <BubbleButton
                active={editor.isActive('italic')}
                label="I"
                italic
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <BubbleButton
                active={editor.isActive('underline')}
                label="U"
                underline
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              />
              <BubbleButton
                active={editor.isActive('strike')}
                label="S"
                strike
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
              <BubbleButton
                active={editor.isActive('code')}
                label="<>"
                onClick={() => editor.chain().focus().toggleCode().run()}
              />
            </div>
          </BubbleMenu>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function IconButton({
  label,
  path,
  disabled = false,
  onClick,
}: {
  label: string;
  path: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-xl p-1.5 hover:bg-surface-hover disabled:opacity-40"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={path}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function BubbleButton({
  label,
  active,
  bold = false,
  italic = false,
  strike = false,
  underline = false,
  onClick,
}: {
  label: string;
  active: boolean;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`min-w-7 rounded-lg px-1.5 py-1 text-xs hover:bg-surface-hover ${
        active ? 'bg-surface-active text-text-primary' : 'text-text-secondary'
      } ${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''} ${strike ? 'line-through' : ''} ${
        underline ? 'underline' : ''
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
