import { useEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useAuthContext } from '~/hooks';
import store from '~/store';
import type { AnnotationLite } from '~/store/misc';
import { listAnnotations } from './api';

/** Mounted once per chat. Loads the active conversation's annotations and
 *  populates the `annotationsByMessageId` atom so paragraph renderers can
 *  inject persistent highlights. Re-loads on the changed-at signal. */
export default function AnnotationsLoader({ conversationId }: { conversationId: string }) {
  const { token, isAuthenticated } = useAuthContext();
  const changedAt = useRecoilValue(store.annotationsChangedAt);
  const setByMessage = useSetRecoilState(store.annotationsByMessageId);

  useEffect(() => {
    if (!isAuthenticated || !token || !conversationId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const annotations = await listAnnotations(token, conversationId);
        if (cancelled) {
          return;
        }
        const grouped: Record<string, AnnotationLite[]> = {};
        for (const a of annotations) {
          (grouped[a.messageId] ??= []).push({
            _id: a._id,
            messageId: a.messageId,
            highlightedText: a.highlightedText,
            contextBefore: a.contextBefore,
            contextAfter: a.contextAfter,
            note: a.note,
          });
        }
        setByMessage(grouped);
      } catch {
        /* silent — annotation injection is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, token, isAuthenticated, changedAt, setByMessage]);

  return null;
}
