import { memo, useState, useCallback } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { TConversation } from 'librechat-data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ParamType = 'number' | 'text' | 'switch' | 'select';

type ParamDef = {
  key: string;
  label: string;
  type: ParamType;
  options?: string[];
  placeholder?: string;
  note?: string;
};

/**
 * Open WebUI-faithful Advanced Params list. Mirrors the full OWUI Controls
 * panel: each row shows "Default" until overridden. Values are stored on the
 * conversation; how many actually affect output depends on the active
 * endpoint (the Ollama-prefixed rows apply when the model is served by Ollama,
 * e.g. the local llama3 on linuxg3).
 */
const ADVANCED_PARAMS: ParamDef[] = [
  { key: 'stream', label: 'Stream Chat Response', type: 'switch' },
  { key: 'stream_delta_chunk_size', label: 'Stream Delta Chunk Size', type: 'number' },
  { key: 'function_calling', label: 'Function Calling', type: 'switch' },
  { key: 'reasoning_tags', label: 'Reasoning Tags', type: 'switch' },
  { key: 'seed', label: 'Seed', type: 'number' },
  { key: 'stop', label: 'Stop Sequence', type: 'text', placeholder: 'comma,separated' },
  { key: 'temperature', label: 'Temperature', type: 'number', placeholder: '0.0 – 2.0' },
  {
    key: 'reasoning_effort',
    label: 'Reasoning Effort',
    type: 'select',
    options: ['low', 'medium', 'high'],
  },
  { key: 'logit_bias', label: 'logit_bias', type: 'text' },
  { key: 'max_tokens', label: 'max_tokens', type: 'number' },
  { key: 'top_k', label: 'top_k', type: 'number' },
  { key: 'top_p', label: 'top_p', type: 'number', placeholder: '0.0 – 1.0' },
  { key: 'min_p', label: 'min_p', type: 'number' },
  { key: 'frequency_penalty', label: 'frequency_penalty', type: 'number' },
  { key: 'presence_penalty', label: 'presence_penalty', type: 'number' },
  { key: 'mirostat', label: 'mirostat', type: 'number' },
  { key: 'mirostat_eta', label: 'mirostat_eta', type: 'number' },
  { key: 'mirostat_tau', label: 'mirostat_tau', type: 'number' },
  { key: 'repeat_last_n', label: 'repeat_last_n', type: 'number' },
  { key: 'tfs_z', label: 'tfs_z', type: 'number' },
  { key: 'repeat_penalty', label: 'repeat_penalty', type: 'number' },
  { key: 'use_mmap', label: 'use_mmap', type: 'switch' },
  { key: 'use_mlock', label: 'use_mlock', type: 'switch' },
  { key: 'think', label: 'think (Ollama)', type: 'switch' },
  { key: 'format', label: 'format (Ollama)', type: 'select', options: ['', 'json'] },
  { key: 'num_keep', label: 'num_keep (Ollama)', type: 'number' },
  { key: 'num_ctx', label: 'num_ctx (Ollama)', type: 'number' },
  { key: 'num_batch', label: 'num_batch (Ollama)', type: 'number' },
  { key: 'num_thread', label: 'num_thread (Ollama)', type: 'number' },
  { key: 'num_gpu', label: 'num_gpu (Ollama)', type: 'number' },
  { key: 'keep_alive', label: 'keep_alive (Ollama)', type: 'text', placeholder: 'e.g. 5m' },
];

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-light">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-text-primary"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={cn('text-text-secondary transition-transform', open ? '' : '-rotate-90')}
          aria-hidden="true"
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ParamRow({
  def,
  value,
  onSet,
  onReset,
}: {
  def: ParamDef;
  value: unknown;
  onSet: (value: unknown) => void;
  onReset: () => void;
}) {
  const localize = useLocalize();
  const isSet = value !== undefined && value !== null && value !== '';

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="truncate text-sm text-text-primary">{def.label}</span>
      {!isSet ? (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-0.5 text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
          onClick={() => {
            if (def.type === 'switch') {
              onSet(true);
            } else if (def.type === 'select') {
              onSet(def.options?.[0] ?? '');
            } else {
              onSet(def.type === 'number' ? 0 : '');
            }
          }}
        >
          {localize('com_atk_param_default')}
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          {def.type === 'switch' && (
            <button
              type="button"
              role="switch"
              aria-checked={value === true}
              aria-label={def.label}
              className={cn(
                'relative h-5 w-9 rounded-full transition',
                value === true ? 'bg-blue-500' : 'bg-surface-tertiary',
              )}
              onClick={() => onSet(value !== true)}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white transition',
                  value === true ? 'left-[18px]' : 'left-0.5',
                )}
              />
            </button>
          )}
          {def.type === 'select' && (
            <select
              aria-label={def.label}
              className="rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
              value={String(value)}
              onChange={(e) => onSet(e.target.value)}
            >
              {def.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === '' ? '—' : opt}
                </option>
              ))}
            </select>
          )}
          {(def.type === 'number' || def.type === 'text') && (
            <input
              aria-label={def.label}
              type={def.type === 'number' ? 'number' : 'text'}
              placeholder={def.placeholder}
              className="w-24 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-right text-xs text-text-primary placeholder-text-secondary focus:outline-none"
              value={value as string | number}
              onChange={(e) =>
                onSet(def.type === 'number' ? e.target.valueAsNumber : e.target.value)
              }
            />
          )}
          <button
            type="button"
            className="rounded-md p-1 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            aria-label={localize('com_atk_param_reset')}
            onClick={onReset}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function ControlsPanel() {
  const localize = useLocalize();
  const { conversation, setConversation } = useChatContext();
  const convo = conversation as (TConversation & Record<string, unknown>) | null;

  const [customRows, setCustomRows] = useState<{ key: string; value: string }[]>([]);

  const setParam = useCallback(
    (key: string, value: unknown) => {
      setConversation((prev) =>
        prev ? ({ ...prev, [key]: value } as TConversation) : prev,
      );
    },
    [setConversation],
  );

  const resetParam = useCallback(
    (key: string) => {
      setConversation((prev) => {
        if (!prev) {
          return prev;
        }
        const next = { ...prev } as Record<string, unknown>;
        delete next[key];
        return next as TConversation;
      });
    },
    [setConversation],
  );

  const onPromptChange = useCallback(
    (value: string) => setParam('promptPrefix', value),
    [setParam],
  );

  return (
    <div className="flex flex-col">
      <Section title={localize('com_atk_valves')} defaultOpen={false}>
        <p className="text-xs text-text-secondary">{localize('com_atk_valves_empty')}</p>
      </Section>

      <Section title={localize('com_atk_system_prompt')}>
        <textarea
          className="min-h-[88px] w-full resize-y rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:border-border-heavy focus:outline-none"
          placeholder={localize('com_atk_system_prompt_ph')}
          value={(convo?.promptPrefix as string) ?? ''}
          onChange={(e) => onPromptChange(e.target.value)}
        />
      </Section>

      <Section title={localize('com_atk_advanced_params')}>
        <div className="flex flex-col">
          {ADVANCED_PARAMS.map((def) => (
            <ParamRow
              key={def.key}
              def={def}
              value={convo?.[def.key]}
              onSet={(value) => setParam(def.key, value)}
              onReset={() => resetParam(def.key)}
            />
          ))}

          {customRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-1.5 py-1.5">
              <input
                aria-label={localize('com_atk_param_custom_key')}
                placeholder={localize('com_atk_param_custom_key')}
                className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary placeholder-text-secondary focus:outline-none"
                value={row.key}
                onChange={(e) => {
                  const next = [...customRows];
                  const prevKey = next[idx].key;
                  next[idx] = { ...next[idx], key: e.target.value };
                  setCustomRows(next);
                  if (prevKey) {
                    resetParam(prevKey);
                  }
                  if (e.target.value) {
                    setParam(e.target.value, row.value);
                  }
                }}
              />
              <input
                aria-label={localize('com_atk_param_custom_value')}
                placeholder={localize('com_atk_param_custom_value')}
                className="w-24 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary placeholder-text-secondary focus:outline-none"
                value={row.value}
                onChange={(e) => {
                  const next = [...customRows];
                  next[idx] = { ...next[idx], value: e.target.value };
                  setCustomRows(next);
                  if (row.key) {
                    setParam(row.key, e.target.value);
                  }
                }}
              />
              <button
                type="button"
                className="rounded-md p-1 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
                aria-label={localize('com_atk_param_reset')}
                onClick={() => {
                  if (row.key) {
                    resetParam(row.key);
                  }
                  setCustomRows(customRows.filter((_, i) => i !== idx));
                }}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}

          <button
            type="button"
            className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-medium py-2 text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            onClick={() => setCustomRows([...customRows, { key: '', value: '' }])}
          >
            <Plus size={13} aria-hidden="true" />
            {localize('com_atk_param_add_custom')}
          </button>
        </div>
      </Section>
    </div>
  );
}

export default memo(ControlsPanel);
