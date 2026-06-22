import { useCallback, useEffect, useState } from 'react';
import { useLocalize, useAuthContext } from '~/hooks';

interface EndpointRow {
  id: string;
  name: string;
  baseURL: string;
  models: string[];
}

/**
 * BYOK custom endpoints. Each user registers their own OpenAI-compatible
 * endpoints, which appear only in their own model picker. The base URL is
 * validated server-side (SSRF guard) before it is stored, and the API key is
 * encrypted at rest — after saving it is never shown again.
 */
export default function EndpointsPanel() {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [endpoints, setEndpoints] = useState<EndpointRow[] | null>(null);
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytikul/endpoints', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      setEndpoints(((await res.json()) as { endpoints: EndpointRow[] }).endpoints);
      setError(null);
    } catch {
      setError(localize('com_atk_endpoints_unavailable'));
    }
  }, [token, localize]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedURL = baseURL.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedName || !trimmedURL || !trimmedKey) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/analytikul/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: trimmedName,
          baseURL: trimmedURL,
          apiKey: trimmedKey,
          models: models
            .split(',')
            .map((model) => model.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? localize('com_atk_endpoints_save_failed'));
        return;
      }
      setName('');
      setBaseURL('');
      setApiKey('');
      setModels('');
      void load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/analytikul/endpoints/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    void load();
  };

  const canSave = name.trim() !== '' && baseURL.trim() !== '' && apiKey.trim() !== '' && !saving;

  return (
    <div className="flex h-full flex-col gap-2 text-sm">
      <div className="text-xs text-text-tertiary">{localize('com_atk_endpoints_blurb')}</div>
      <div className="flex flex-col gap-2">
        <input
          value={name}
          placeholder={localize('com_atk_endpoints_name')}
          aria-label={localize('com_atk_endpoints_name')}
          className="rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          value={baseURL}
          placeholder={localize('com_atk_endpoints_url')}
          aria-label={localize('com_atk_endpoints_url')}
          className="rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
          onChange={(event) => setBaseURL(event.target.value)}
        />
        <input
          value={apiKey}
          type="password"
          placeholder={localize('com_atk_endpoints_key_placeholder')}
          aria-label={localize('com_atk_endpoints_key_placeholder')}
          className="rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          value={models}
          placeholder={localize('com_atk_endpoints_models_placeholder')}
          aria-label={localize('com_atk_endpoints_models_placeholder')}
          className="rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
          onChange={(event) => setModels(event.target.value)}
        />
        <button
          type="button"
          className="rounded-md bg-surface-submit px-3 py-1 text-sm text-white hover:bg-surface-submit-hover disabled:opacity-50"
          onClick={() => void save()}
          disabled={!canSave}
        >
          {localize('com_atk_endpoints_add')}
        </button>
      </div>

      {error != null && <div className="text-xs text-text-destructive">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {endpoints != null && endpoints.length === 0 && (
          <div className="atk-empty-state">
            <strong>{localize('com_atk_endpoints_title')}</strong>
            <span>{localize('com_atk_endpoints_empty')}</span>
          </div>
        )}
        {endpoints?.map((endpoint) => (
          <div
            key={endpoint.id}
            className="mb-1 flex items-center justify-between rounded-md border border-border-light bg-surface-primary-alt p-2"
          >
            <span className="min-w-0 flex-1 truncate text-text-primary">
              {endpoint.name}{' '}
              <span className="font-mono text-xs text-text-tertiary">{endpoint.baseURL}</span>
              {endpoint.models.length > 0 && (
                <span className="text-xs text-text-tertiary">
                  {' '}
                  · {endpoint.models.length}
                </span>
              )}
            </span>
            <button
              type="button"
              className="ml-2 text-text-tertiary hover:text-text-destructive"
              aria-label={localize('com_atk_endpoints_delete')}
              onClick={() => void remove(endpoint.id)}
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
  );
}
