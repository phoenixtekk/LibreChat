import { atom, selectorFamily } from 'recoil';
import { TAttachment } from 'librechat-data-provider';
import { atomWithLocalStorage } from './utils';
import { BadgeItem } from '~/common';

const hideBannerHint = atomWithLocalStorage('hideBannerHint', [] as string[]);

const messageAttachmentsMap = atom<Record<string, TAttachment[] | undefined>>({
  key: 'messageAttachmentsMap',
  default: {},
});

/**
 * Selector to get attachments for a specific conversation.
 */
const conversationAttachmentsSelector = selectorFamily<
  Record<string, TAttachment[]>,
  string | undefined
>({
  key: 'conversationAttachments',
  get:
    (conversationId) =>
    ({ get }) => {
      if (!conversationId) {
        return {};
      }

      const attachmentsMap = get(messageAttachmentsMap);
      const result: Record<string, TAttachment[]> = {};

      // Filter to only include attachments for this conversation
      Object.entries(attachmentsMap).forEach(([messageId, attachments]) => {
        if (!attachments || attachments.length === 0) {
          return;
        }

        const relevantAttachments = attachments.filter(
          (attachment) => attachment.conversationId === conversationId,
        );

        if (relevantAttachments.length > 0) {
          result[messageId] = relevantAttachments;
        }
      });

      return result;
    },
});

const queriesEnabled = atom<boolean>({
  key: 'queriesEnabled',
  default: true,
});

const isEditingBadges = atom<boolean>({
  key: 'isEditingBadges',
  default: false,
});

const chatBadges = atomWithLocalStorage<Pick<BadgeItem, 'id'>[]>('chatBadges', [
  // When adding new badges, make sure to add them to useChatBadges.ts as well and add them as last item
  // DO NOT CHANGE THE ORDER OF THE BADGES ALREADY IN THE ARRAY
  { id: '1' },
  // { id: '2' },
]);

/** Analytikul Preview Rail open/tab state, lifted so the sidebar can open a tab. */
export type PreviewRailTab = 'agent' | 'preview' | 'costs' | 'memory' | 'keys' | 'files';

const previewRail = atom<{ open: boolean; tab: PreviewRailTab }>({
  key: 'analytikulPreviewRail',
  default: { open: false, tab: 'agent' },
});

/** Annotations panel — the second column that slides out from the left sidebar.
 *  `conversationId` = which conversation's annotations to show. */
const annotationsPanel = atom<{ open: boolean; conversationId: string | null }>({
  key: 'analytikulAnnotationsPanel',
  default: { open: false, conversationId: null },
});

/** Bumped after every create/update/delete so the sidebar tree + panel re-fetch
 *  (the Analytikul data layer is plain fetch + useEffect, not React Query). */
const annotationsChangedAt = atom<number>({
  key: 'analytikulAnnotationsChangedAt',
  default: 0,
});

/** Recently scrolled-to annotation id — used to pulse the matching <mark>
 *  briefly after navigation; reset by the chat view after the animation. */
const annotationScrollTarget = atom<string | null>({
  key: 'analytikulAnnotationScrollTarget',
  default: null,
});

/** Annotations for the active conversation, indexed by messageId, populated by
 *  the AnnotationsLoader (mounted in ChatView) and read by the paragraph
 *  renderer to inject persistent <mark> spans. */
export type AnnotationLite = {
  _id: string;
  messageId: string;
  highlightedText: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
};
const annotationsByMessageId = atom<Record<string, AnnotationLite[]>>({
  key: 'analytikulAnnotationsByMessageId',
  default: {},
});

export default {
  hideBannerHint,
  messageAttachmentsMap,
  conversationAttachmentsSelector,
  queriesEnabled,
  isEditingBadges,
  chatBadges,
  previewRail,
  annotationsPanel,
  annotationsChangedAt,
  annotationScrollTarget,
  annotationsByMessageId,
};
