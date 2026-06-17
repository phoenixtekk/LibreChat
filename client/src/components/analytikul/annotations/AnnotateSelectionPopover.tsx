import { useEffect, useRef, useState, useCallback } from 'react';
import * as Ariakit from '@ariakit/react';
import { useSetRecoilState } from 'recoil';
import { useAuthContext, useLocalize } from '~/hooks';
import store from '~/store';
import { createAnnotation } from './api';

const CONTEXT_LEN = 40;

type CaptureState = {
  messageId: string;
  conversationId: string;
  highlightedText: string;
  containingParagraph: string;
  contextBefore: string;
  contextAfter: string;
  anchorRect: DOMRect;
};

/** Walk up from a node looking for the message-render ancestor (id = messageId). */
function findMessageAncestor(node: Node | null): HTMLElement | null {
  let el = node instanceof Element ? (node as HTMLElement) : node?.parentElement ?? null;
  while (el) {
    if (el.classList?.contains('message-render') && el.id) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function isInsideCodeBlock(node: Node | null): boolean {
  let el = node instanceof Element ? (node as HTMLElement) : node?.parentElement ?? null;
  while (el) {
    const tag = el.tagName;
    if (tag === 'PRE' || tag === 'CODE' || el.classList?.contains('hljs')) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** Mount once near the chat root. Watches for text selections inside finalized
 *  assistant messages and opens a popover at the selection end with a Save
 *  action (+ optional comment). */
export default function AnnotateSelectionPopover({ conversationId }: { conversationId: string }) {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const bumpChangedAt = useSetRecoilState(store.annotationsChangedAt);
  const popoverStore = Ariakit.usePopoverStore({ placement: 'bottom-start' });
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // Hide if click outside the popover (the store handles its own dismissal).
  useEffect(() => {
    function onMouseUp() {
      // Defer so the selection is final.
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          return;
        }
        const range = sel.getRangeAt(0);
        const text = sel.toString();
        if (!text || text.trim().length < 2) {
          return;
        }
        const startEl = findMessageAncestor(range.startContainer);
        const endEl = findMessageAncestor(range.endContainer);
        if (!startEl || startEl !== endEl) {
          // Cross-message selections aren't annotated.
          return;
        }
        if (isInsideCodeBlock(range.commonAncestorContainer)) {
          return;
        }
        if (startEl.getAttribute('data-streaming') === 'true') {
          return;
        }
        // Containing paragraph: nearest <p> inside the message ancestor.
        let pNode: HTMLElement | null = range.startContainer instanceof Element
          ? (range.startContainer as HTMLElement)
          : range.startContainer.parentElement;
        while (pNode && pNode !== startEl && pNode.tagName !== 'P') {
          pNode = pNode.parentElement;
        }
        const paragraphText = (pNode?.textContent ?? '').trim().slice(0, 16000);
        // Compute simple before/after context out of the paragraph text.
        let contextBefore = '';
        let contextAfter = '';
        const cleanText = text.trim();
        const idx = paragraphText.indexOf(cleanText);
        if (idx >= 0) {
          contextBefore = paragraphText.slice(Math.max(0, idx - CONTEXT_LEN), idx);
          contextAfter = paragraphText.slice(
            idx + cleanText.length,
            Math.min(paragraphText.length, idx + cleanText.length + CONTEXT_LEN),
          );
        }
        const rect = range.getBoundingClientRect();
        setCapture({
          messageId: startEl.id,
          conversationId,
          highlightedText: cleanText.slice(0, 8000),
          containingParagraph: paragraphText,
          contextBefore,
          contextAfter,
          anchorRect: rect,
        });
        setNote('');
        setError(null);
        popoverStore.show();
      }, 0);
    }
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [conversationId, popoverStore]);

  // Hide when the popover dismisses (user clicked outside / pressed Esc).
  // Ariakit v0.4 uses hook-based state — Store has no `.subscribe()`.
  const popoverOpen = Ariakit.useStoreState(popoverStore, 'open');
  useEffect(() => {
    if (!popoverOpen) {
      setCapture(null);
    }
  }, [popoverOpen]);

  // Anchor positioning: invisible div placed at the end of the selection rect.
  const anchorStyle: React.CSSProperties = capture
    ? {
        position: 'fixed',
        top: capture.anchorRect.bottom,
        left: capture.anchorRect.right,
        width: 0,
        height: 0,
        pointerEvents: 'none',
      }
    : { display: 'none' };

  const onSave = useCallback(async () => {
    if (!capture) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createAnnotation(token, {
        conversationId: capture.conversationId,
        messageId: capture.messageId,
        highlightedText: capture.highlightedText,
        containingParagraph: capture.containingParagraph,
        contextBefore: capture.contextBefore,
        contextAfter: capture.contextAfter,
        note: note.trim().slice(0, 2000),
      });
      bumpChangedAt(Date.now());
      window.getSelection()?.removeAllRanges();
      popoverStore.hide();
      setCapture(null);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to save');
    } finally {
      setSaving(false);
    }
  }, [bumpChangedAt, capture, note, popoverStore, token]);

  return (
    <>
      <div ref={anchorRef} style={anchorStyle} aria-hidden="true" />
      <Ariakit.PopoverAnchor store={popoverStore} render={<div ref={anchorRef} style={anchorStyle} />} />
      <Ariakit.Popover
        store={popoverStore}
        gutter={6}
        portal
        unmountOnHide
        className="z-[1100] w-64 rounded-xl border border-border-medium bg-surface-primary-alt p-2 shadow-xl"
      >
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={localize('com_atk_annotate_note_ph')}
          maxLength={2000}
          className="w-full resize-none rounded-md border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-text-primary outline-none focus:border-border-heavy"
        />
        {error != null && (
          <div className="mt-1 px-1 text-xs text-text-destructive">{error}</div>
        )}
        <div className="mt-1.5 flex items-center justify-end">
          <button
            type="button"
            disabled={saving || capture == null}
            onClick={onSave}
            className="rounded-md bg-surface-submit px-3 py-1 text-sm font-medium text-white hover:bg-surface-submit-hover disabled:opacity-50"
          >
            {saving ? '…' : localize('com_atk_annotate_save')}
          </button>
        </div>
      </Ariakit.Popover>
    </>
  );
}
