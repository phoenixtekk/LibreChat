import { useCallback, useEffect, useState } from 'react';
import { useLocalize, useAuthContext } from '~/hooks';

interface MemoryRow {
  id: string;
  content: string;
  source_user_id: string;
  source_conversation_id: string | null;
  tags: string[];
  created_at: string;
}

/**
 * Shared organizational memory: facts saved by any teammate (or their agent)
 * that every agent in the org can recall. Each entry carries lineage — who
 * saved it and from which conversation.
 */
export default function OrgMemoryPanel() {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytikul/memory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      const body = (await res.json()) as { memories: MemoryRow[] };
      setMemories(body.memories);
      setError(null);
    } catch {
      setError(localize('com_atk_memory_unavailable'));
    }
  }, [token, localize]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const content = draft.trim();
    if (!content) {
      return;
    }
    await fetch('/api/analytikul/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content }),
    });
    setDraft('');
    void load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/analytikul/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    void load();
  };

  return (
    <div className="flex h-full flex-col gap-2 text-sm">
      <div className="flex gap-2">
        <input
          value={draft}
          placeholder={localize('com_atk_memory_placeholder')}
          className="flex-1 rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void save();
            }
          }}
        />
        <button
          type="button"
          className="rounded-md bg-surface-submit px-3 py-1 text-sm text-white hover:bg-surface-submit-hover disabled:opacity-50"
          onClick={() => void save()}
          disabled={draft.trim() === ''}
        >
          {localize('com_atk_memory_save')}
        </button>
      </div>

      {error != null && <div className="text-xs text-text-destructive">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {memories == null && <div className="atk-empty-state">{localize('com_atk_loading')}</div>}
        {memories != null && memories.length === 0 && (
          <div className="atk-empty-state">
            <strong>{localize('com_atk_memory_title')}</strong>
            <span>{localize('com_atk_memory_empty')}</span>
          </div>
        )}
        {memories?.map((memory) => (
          <div
            key={memory.id}
            className="mb-1 rounded-md border border-border-light bg-surface-primary-alt p-2"
          >
            <div className="text-text-primary">{memory.content}</div>
            <div className="mt-1 flex items-center justify-between text-xs text-text-tertiary">
              <span>
                {memory.source_user_id} · {new Date(memory.created_at).toLocaleDateString()}
                {memory.tags.length > 0 && ` · ${memory.tags.join(', ')}`}
              </span>
              <button
                type="button"
                className="text-text-tertiary hover:text-text-destructive"
                aria-label={localize('com_atk_memory_delete')}
                onClick={() => void remove(memory.id)}
              >
                <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true">
                  <path
                    d="M2 2l10 10M12 2L2 12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
