import { FileText, Mail, BookOpen, BarChart3, Lightbulb, PenSquare } from 'lucide-react';
import { useChatFormContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { GhostHint } from './hints';

type StarterChip = {
  id: string;
  titleKey: string;
  promptKey: string;
  icon: typeof FileText;
};

const STARTERS: StarterChip[] = [
  { id: 'summarize', titleKey: 'com_atk_starter_summarize_title', promptKey: 'com_atk_starter_summarize_prompt', icon: FileText },
  { id: 'email',     titleKey: 'com_atk_starter_email_title',     promptKey: 'com_atk_starter_email_prompt',     icon: Mail },
  { id: 'explain',   titleKey: 'com_atk_starter_explain_title',   promptKey: 'com_atk_starter_explain_prompt',   icon: BookOpen },
  { id: 'analyze',   titleKey: 'com_atk_starter_analyze_title',   promptKey: 'com_atk_starter_analyze_prompt',   icon: BarChart3 },
  { id: 'brainstorm', titleKey: 'com_atk_starter_brainstorm_title', promptKey: 'com_atk_starter_brainstorm_prompt', icon: Lightbulb },
  { id: 'review',    titleKey: 'com_atk_starter_review_title',    promptKey: 'com_atk_starter_review_prompt',    icon: PenSquare },
];

/** Conversation Starter chips shown below the empty-state greeting on /c/new.
 *  Click → fills the composer with a starter prompt the user can edit before
 *  sending. Solves blank-canvas paralysis for AI newcomers. */
export default function ConversationStarters() {
  const localize = useLocalize();
  const methods = useChatFormContext();

  const handleClick = (promptKey: string) => {
    const prompt = localize(promptKey);
    methods.setValue('text', prompt, { shouldValidate: true });
    requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('form textarea');
      if (textarea) {
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      }
    });
  };

  return (
    <>
      <div className="mx-auto mt-4 grid w-full max-w-2xl grid-cols-1 gap-2 px-3 sm:grid-cols-2 lg:grid-cols-3">
        {STARTERS.map(({ id, titleKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleClick(STARTERS.find((s) => s.id === id)!.promptKey)}
            className="atk-starter-chip"
          >
            <Icon size={16} className="text-text-secondary" aria-hidden="true" />
            <span className="text-left text-sm text-text-primary">{localize(titleKey)}</span>
          </button>
        ))}
      </div>
      <div className="mx-auto mb-44 mt-3 flex w-full max-w-2xl justify-center px-3">
        <GhostHint
          id="discover-shortcut"
          when={true}
          labelKey="com_atk_hint_discover_shortcut"
        />
      </div>
    </>
  );
}
