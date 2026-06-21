import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useGhostHint } from './useGhostHint';
import { useLocalize } from '~/hooks';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];

/** Renders a single subtle one-shot hint below wherever it's placed.
 *  Use directly inline with a place + a trigger condition.
 *
 *  Example:
 *    <GhostHint
 *      id="discover-shortcut"
 *      when={isLandingPage}
 *      labelKey="com_atk_hint_discover_shortcut"
 *    /> */
export default function GhostHint({
  id,
  when,
  labelKey,
  children,
}: {
  id: string;
  when: boolean;
  labelKey?: string;
  children?: ReactNode;
}) {
  const localize = useLocalize();
  const { visible, dismiss } = useGhostHint(id, when);
  if (!visible) {
    return null;
  }
  return (
    <div className="atk-ghost-hint" role="status" aria-live="polite">
      <span className="atk-ghost-hint-body">
        {children ?? (labelKey ? localize(labelKey as LocalizeKey) : null)}
      </span>
      <button
        type="button"
        className="atk-ghost-hint-dismiss"
        onClick={dismiss}
        aria-label={localize('com_atk_discover_dismiss_new')}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}
