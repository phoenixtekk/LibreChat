import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, Zap, Lock } from 'lucide-react';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useLocalize, useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import TraceViewer from './TraceViewer';
import type { ReactNode } from 'react';
import type { AgentStreamApi } from './useAgentStream';

/** Maps a Hermes provider name to the LibreChat models-map key, where one exists. */
const PROVIDER_MODEL_KEY: Record<string, string> = {
  openai: 'openAI',
  anthropic: 'anthropic',
  google: 'google',
};

/**
 * Tidy streamed agent text for display: drop lines that are only stray dots
 * (a lone "." the model emits between thoughts) and collapse runs of blank
 * lines. Markdown then handles paragraph spacing and fenced code blocks.
 */
function normalizeAgentText(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^[.·…]+$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Markdown renderer for agent output — renders ```fenced``` commands/code in a
 * shaded box so they stand out from the surrounding narration, and keeps links
 * safe (new tab + noopener).
 */
const AGENT_MD = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border-light bg-surface-secondary p-2.5 font-mono text-[12px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-surface-secondary px-1 py-0.5 font-mono text-[12px]">{children}</code>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-2 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-2 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
  h1: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold text-text-primary">{children}</h3>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold text-text-primary">{children}</h3>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h4 className="mb-1 mt-2 text-[13px] font-semibold text-text-primary">{children}</h4>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
      {children}
    </a>
  ),
};

/**
 * Hermes toolsets surfaced for selection. code_execution + file are sandbox-gated
 * by gVisor and allowed server-side; planning bundles notes + org-memory tools.
 */
const TOOLSETS = [
  'web',
  'search',
  'x_search',
  'vision',
  'video',
  'image_gen',
  'video_gen',
  'browser',
  'tts',
  'todo',
  'memory',
  'planning',
  'context_engine',
  'session_search',
  'delegation',
  'skills',
  'kanban',
  'cronjob',
  'clarify',
  'moa',
  'discord',
  'code_execution',
  'file',
  'terminal',
] as const;

/**
 * Plan-gated action tools — available at Team+ (BYO-credential). Below Team they
 * show as an upgrade prompt; the server strips them regardless of the UI.
 */
const PLAN_GATED = ['messaging', 'homeassistant'] as const;

/**
 * Hard-floored — run host commands / drive a live desktop. Off for everyone
 * until per-task sandbox/VM isolation ships; shown for transparency only.
 */
const HARD_GATED = ['computer_use'] as const;

/** Claude-Code-style permission modes (server enforces; default Plan). */
const PERMISSION_MODES: { value: string; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'manual', label: 'Manual' },
  { value: 'accept_edits', label: 'Accept edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'bypass', label: 'Bypass' },
];

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, team: 2, business: 3, enterprise: 4 };

/** Off by default. */
const DEFAULT_OFF = new Set<string>([]);

const PROVIDERS = [
  '',
  'openrouter',
  'openai',
  'anthropic',
  'google',
  'groq',
  'mistral',
  // Self-hosted / local (OpenAI-compatible). Hermes maps these to a local endpoint;
  // pair with a Base URL below. Powered by your own LLM — no cloud key required.
  'vllm',
  'ollama',
  'lmstudio',
];

/** Providers that talk to a self-hosted endpoint and need an explicit Base URL. */
const LOCAL_PROVIDERS = new Set(['vllm', 'ollama', 'lmstudio']);

/** Sensible default Base URL per local provider (user can override). */
const LOCAL_BASE_URL_HINT: Record<string, string> = {
  vllm: 'http://host:8001/v1',
  ollama: 'http://host:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};

/** Agent tab in the Preview Rail: launch tasks, pick tools + model, watch the trace. */
export default function AgentPanel({ stream }: { stream: AgentStreamApi }) {
  const localize = useLocalize();
  const { conversationId } = useParams();
  const { token } = useAuthContext();
  const [message, setMessage] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [plan, setPlan] = useState('free');
  const [powerTools, setPowerTools] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(TOOLSETS.filter((t) => !DEFAULT_OFF.has(t))),
  );
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlHistory, setBaseUrlHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('atk_baseurl_history');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [workspace, setWorkspace] = useState('default');
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [wsConfigured, setWsConfigured] = useState(false);
  const [newProject, setNewProject] = useState('');
  const [permMode, setPermMode] = useState('plan');
  const outputRef = useRef<HTMLDivElement>(null);

  // Follow the stream: keep the newest agent output in view as it writes out.
  useEffect(() => {
    const el = outputRef.current;
    if (el != null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [stream.responseText, stream.finalResponse]);

  // Action tools (messaging/homeassistant) unlock at Team+, or via the Agent Power
  // Tools add-on on a Pro+ base.
  const rank = TIER_RANK[plan] ?? 0;
  const unlocked = rank >= TIER_RANK.team || (powerTools && rank >= TIER_RANK.pro);
  useEffect(() => {
    let active = true;
    fetch('/api/analytikul/plan', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { plan: 'free', powerTools: false }))
      .then((d: { plan?: string; powerTools?: boolean }) => {
        if (active) {
          setPlan(d.plan ?? 'free');
          setPowerTools(Boolean(d.powerTools));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);

  // Toolsets the user can actually toggle (safe + sandboxed + plan-gated when entitled).
  const selectable = useMemo(
    () => (unlocked ? [...TOOLSETS, ...PLAN_GATED] : [...TOOLSETS]),
    [unlocked],
  );
  // Once unlocked, enable the newly-available plan-gated tools by default.
  useEffect(() => {
    if (unlocked) {
      setEnabled((prev) => {
        const next = new Set(prev);
        PLAN_GATED.forEach((t) => next.add(t));
        return next;
      });
    }
  }, [unlocked]);

  const { data: modelsMap = {} } = useGetModelsQuery();
  const providerModels = useMemo(() => {
    if (!provider) {
      return [];
    }
    return modelsMap[PROVIDER_MODEL_KEY[provider] ?? provider] ?? [];
  }, [modelsMap, provider]);

  // Local providers have no LibreChat models map. Fetch the served model list from
  // the endpoint's OpenAI-compatible /models (via the backend — the browser can't
  // reach a LAN endpoint cross-origin) and offer it as a dropdown. Debounced on the
  // Base URL so it refreshes as you type/paste the endpoint.
  const isLocalProvider = LOCAL_PROVIDERS.has(provider);
  useEffect(() => {
    if (!isLocalProvider || !baseUrl.trim()) {
      setLocalModels([]);
      return;
    }
    let active = true;
    setModelsLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/analytikul/agent/models?baseUrl=${encodeURIComponent(baseUrl.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : { models: [] }))
        .then((d: { models?: string[] }) => {
          if (!active) {
            return;
          }
          const list = Array.isArray(d.models) ? d.models : [];
          setLocalModels(list);
          // Auto-select the served model when none is chosen (or the current one
          // isn't offered by this endpoint).
          setModel((cur) => (list.length > 0 && !list.includes(cur) ? list[0] : cur));
        })
        .catch(() => {
          if (active) {
            setLocalModels([]);
          }
        })
        .finally(() => {
          if (active) {
            setModelsLoading(false);
          }
        });
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isLocalProvider, baseUrl, token]);

  // Analytikul Coder: load the project folders the agent can work in, + create new ones.
  const loadWorkspaces = useCallback(() => {
    fetch('/api/analytikul/agent/workspaces', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { configured: false, projects: [] }))
      .then((d: { configured?: boolean; projects?: string[] }) => {
        setWsConfigured(Boolean(d.configured));
        const list = Array.isArray(d.projects) ? d.projects : [];
        setWorkspaces(list);
        setWorkspace((cur) => (list.includes(cur) ? cur : list[0] ?? 'default'));
      })
      .catch(() => undefined);
  }, [token]);
  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);
  const createProject = () => {
    const name = newProject.trim();
    if (!name) {
      return;
    }
    fetch('/api/analytikul/agent/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('create failed'))))
      .then(() => {
        setNewProject('');
        setWorkspace(name);
        loadWorkspaces();
      })
      .catch(() => undefined);
  };

  const busy = stream.state === 'starting' || stream.state === 'running';

  const disabledToolsets = useMemo(
    () => selectable.filter((t) => !enabled.has(t)),
    [selectable, enabled],
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

  const rememberBaseUrl = (url: string) => {
    const v = url.trim();
    if (!v) {
      return;
    }
    setBaseUrlHistory((prev) => {
      const next = [v, ...prev.filter((u) => u !== v)].slice(0, 12);
      try {
        localStorage.setItem('atk_baseurl_history', JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory only */
      }
      return next;
    });
  };

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || busy) {
      return;
    }
    if (LOCAL_PROVIDERS.has(provider) && baseUrl.trim()) {
      rememberBaseUrl(baseUrl);
    }
    void stream.run(trimmed, conversationId ?? 'standalone', {
      disabledToolsets,
      model: model.trim() || undefined,
      provider: provider || undefined,
      baseUrl: LOCAL_PROVIDERS.has(provider) ? baseUrl.trim() || undefined : undefined,
      workspace: wsConfigured ? workspace : undefined,
      permissionMode: permMode,
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Hermes agent console header */}
      <div className="flex items-center gap-2.5">
        <div
          className="atk-hermes-pill"
          title={localize('com_atk_hermes_pill_tooltip')}
          aria-label={localize('com_atk_hermes_pill_tooltip')}
        >
          <Zap size={11} aria-hidden="true" />
          <span>{localize('com_atk_hermes_pill')}</span>
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-semibold text-text-primary">
            {localize('com_atk_agent_title')}
          </span>
          <span className="truncate text-[11px] text-text-tertiary">
            {localize('com_atk_agent_subtitle')}
          </span>
        </div>
      </div>

      <textarea
        value={message}
        rows={3}
        placeholder={localize('com_atk_agent_placeholder')}
        className="w-full resize-none rounded-lg border border-border-medium bg-surface-primary p-2.5 text-sm text-text-primary outline-none transition focus:border-border-heavy"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />

      <div className="rounded-lg border border-border-light">
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-medium text-text-secondary"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((prev) => !prev)}
        >
          <span>
            {localize('com_atk_agent_options')} · {enabled.size}/{selectable.length}
          </span>
          <ChevronDown
            size={14}
            className={cn('transition-transform', showOptions ? '' : '-rotate-90')}
            aria-hidden="true"
          />
        </button>
        {showOptions && (
          <div className="border-t border-border-light px-2.5 py-2.5">
            {wsConfigured && (
              <div className="mb-2.5">
                <label className="mb-1 block text-[11px] font-medium text-text-secondary">
                  Project workspace
                </label>
                <select
                  aria-label="Project workspace"
                  className="mb-1 w-full rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                >
                  {workspaces.length === 0 && <option value="default">default</option>}
                  {workspaces.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="New project name"
                    placeholder="new project name…"
                    className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary placeholder-text-secondary focus:outline-none"
                    value={newProject}
                    onChange={(e) => setNewProject(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        createProject();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="rounded-md border border-border-medium px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary"
                    onClick={createProject}
                  >
                    + New
                  </button>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-text-tertiary">
                  Agent works in this folder under your Analytikul_Coder workspace.
                </p>
              </div>
            )}
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
              {(isLocalProvider ? localModels.length > 0 : providerModels.length > 0) ? (
                <select
                  aria-label={localize('com_atk_agent_model')}
                  className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {!isLocalProvider && (
                    <option value="">{localize('com_atk_agent_model_default')}</option>
                  )}
                  {(isLocalProvider ? localModels : providerModels).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={localize('com_atk_agent_model')}
                  placeholder={
                    isLocalProvider
                      ? modelsLoading
                        ? 'Loading models…'
                        : 'Enter Base URL to load models, or type a model id'
                      : localize('com_atk_agent_model_ph')
                  }
                  className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary placeholder-text-secondary focus:outline-none"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
            </div>
            {LOCAL_PROVIDERS.has(provider) && (
              <>
                <input
                  aria-label="Local model base URL"
                  list="atk-baseurl-history"
                  placeholder={`Base URL — ${LOCAL_BASE_URL_HINT[provider] ?? 'http://host:port/v1'}`}
                  className="mb-1 w-full rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary placeholder-text-secondary focus:outline-none"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <datalist id="atk-baseurl-history">
                  {baseUrlHistory.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </>
            )}
            <p className="mb-2.5 text-[11px] leading-snug text-text-tertiary">
              {LOCAL_PROVIDERS.has(provider)
                ? 'Self-hosted model — enter its OpenAI-compatible Base URL and the exact model id. No cloud key is used.'
                : localize('com_atk_agent_model_hint')}
            </p>

            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">
                {localize('com_atk_agent_tools')}
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-text-secondary hover:text-text-primary"
                  onClick={() => setEnabled(new Set(selectable))}
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

            {/* Toolset chips */}
            <div className="flex flex-wrap gap-1.5">
              {selectable.map((name) => {
                const on = enabled.has(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(name)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] transition',
                      on
                        ? 'border-transparent bg-surface-submit text-white'
                        : 'border-border-medium text-text-secondary hover:border-border-heavy hover:text-text-primary',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            {/* Team-gated action tools (shown below Team as an upgrade prompt) */}
            {!unlocked && (
              <div className="mt-3">
                <span className="text-[11px] font-medium text-text-tertiary">
                  {localize('com_atk_agent_upgrade')}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {PLAN_GATED.map((name) => (
                    <span
                      key={name}
                      title={localize('com_atk_agent_upgrade_hint')}
                      className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-dashed border-border-light px-2.5 py-1 text-[11px] text-text-tertiary opacity-70"
                    >
                      <Lock size={10} aria-hidden="true" />
                      {name}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] leading-snug text-text-tertiary">
                  {localize('com_atk_agent_upgrade_hint')}
                </p>
              </div>
            )}

            {/* Hard-floored host tools (surfaced for transparency, not selectable) */}
            <div className="mt-3">
              <span className="text-[11px] font-medium text-text-tertiary">
                {localize('com_atk_agent_advanced')}
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {HARD_GATED.map((name) => (
                  <span
                    key={name}
                    title={localize('com_atk_agent_advanced_hint')}
                    className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-dashed border-border-light px-2.5 py-1 text-[11px] text-text-tertiary opacity-70"
                  >
                    <Lock size={10} aria-hidden="true" />
                    {name}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-text-tertiary">
                {localize('com_atk_agent_advanced_hint')}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          aria-label="Permission mode"
          title="Plan: read-only · Manual: approve each edit · Accept edits: auto-approve in workspace · Auto/Bypass: autonomous"
          className="rounded-md border border-border-medium bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
          value={permMode}
          onChange={(e) => setPermMode(e.target.value)}
          disabled={busy}
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
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
        <div
          ref={outputRef}
          className="max-h-64 overflow-y-auto rounded-md border border-border-light bg-surface-primary p-2.5 text-sm text-text-primary"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={AGENT_MD}>
            {normalizeAgentText(stream.finalResponse ?? stream.responseText)}
          </ReactMarkdown>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TraceViewer
          events={stream.events}
          totalCostUsd={stream.totalCostUsd}
          totalTokens={stream.totalTokens}
        />
      </div>

      {stream.pendingApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border border-border-medium bg-surface-primary p-4 shadow-xl">
            <div className="mb-2 text-sm font-semibold text-text-primary">
              Approve {stream.pendingApproval.kind === 'edit' ? 'file edit' : stream.pendingApproval.kind}
              {stream.pendingApproval.tool ? ` · ${stream.pendingApproval.tool}` : ''}
            </div>
            {stream.pendingApproval.path && (
              <div className="mb-2 break-all font-mono text-xs text-text-secondary">
                {stream.pendingApproval.path}
              </div>
            )}
            {stream.pendingApproval.command && (
              <pre className="mb-2 overflow-auto rounded bg-surface-secondary p-2 text-xs text-text-primary">
                {stream.pendingApproval.command}
              </pre>
            )}
            {stream.pendingApproval.new_text != null && (
              <pre className="mb-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-secondary p-2 text-[11px] text-text-primary">
                {stream.pendingApproval.new_text}
              </pre>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-border-medium px-3 py-1 text-sm text-text-secondary hover:bg-surface-hover"
                onClick={() => void stream.respond(stream.pendingApproval!.request_id, 'deny')}
              >
                Deny
              </button>
              <button
                type="button"
                className="rounded-md border border-border-medium px-3 py-1 text-sm text-text-secondary hover:bg-surface-hover"
                onClick={() => void stream.respond(stream.pendingApproval!.request_id, 'always')}
              >
                Always
              </button>
              <button
                type="button"
                className="rounded-md bg-surface-submit px-3 py-1 text-sm text-white hover:bg-surface-submit-hover"
                onClick={() => void stream.respond(stream.pendingApproval!.request_id, 'allow')}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
