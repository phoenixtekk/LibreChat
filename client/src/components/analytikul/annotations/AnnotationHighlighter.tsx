import { useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';
import type { AnnotationLite } from '~/store/misc';

/** Walks all text nodes inside `root` in document order, skipping any inside
 *  existing annotation marks, code blocks, or links. */
function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      let el: HTMLElement | null = n.parentElement;
      while (el && el !== root) {
        const tag = el.tagName;
        if (
          tag === 'MARK' ||
          tag === 'PRE' ||
          tag === 'CODE' ||
          tag === 'A' ||
          el.classList?.contains('hljs')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = walker.nextNode();
  while (n) {
    out.push(n as Text);
    n = walker.nextNode();
  }
  return out;
}

/** Wrap the first occurrence of `needle` inside one of the given text nodes
 *  in a <mark> with the given attributes. Cross-node matches are skipped. */
function wrapFirstMatch(nodes: Text[], needle: string, attrs: Record<string, string>): boolean {
  if (!needle) {
    return false;
  }
  for (const node of nodes) {
    const text = node.data;
    const idx = text.indexOf(needle);
    if (idx < 0) {
      continue;
    }
    const parent = node.parentNode;
    if (!parent) {
      continue;
    }
    const before = text.slice(0, idx);
    const after = text.slice(idx + needle.length);
    if (before) {
      parent.insertBefore(document.createTextNode(before), node);
    }
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) {
      mark.setAttribute(k, v);
    }
    mark.textContent = needle;
    parent.insertBefore(mark, node);
    if (after) {
      parent.insertBefore(document.createTextNode(after), node);
    }
    parent.removeChild(node);
    return true;
  }
  return false;
}

/** Try to wrap using the context-anchored window (`contextBefore + text +
 *  contextAfter`) first — gives uniqueness when the same phrase appears more
 *  than once. Falls back to bare-text match. */
function injectOne(root: HTMLElement, a: AnnotationLite): void {
  const attrs: Record<string, string> = {
    class: 'atk-annotation',
    'data-annotation-id': a._id,
  };
  if (a.note) {
    attrs.title = a.note;
  }
  const anchored = `${a.contextBefore}${a.highlightedText}${a.contextAfter}`;
  if (anchored !== a.highlightedText) {
    const nodes = collectTextNodes(root);
    for (const node of nodes) {
      const text = node.data;
      const idx = text.indexOf(anchored);
      if (idx < 0) {
        continue;
      }
      const parent = node.parentNode;
      if (!parent) {
        return;
      }
      const matchStart = idx + a.contextBefore.length;
      const before = text.slice(0, matchStart);
      const after = text.slice(matchStart + a.highlightedText.length);
      if (before) {
        parent.insertBefore(document.createTextNode(before), node);
      }
      const mark = document.createElement('mark');
      for (const [k, v] of Object.entries(attrs)) {
        mark.setAttribute(k, v);
      }
      mark.textContent = a.highlightedText;
      parent.insertBefore(mark, node);
      if (after) {
        parent.insertBefore(document.createTextNode(after), node);
      }
      parent.removeChild(node);
      return;
    }
  }
  wrapFirstMatch(collectTextNodes(root), a.highlightedText, attrs);
}

function unwrapExisting(root: HTMLElement): void {
  root.querySelectorAll('mark.atk-annotation').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) {
      return;
    }
    while (m.firstChild) {
      parent.insertBefore(m.firstChild, m);
    }
    parent.removeChild(m);
    parent.normalize?.();
  });
}

/** Mount once per message. Re-applies highlights whenever the annotations for
 *  this message change OR the message DOM changes (markdown re-renders, React
 *  reconciles, etc.). Covers every text container (p, li, blockquote, td…)
 *  because it walks the entire message root. */
export default function AnnotationHighlighter({ messageId }: { messageId: string }) {
  const byMessage = useRecoilValue(store.annotationsByMessageId);
  const scrollTarget = useRecoilValue(store.annotationScrollTarget);
  const annotations = byMessage[messageId] ?? [];

  useEffect(() => {
    if (!annotations.length) {
      // No annotations: still try to clean up any marks left behind.
      const root = document.getElementById(messageId);
      if (root) {
        unwrapExisting(root);
      }
      return;
    }

    let applying = false;
    function apply() {
      const root = document.getElementById(messageId);
      if (!root) {
        return;
      }
      // Guard against our own mutations re-triggering the observer.
      applying = true;
      unwrapExisting(root);
      for (const a of annotations) {
        injectOne(root, a);
      }
      // Defer turning the guard off so the observer's microtask sees applying=true.
      Promise.resolve().then(() => {
        applying = false;
      });
    }

    apply();

    // Retry shortly in case the markdown wasn't in the DOM yet on first run.
    const t = setTimeout(apply, 150);

    // Re-apply if the message content changes (streaming finishes, React
    // reconciles, etc.).
    const root = document.getElementById(messageId);
    let observer: MutationObserver | null = null;
    if (root && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (applying) {
          return;
        }
        // Coalesce frequent mutations.
        requestAnimationFrame(apply);
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    return () => {
      clearTimeout(t);
      observer?.disconnect();
      const node = document.getElementById(messageId);
      if (node) {
        unwrapExisting(node);
      }
    };
  }, [messageId, annotations]);

  // Pulse the scroll target after navigation.
  useEffect(() => {
    if (!scrollTarget) {
      return;
    }
    const match = document.querySelector(
      `mark.atk-annotation[data-annotation-id="${scrollTarget}"]`,
    );
    if (match) {
      match.classList.add('pulse');
      const timer = setTimeout(() => match.classList.remove('pulse'), 2000);
      return () => clearTimeout(timer);
    }
  }, [scrollTarget, annotations]);

  return null;
}
