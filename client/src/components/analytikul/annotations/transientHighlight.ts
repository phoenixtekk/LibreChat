/** Transient "jump-to-annotation" indicator. No persistent DOM mutation —
 *  briefly wraps the saved text in a <mark> + pulses the containing paragraph
 *  + floats a chip near the snippet, then cleans everything up. */

type Anchored = {
  highlightedText: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
};

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

function wrapRange(node: Text, start: number, length: number, className: string): HTMLElement | null {
  const text = node.data;
  const parent = node.parentNode;
  if (!parent) {
    return null;
  }
  const before = text.slice(0, start);
  const matched = text.slice(start, start + length);
  const after = text.slice(start + length);
  if (before) {
    parent.insertBefore(document.createTextNode(before), node);
  }
  const mark = document.createElement('mark');
  mark.className = className;
  mark.textContent = matched;
  parent.insertBefore(mark, node);
  if (after) {
    parent.insertBefore(document.createTextNode(after), node);
  }
  parent.removeChild(node);
  return mark;
}

function injectMark(root: HTMLElement, a: Anchored): HTMLElement | null {
  const className = 'atk-annotation atk-transient';
  const anchored = `${a.contextBefore}${a.highlightedText}${a.contextAfter}`;
  if (anchored !== a.highlightedText) {
    for (const node of collectTextNodes(root)) {
      const idx = node.data.indexOf(anchored);
      if (idx < 0) {
        continue;
      }
      return wrapRange(node, idx + a.contextBefore.length, a.highlightedText.length, className);
    }
  }
  for (const node of collectTextNodes(root)) {
    const idx = node.data.indexOf(a.highlightedText);
    if (idx >= 0) {
      return wrapRange(node, idx, a.highlightedText.length, className);
    }
  }
  return null;
}

function findContainingBlock(mark: Element): HTMLElement | null {
  let el: HTMLElement | null = mark.parentElement;
  while (el) {
    const tag = el.tagName;
    if (
      tag === 'P' ||
      tag === 'LI' ||
      tag === 'BLOCKQUOTE' ||
      tag === 'TD' ||
      tag === 'H1' ||
      tag === 'H2' ||
      tag === 'H3' ||
      tag === 'H4'
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function unwrap(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) {
    return;
  }
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize?.();
}

function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function buildChip(a: Anchored): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'atk-annotation-chip';
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  chip.textContent = a.note ? `Note: ${clip(a.note, 60)}` : `Saved: "${clip(a.highlightedText, 50)}"`;
  return chip;
}

function positionChip(chip: HTMLDivElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  const top = Math.max(8, rect.top - 38);
  const left = Math.min(window.innerWidth - 300, Math.max(8, rect.left));
  chip.style.top = `${top}px`;
  chip.style.left = `${left}px`;
}

const DURATION_MS = 3000;

export function playTransientHighlight(messageId: string, a: Anchored): void {
  const root = document.getElementById(messageId);
  console.warn('[annotations] play:', { messageId, hasRoot: !!root, text: a.highlightedText?.slice(0, 30) });
  if (!root) {
    return;
  }
  const mark = injectMark(root, a);
  const anchorEl: Element = mark ?? root;
  const block: HTMLElement = mark ? (findContainingBlock(mark) ?? root) : root;
  block.classList.add('atk-paragraph-pulse');
  console.warn('[annotations] mark injected:', !!mark, 'block:', block.tagName);

  const chip = buildChip(a);
  document.body.appendChild(chip);
  positionChip(chip, anchorEl);

  window.setTimeout(() => {
    if (mark && mark.isConnected) {
      unwrap(mark);
    }
    block.classList.remove('atk-paragraph-pulse');
    chip.remove();
  }, DURATION_MS);
}
