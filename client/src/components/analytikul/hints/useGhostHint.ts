import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY_PREFIX = 'atk:hint:seen:';
/** Bumping this resets *all* ghost hints for everyone — use when wording
 *  or hint set changes meaningfully. */
const HINT_VERSION = '1';

function storageKey(id: string): string {
  return `${STORAGE_KEY_PREFIX}${HINT_VERSION}:${id}`;
}

function readSeen(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) === 'true';
  } catch {
    return true;
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(storageKey(id), 'true');
  } catch {
    /* ignore */
  }
}

/** Ghost-hint controller. Renders the hint if (a) the user hasn't seen
 *  it AND (b) the `when` condition is true. Once shown, calling
 *  `dismiss()` marks it seen forever (until HINT_VERSION bumps).
 *
 *  Newcomer UX: one-shot, lifetime-per-user hints fired at the moment
 *  of relevance, never repeated. Power users see zero; newcomers learn
 *  five things the first week. */
export function useGhostHint(id: string, when: boolean): {
  visible: boolean;
  dismiss: () => void;
} {
  const [seen, setSeen] = useState<boolean>(() => readSeen(id));

  useEffect(() => {
    if (when && !seen) {
      writeSeen(id);
    }
  }, [id, when, seen]);

  const dismiss = useCallback(() => {
    writeSeen(id);
    setSeen(true);
  }, [id]);

  return { visible: when && !seen, dismiss };
}
