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
 * encrypted at rest — after saving it is never shown again. Leaving the models
 * field blank auto-detects them from the endpoint at creation.
 */
export default function EndpointsPanel() {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [endpoints, setEndpoints] = useState<EndpointRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setBaseURL('');
    setApiKey('');
    setModels('');
  };

  const beginEdit = (endpoint: EndpointRow) => {
    setEditingId(endpoint.id);
    setName(endpoint.name);
    setBaseURL(endpoint.baseURL);
    setApiKey('');
    setModels(endpoint.models.join(', '));
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedURL = baseURL.trim();
    const trimmedKey = apiKey.trim();
    // A key is required to create, but optional when editing (blank = keep current).
    if (!trimmedName || !trimmedURL || (!editingId && !trimmedKey)) {
      return;
    }
    const modelsList = models
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const editing = editingId != null;
      const payload: Record<string, unknown> = {
        name: trimmedName,
        baseURL: trimmedURL,
        models: modelsList,
      };
      if (trimmedKey) {
        payload.apiKey = trimmedKey;
      }
      const res = await fetch(
        editing
          ? `/api/analytikul/endpoints/${encodeURIComponent(editingId)}`
          : '/api/analytikul/endpoints',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? localize('com_atk_endpoints_save_failed'));
        return;
      }
      // On create with auto-detect, warn if nothing came back.
      if (!editing && modelsList.length === 0) {
        const body = (await res.json().catch(() => ({}))) as { endpoint?: EndpointRow };
        if ((body.endpoint?.models?.length ?? 0) === 0) {
          setNotice(localize('com_atk_endpoints_no_models'));
        }
      }
      resetForm();
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
    if (editingId === id) {
      resetForm();
    }
    void load();
  };

  const editing = editingId != null;
  const canSave =
    name.trim() !== '' && baseURL.trim() !== '' && (editing || apiKey.trim() !== '') && !saving;

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
          placeholder={
            editing
              ? localize('com_atk_endpoints_key_keep')
              : localize('com_atk_endpoints_key_placeholder')
          }
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
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-md bg-surface-submit px-3 py-1 text-sm text-white hover:bg-surface-submit-hover disabled:opacity-50"
            onClick={() => void save()}
            disabled={!canSave}
          >
            {editing
              ? localize('com_atk_endpoints_save_changes')
              : localize('com_atk_endpoints_add')}
          </button>
          {editing && (
            <button
              type="button"
              className="rounded-md border border-border-medium px-3 py-1 text-sm text-text-secondary hover:bg-surface-hover"
              onClick={resetForm}
            >
              {localize('com_atk_endpoints_cancel')}
            </button>
          )}
        </div>
      </div>

      {error != null && <div className="text-xs text-text-destructive">{error}</div>}
      {notice != null && <div className="text-xs text-text-warning">{notice}</div>}

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
            className={
              'mb-1 flex items-center justify-between rounded-md border bg-surface-primary-alt p-2 ' +
              (editingId === endpoint.id ? 'border-border-heavy' : 'border-border-light')
            }
          >
            <span className="min-w-0 flex-1 truncate text-text-primary">
              {endpoint.name}{' '}
              <span className="font-mono text-xs text-text-tertiary">{endpoint.baseURL}</span>
              {endpoint.models.length > 0 && (
                <span className="text-xs text-text-tertiary"> · {endpoint.models.length}</span>
              )}
            </span>
            <button
              type="button"
              className="ml-2 text-text-tertiary hover:text-text-primary"
              aria-label={localize('com_atk_endpoints_edit')}
              onClick={() => beginEdit(endpoint)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M11 2l3 3-7 7-3 1 1-3 7-7z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  fill="none"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
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
