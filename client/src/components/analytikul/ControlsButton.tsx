import { memo, useState, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import ControlsPanel from './ControlsPanel';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Open WebUI-style "Controls" entry point: a sliders button in the chat header
 * that slides out a right-side drawer with the full Controls panel (Valves,
 * System Prompt, and the complete Advanced Params list + Add Custom Parameter).
 */
function ControlsButton() {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
        aria-label={localize('com_atk_controls_open')}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] bg-black/40"
          role="presentation"
          onClick={close}
          style={{ transition: 'opacity 200ms ease' }}
        />
      )}
      <aside
        className={cn(
          'fixed right-0 top-0 z-[121] flex h-full w-[min(92vw,380px)] flex-col bg-surface-primary-alt shadow-2xl',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ transition: 'transform 280ms cubic-bezier(0.2, 0, 0, 1)' }}
        aria-hidden={!open}
        inert={!open ? '' : undefined}
      >
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
          <span className="text-sm font-semibold text-text-primary">
            {localize('com_atk_controls')}
          </span>
          <button
            type="button"
            className="rounded-xl p-1.5 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            aria-label={localize('com_atk_close_rail')}
            onClick={close}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ControlsPanel />
        </div>
      </aside>
    </>
  );
}

export default memo(ControlsButton);
