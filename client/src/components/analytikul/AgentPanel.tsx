import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import TraceViewer from './TraceViewer';
import type { AgentStreamApi } from './useAgentStream';

/** Maps a Hermes provider name to the LibreChat models-map key, where one exists. */
const PROVIDER_MODEL_KEY: Record<string, string> = {
  openai: 'openAI',
  anthropic: 'anthropic',
  google: 'google',
};

/** User-facing Hermes toolsets (the internal hermes-* platform bundles are hidden). */
const TOOLSETS = [
  'web',
  'search',
  'x_search',
  'vision',
  'video',
  'image_gen',
  'video_gen',
  'browser',
  'terminal',
  'file',
  'tts',
  'todo',
  'memory',
  'context_engine',
  'session_search',
  'code_execution',
  'delegation',
  'skills',
  'kanban',
  'cronjob',
  'clarify',
  'moa',
  'discord',
  'messaging',
  'computer_use',
  'homeassistant',
] as const;

/** Off by default — matches the adapter's default disabled set (sensitive/host tools). */
const DEFAULT_OFF = new Set<string>(['messaging', 'computer_use', 'homeassistant']);

const PROVIDERS = ['', 'openrouter', 'openai', 'anthropic', 'google', 'groq', 'mistral'];

/** Agent tab in the Preview Rail: launch tasks, pick tools + model, watch the trace. */
export default function AgentPanel({ stream }: { stream: AgentStreamApi }) {
  const localize = useLocalize();
  const { conversationId } = useParams();
  const [message, setMessage] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(TOOLSETS.filter((t) => !DEFAULT_OFF.has(t))),
  );
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');

  const { data: modelsMap = {} } = useGetModelsQuery();
  const providerModels = useMemo(() => {
    if (!provider) {
      return [];
    }
    return modelsMap[PROVIDER_MODEL_KEY[provider] ?? provider] ?? [];
  }, [modelsMap, provider]);

  const busy = stream.state === 'starting' || stream.state === 'running';

  const disabledToolsets = useMemo(
    () => TOOLSETS.filter((t) => !enabled.has(t)),
    [enabled],
  );

  const toggle = (name: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || busy) {
      return;
    }
    void stream.run(trimmed, conversationId ?? 'standalone', {
      disabledToolsets,
      model: model.trim() || undefined,
      provider: provider || undefined,
    });
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={message}
        rows={3}
        placeholder={localize('com_atk_agent_placeholder')}
        className="w-full resize-none rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />

      <div className="rounded-md border border-border-light">
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-medium text-text-secondary"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((prev) => !prev)}
        >
          <span>
            {localize('com_atk_agent_options')} · {enabled.size}/{TOOLSETS.length}
          </span>
          <ChevronDown
            size={14}
            className={cn('transition-transform', showOptions ? '' : '-rotate-90')}
            aria-hidden="true"
          />
        </button>
        {showOptions && (
          <div className="border-t border-border-light px-2.5 py-2">
            <div className="mb-1 flex items-center gap-2">
              <select
                aria-label={localize('com_atk_agent_provider')}
                className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel('');
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p === '' ? localize('com_atk_agent_provider_default') : p}
                  </option>
                ))}
              </select>
              {providerModels.length > 0 ? (
                <select
                  aria-label={localize('com_atk_agent_model')}
                  className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">{localize('com_atk_agent_model_default')}</option>
                  {providerModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={localize('com_atk_agent_model')}
                  placeholder={localize('com_atk_agent_model_ph')}
                  className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary placeholder-text-secondary focus:outline-none"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
            </div>
            <p className="mb-2 text-[11px] leading-snug text-text-tertiary">
              {localize('com_atk_agent_model_hint')}
            </p>

            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">
                {localize('com_atk_agent_tools')}
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-text-secondary hover:text-text-primary"
                  onClick={() => setEnabled(new Set(TOOLSETS))}
                >
                  {localize('com_atk_agent_all')}
                </button>
                <button
                  type="button"
                  className="text-text-secondary hover:text-text-primary"
                  onClick={() => setEnabled(new Set())}
                >
                  {localize('com_atk_agent_none')}
                </button>
              </div>
            </div>
            <div className="grid max-h-44 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto">
              {TOOLSETS.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-xs text-text-primary">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border-medium"
                    checked={enabled.has(name)}
                    onChange={() => toggle(name)}
                  />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-surface-submit px-3 py-1 text-sm text-white hover:bg-surface-submit-hover disabled:opacity-50"
          onClick={submit}
          disabled={busy || message.trim() === ''}
        >
          {busy ? localize('com_atk_running') : localize('com_atk_run_agent')}
        </button>
        {busy && (
          <button
            type="button"
            className="rounded-md bg-surface-destructive px-3 py-1 text-sm text-white hover:bg-surface-destructive-hover"
            onClick={() => void stream.cancel()}
          >
            {localize('com_atk_cancel')}
          </button>
        )}
        {stream.state !== 'idle' && !busy && (
          <button
            type="button"
            className="rounded-md border border-border-medium px-3 py-1 text-sm text-text-secondary hover:bg-surface-hover"
            onClick={stream.reset}
          >
            {localize('com_atk_clear')}
          </button>
        )}
      </div>

      {stream.errorMessage != null && (
        <div className="rounded-md border border-border-destructive px-2 py-1 text-xs text-text-destructive">
          {stream.errorMessage}
        </div>
      )}

      {(stream.responseText || stream.finalResponse) && (
        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-light bg-surface-primary p-2 text-sm text-text-primary">
          {stream.finalResponse ?? stream.responseText}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TraceViewer
          events={stream.events}
          totalCostUsd={stream.totalCostUsd}
          totalTokens={stream.totalTokens}
        />
      </div>
    </div>
  );
}
