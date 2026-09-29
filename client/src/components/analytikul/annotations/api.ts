/** Thin fetch helpers for the annotations REST surface — mirrors the Notes
 *  pattern (plain fetch + useAuthContext bearer, no React Query). */

export type Annotation = {
  _id: string;
  user: string;
  conversationId: string;
  messageId: string;
  highlightedText: string;
  containingParagraph: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type AnnotationConversation = {
  conversationId: string;
  count: number;
  lastAt: string;
};

const auth = (token: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

export async function listAnnotations(token: string, conversationId?: string): Promise<Annotation[]> {
  const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
  const res = await fetch(`/api/analytikul/annotations${qs}`, { headers: auth(token) });
  if (!res.ok) {
    throw new Error(`list annotations failed (${res.status})`);
  }
  const body = (await res.json()) as { annotations: Annotation[] };
  return body.annotations;
}

export async function listAnnotationConversations(token: string): Promise<AnnotationConversation[]> {
  const res = await fetch('/api/analytikul/annotations/conversations', { headers: auth(token) });
  if (!res.ok) {
    throw new Error(`list annotation conversations failed (${res.status})`);
  }
  const body = (await res.json()) as { conversations: AnnotationConversation[] };
  return body.conversations;
}

export type CreateAnnotationInput = {
  conversationId: string;
  messageId: string;
  highlightedText: string;
  containingParagraph: string;
  contextBefore: string;
  contextAfter: string;
  note?: string;
};

export async function createAnnotation(token: string, input: CreateAnnotationInput): Promise<Annotation> {
  const res = await fetch('/api/analytikul/annotations', {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(msg?.message ?? `create annotation failed (${res.status})`);
  }
  const body = (await res.json()) as { annotation: Annotation };
  return body.annotation;
}

export async function updateAnnotationNote(token: string, id: string, note: string): Promise<Annotation> {
  const res = await fetch(`/api/analytikul/annotations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: auth(token),
    body: JSON.stringify({ note }),
  });
  if (!res.ok) {
    throw new Error(`update annotation failed (${res.status})`);
  }
  const body = (await res.json()) as { annotation: Annotation };
  return body.annotation;
}

export async function deleteAnnotation(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/analytikul/annotations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: auth(token),
  });
  if (!res.ok) {
    throw new Error(`delete annotation failed (${res.status})`);
  }
}
