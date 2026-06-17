import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { Trash2, X } from 'lucide-react';
import { useGetConvoIdQuery } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import store from '~/store';
import { cn } from '~/utils';
import { listAnnotations, deleteAnnotation, type Annotation } from './api';

function useConversationTitle(conversationId: string | null): string {
  const { data } = useGetConvoIdQuery(conversationId ?? '', { enabled: !!conversationId });
  return data?.title ?? conversationId ?? '';
}

export default function AnnotationsPanel() {
  const localize = useLocalize();
  const { token, isAuthenticated } = useAuthContext();
  const [panel, setPanel] = useRecoilState(store.annotationsPanel);
  const changedAt = useRecoilValue(store.annotationsChangedAt);
  const bumpChangedAt = useSetRecoilState(store.annotationsChangedAt);
  const setScrollTarget = useSetRecoilState(store.annotationScrollTarget);
  const params = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<Annotation[]>([]);
  const conversationTitle = useConversationTitle(panel.conversationId);

  useEffect(() => {
    if (!panel.open || !panel.conversationId || !isAuthenticated || !token) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const annotations = await listAnnotations(token, panel.conversationId ?? undefined);
        if (!cancelled) {
          setItems(annotations);
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel.open, panel.conversationId, token, isAuthenticated, changedAt]);

  const close = useCallback(() => setPanel({ open: false, conversationId: null }), [setPanel]);

  const goTo = useCallback(
    (a: Annotation) => {
      // Navigate to the conversation if we're not already there.
      if (params.conversationId !== a.conversationId) {
        navigate(`/c/${a.conversationId}`);
      }
      // After messages mount, scroll to the message and pulse the mark.
      setTimeout(() => {
        const el = document.getElementById(a.messageId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setScrollTarget(a._id);
        setTimeout(() => setScrollTarget(null), 2200);
      }, 300);
    },
    [navigate, params.conversationId, setScrollTarget],
  );

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteAnnotation(token, id);
        bumpChangedAt(Date.now());
        setItems((prev) => prev.filter((a) => a._id !== id));
      } catch {
        /* silent */
      }
    },
    [bumpChangedAt, token],
  );

  return (
    <aside
      className="atk-annotations-panel"
      data-open={panel.open ? 'true' : 'false'}
      aria-hidden={!panel.open}
      aria-label={localize('com_atk_annotations_panel_aria', { title: conversationTitle })}
    >
      <div className="atk-annotations-panel-inner">
        <div className="flex items-center justify-between border-b border-border-light px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              {localize('com_atk_sb_annotations')}
            </div>
            <div className="truncate text-sm font-medium text-text-primary">{conversationTitle}</div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            aria-label={localize('com_atk_annotate_close')}
            onClick={close}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-4 text-xs text-text-tertiary">
              {localize('com_atk_sb_annotations_empty')}
            </div>
          ) : (
            <ul className="flex flex-col">
              {items.map((a) => (
                <li
                  key={a._id}
                  className={cn(
                    'group border-b border-border-light px-3 py-2 transition hover:bg-surface-hover',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => goTo(a)}
                    className="w-full text-left"
                  >
                    <div className="text-sm font-medium text-text-primary">
                      <mark className="atk-annotation">{a.highlightedText}</mark>
                    </div>
                    {a.containingParagraph && a.containingParagraph !== a.highlightedText && (
                      <div className="mt-1 line-clamp-2 text-xs text-text-secondary">
                        {a.containingParagraph}
                      </div>
                    )}
                    {a.note && (
                      <div className="mt-1 line-clamp-3 text-xs italic text-text-tertiary">
                        {a.note}
                      </div>
                    )}
                  </button>
                  <div className="mt-1 flex items-center justify-end">
                    <button
                      type="button"
                      className="rounded-md p-1 text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-text-destructive group-hover:opacity-100"
                      aria-label={localize('com_atk_annotate_delete')}
                      onClick={() => onDelete(a._id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
