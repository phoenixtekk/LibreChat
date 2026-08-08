import { useEffect } from 'react';

/**
 * Hermes-style composer history: ArrowUp/ArrowDown in an empty composer cycles
 * through previously sent messages. Attaches via a capture-phase document
 * listener targeting LibreChat's main textarea (#prompt-textarea) so no
 * upstream component needs editing.
 */

const HISTORY_KEY = 'analytikul-composer-history';
const MAX_ENTRIES = 50;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveEntry(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const history = loadHistory().filter((entry) => entry !== trimmed);
  history.push(trimmed);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_ENTRIES)));
}

function setNativeValue(textarea: HTMLTextAreaElement, value: string) {
  // Go through the native setter so React's onChange fires and form state stays in sync.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function useComposerHistory() {
  useEffect(() => {
    let cursor = -1; // -1 = not navigating; otherwise index from the end of history
    let draft = '';

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!(target instanceof HTMLTextAreaElement) || target.id !== 'prompt-textarea') {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        saveEntry(target.value);
        cursor = -1;
        return;
      }

      const history = loadHistory();
      if (history.length === 0) {
        return;
      }

      if (event.key === 'ArrowUp') {
        const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
        if (!(target.value === '' || cursor >= 0) || !(atStart || target.value === '')) {
          return;
        }
        if (cursor === -1) {
          draft = target.value;
        }
        if (cursor < history.length - 1) {
          cursor += 1;
          setNativeValue(target, history[history.length - 1 - cursor]);
          event.preventDefault();
        }
      } else if (event.key === 'ArrowDown' && cursor >= 0) {
        cursor -= 1;
        setNativeValue(target, cursor === -1 ? draft : history[history.length - 1 - cursor]);
        event.preventDefault();
      } else if (event.key === 'Escape' && cursor >= 0) {
        setNativeValue(target, draft);
        cursor = -1;
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
