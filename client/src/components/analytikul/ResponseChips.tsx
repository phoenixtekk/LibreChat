import { Scissors, Briefcase, Shuffle } from 'lucide-react';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];

type ChipSpec = {
  id: string;
  labelKey: string;
  promptKey: string;
  icon: typeof Scissors;
};

const CHIPS: ChipSpec[] = [
  { id: 'shorter',  labelKey: 'com_atk_response_shorter',  promptKey: 'com_atk_response_shorter_prompt',  icon: Scissors },
  { id: 'formal',   labelKey: 'com_atk_response_formal',   promptKey: 'com_atk_response_formal_prompt',   icon: Briefcase },
  { id: 'angle',    labelKey: 'com_atk_response_angle',    promptKey: 'com_atk_response_angle_prompt',    icon: Shuffle },
];

/** One-tap response adjustment chips. Render under the latest assistant
 *  message. Click sends a fresh user message asking the assistant to
 *  re-do its previous reply with the requested adjustment — no typing
 *  needed.
 *
 *  Newcomer UX: removes the "what should I say to make this better?"
 *  block. Each click is also a tiny rep at "what to ask next" — they
 *  learn the vocabulary by seeing what the chips do. */
export default function ResponseChips({
  conversationId,
  parentMessageId,
}: {
  conversationId: string | null;
  parentMessageId: string | null;
}) {
  const localize = useLocalize();
  const { ask, isSubmitting } = useChatContext();

  if (isSubmitting) {
    return null;
  }

  const onChipClick = (promptKey: string) => {
    const text = localize(promptKey as LocalizeKey);
    if (!text || !ask) {
      return;
    }
    ask({
      text,
      conversationId: conversationId ?? null,
      parentMessageId: parentMessageId ?? null,
    });
  };

  return (
    <div className="atk-response-chips" role="group" aria-label={localize('com_atk_response_group' as LocalizeKey)}>
      {CHIPS.map(({ id, labelKey, promptKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="atk-response-chip"
          onClick={() => onChipClick(promptKey)}
        >
          <Icon size={11} aria-hidden="true" />
          <span>{localize(labelKey as LocalizeKey)}</span>
        </button>
      ))}
    </div>
  );
}
