import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isAssistantsEndpoint, EModelEndpoint, QueryKeys } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { AgentModelParameters, AgentCreateParams } from 'librechat-data-provider';
import {
  useGetEndpointsQuery,
  useGetAgentByIdQuery,
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useGetAgentCategoriesQuery,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const PROVIDER_LABELS: Record<string, string> = {
  openAI: 'OpenAI',
  azureOpenAI: 'Azure OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  bedrock: 'AWS Bedrock',
};

const CAPABILITIES: { key: 'execute_code' | 'web_search' | 'file_search'; labelKey: string }[] = [
  { key: 'execute_code', labelKey: 'com_atk_cap_code' },
  { key: 'web_search', labelKey: 'com_atk_cap_web' },
  { key: 'file_search', labelKey: 'com_atk_cap_file_search' },
];

type Caps = { execute_code: boolean; web_search: boolean; file_search: boolean; artifacts: boolean };
const EMPTY_CAPS: Caps = {
  execute_code: false,
  web_search: false,
  file_search: false,
  artifacts: false,
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-text-secondary">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:border-border-heavy focus:outline-none';

function ModelBuilderDrawer({
  open,
  agentId,
  isNew,
  onClose,
}: {
  open: boolean;
  agentId?: string;
  isNew: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();

  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const { data: modelsMap = {} } = useGetModelsQuery({ refetchOnMount: 'always' });
  const { data: categories = [] } = useGetAgentCategoriesQuery();
  const { data: existing } = useGetAgentByIdQuery(agentId ?? '', {
    enabled: open && !isNew && !!agentId,
  });

  const providers = useMemo(
    () =>
      Object.keys(endpointsConfig).filter(
        (key) => !isAssistantsEndpoint(key) && key !== EModelEndpoint.agents,
      ),
    [endpointsConfig],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [category, setCategory] = useState('general');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [caps, setCaps] = useState<Caps>(EMPTY_CAPS);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setName('');
    setDescription('');
    setInstructions('');
    setCategory('general');
    setProvider('');
    setModel('');
    setCaps(EMPTY_CAPS);
    setError('');
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (isNew) {
      reset();
      return;
    }
    if (existing) {
      setName(existing.name ?? '');
      setDescription(existing.description ?? '');
      setInstructions(existing.instructions ?? '');
      setCategory(existing.category ?? 'general');
      setProvider((existing.provider as string) ?? '');
      setModel(existing.model ?? '');
      const tools = existing.tools ?? [];
      setCaps({
        execute_code: tools.includes('execute_code'),
        web_search: tools.includes('web_search'),
        file_search: tools.includes('file_search'),
        artifacts: !!existing.artifacts,
      });
    }
  }, [open, isNew, existing, reset]);

  const models = useMemo(() => (provider ? (modelsMap[provider] ?? []) : []), [modelsMap, provider]);

  const createAgent = useCreateAgentMutation();
  const updateAgent = useUpdateAgentMutation();
  const saving = createAgent.isLoading || updateAgent.isLoading;

  const onSave = useCallback(() => {
    setError('');
    if (!model || !provider) {
      setError(localize('com_atk_model_need_model'));
      return;
    }
    const tools: string[] = [];
    if (caps.execute_code) {
      tools.push('execute_code');
    }
    if (caps.web_search) {
      tools.push('web_search');
    }
    if (caps.file_search) {
      tools.push('file_search');
    }
    const base = {
      name: name || null,
      description: description || null,
      instructions: instructions || null,
      category,
      tools,
      artifacts: caps.artifacts ? 'default' : undefined,
    };

    const done = () => {
      queryClient.invalidateQueries([QueryKeys.agents]);
      onClose();
    };

    if (isNew) {
      createAgent.mutate(
        {
          ...base,
          provider,
          model,
          model_parameters: {} as AgentModelParameters,
        } as AgentCreateParams,
        { onSuccess: done, onError: () => setError(localize('com_atk_model_save_failed')) },
      );
    } else if (agentId) {
      updateAgent.mutate(
        { agent_id: agentId, data: { ...base, provider, model } },
        { onSuccess: done, onError: () => setError(localize('com_atk_model_save_failed')) },
      );
    }
  }, [
    model,
    provider,
    caps,
    name,
    description,
    instructions,
    category,
    isNew,
    agentId,
    createAgent,
    updateAgent,
    onClose,
    queryClient,
    localize,
  ]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[120] bg-black/40" role="presentation" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed right-0 top-0 z-[121] flex h-full w-[min(96vw,460px)] flex-col bg-surface-primary-alt shadow-2xl',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ transition: 'transform 280ms cubic-bezier(0.2, 0, 0, 1)' }}
        aria-hidden={!open}
        inert={!open ? '' : undefined}
      >
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
          <span className="text-sm font-semibold text-text-primary">
            {isNew ? localize('com_atk_model_new') : localize('com_atk_model_edit')}
          </span>
          <button
            type="button"
            className="rounded-xl p-1.5 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            aria-label={localize('com_atk_close_rail')}
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Field label={localize('com_atk_model_name')}>
            <input
              className={inputCls}
              placeholder={localize('com_atk_model_name_ph')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label={localize('com_ui_description')}>
            <input
              className={inputCls}
              placeholder={localize('com_atk_model_desc_ph')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field label={localize('com_atk_model_category')} required>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              {(categories.length ? categories : [{ value: 'general', label: 'General' }]).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label?.startsWith('com_') ? localize(c.label) : c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={localize('com_atk_system_prompt')}>
            <textarea
              className={cn(inputCls, 'min-h-[96px] resize-y')}
              placeholder={localize('com_atk_model_instructions_ph')}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </Field>

          <Field label={localize('com_atk_model_provider')} required>
            <select
              className={inputCls}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel('');
              }}
            >
              <option value="">{localize('com_atk_model_select_provider')}</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </Field>

          <Field label={localize('com_atk_model_model')} required>
            <select
              className={inputCls}
              value={model}
              disabled={!provider}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">{localize('com_atk_model_select_model')}</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <div className="mb-4">
            <span className="mb-2 block text-xs font-medium text-text-secondary">
              {localize('com_atk_capabilities')}
            </span>
            <div className="flex flex-col gap-2">
              {CAPABILITIES.map(({ key, labelKey }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border-medium"
                    checked={caps[key]}
                    onChange={(e) => setCaps((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  {localize(labelKey)}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-medium"
                  checked={caps.artifacts}
                  onChange={(e) => setCaps((prev) => ({ ...prev, artifacts: e.target.checked }))}
                />
                {localize('com_atk_cap_artifacts')}
              </label>
            </div>
          </div>

          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        </div>

        <div className="border-t border-border-light p-3">
          <button
            type="button"
            className="flex w-full items-center justify-center rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-60"
            disabled={saving}
            onClick={onSave}
          >
            {saving
              ? localize('com_ui_saving')
              : isNew
                ? localize('com_atk_model_save_create')
                : localize('com_ui_save')}
          </button>
        </div>
      </aside>
    </>
  );
}

export default memo(ModelBuilderDrawer);
