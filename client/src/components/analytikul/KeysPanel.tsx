import { useCallback, useEffect, useState } from 'react';
import { useLocalize, useAuthContext } from '~/hooks';
import EndpointsPanel from './EndpointsPanel';

interface KeyRow {
  provider: string;
  key_hint: string;
  created_at: string;
}

type PanelTab = 'keys' | 'endpoints';

const PROVIDERS = ['anthropic', 'openai', 'openrouter', 'google', 'groq', 'mistral'];

/**
 * BYOK key management. Keys are AES-256-GCM encrypted in the vault; after
 * saving, only the provider name and last-4 hint are ever shown again.
 * Agent runs automatically prefer your vaulted key over the server default.
 */
export default function KeysPanel() {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [tab, setTab] = useState<PanelTab>('keys');
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytikul/keys', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      setKeys(((await res.json()) as { keys: KeyRow[] }).keys);
      setError(null);
    } catch {
      setError(localize('com_atk_keys_unavailable'));
    }
  }, [token, localize]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const apiKey = draft.trim();
    if (!apiKey) {
      return;
    }
    await fetch('/api/analytikul/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ provider, apiKey }),
    });
    setDraft('');
    void load();
  };

  const remove = async (keyProvider: string) => {
    await fetch(`/api/analytikul/keys/${encodeURIComponent(keyProvider)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    void load();
  };

  const tabButton = (id: PanelTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={
        'rounded-md px-3 py-1 text-sm ' +
        (tab === id
          ? 'bg-surface-active-alt text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover')
      }
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-2 text-sm">
      <div role="tablist" className="flex gap-1">
        {tabButton('keys', localize('com_atk_keys'))}
        {tabButton('endpoints', localize('com_atk_endpoints'))}
      </div>
      {tab === 'endpoints' ? (
        <EndpointsPanel />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="text-xs text-text-tertiary">{localize('com_atk_keys_blurb')}</div>
          <div className="flex gap-2">
        <select
          value={provider}
          className="rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary"
          aria-label={localize('com_atk_keys_provider')}
          onChange={(event) => setProvider(event.target.value)}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          value={draft}
          type="password"
          placeholder={localize('com_atk_keys_placeholder')}
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
          {localize('com_atk_keys_save')}
        </button>
      </div>

      {error != null && <div className="text-xs text-text-destructive">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {keys != null && keys.length === 0 && (
          <div className="atk-empty-state">
            <strong>{localize('com_atk_keys_title')}</strong>
            <span>{localize('com_atk_keys_empty')}</span>
          </div>
        )}
        {keys?.map((key) => (
          <div
            key={key.provider}
            className="mb-1 flex items-center justify-between rounded-md border border-border-light bg-surface-primary-alt p-2"
          >
            <span className="text-text-primary">
              {key.provider}{' '}
              <span className="font-mono text-xs text-text-tertiary">{key.key_hint}</span>
            </span>
            <button
              type="button"
              className="text-text-tertiary hover:text-text-destructive"
              aria-label={localize('com_atk_keys_delete')}
              onClick={() => void remove(key.provider)}
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
        ))}
          </div>
        </div>
      )}
    </div>
  );
}
