import { memo, useState, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import Parameters from '~/components/SidePanel/Parameters/Panel';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Open WebUI-style "Controls" entry point: a sliders button in the chat header
 * that slides out a right-side drawer exposing the per-conversation System
 * Prompt and the full model-parameter panel (temperature, top_p, max tokens,
 * stop sequences, …) plus Save-as-Preset. Mounted inside ChatView's
 * ChatContext, so it edits the active conversation directly.
 */
function ControlsButton() {
  const localize = useLocalize();
  const { conversation, setConversation } = useChatContext();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  const onPromptChange = useCallback(
    (value: string) => {
      setConversation((prev) => (prev ? { ...prev, promptPrefix: value } : prev));
    },
    [setConversation],
  );

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
          <div className="px-3 pt-3">
            <label
              htmlFor="atk-system-prompt"
              className="mb-1.5 block text-xs font-medium text-text-secondary"
            >
              {localize('com_atk_system_prompt')}
            </label>
            <textarea
              id="atk-system-prompt"
              className="min-h-[88px] w-full resize-y rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:border-border-heavy focus:outline-none"
              placeholder={localize('com_atk_system_prompt_ph')}
              value={conversation?.promptPrefix ?? ''}
              onChange={(e) => onPromptChange(e.target.value)}
            />
          </div>
          <Parameters />
        </div>
      </aside>
    </>
  );
}

export default memo(ControlsButton);
