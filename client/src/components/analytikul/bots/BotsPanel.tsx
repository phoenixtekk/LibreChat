import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '~/hooks';
import BotChat from './BotChat';
import RoomsView from './RoomsView';
import {
  botsRpc,
  botsHealth,
  isBot,
  botMeta,
  isSharedWithOrg,
  type BotProfile,
  type ProfilesListResult,
  type ProfileDescribeResult,
  type CronListResult,
} from './rpc';

const ROSTER_KEY = ['atk-bots', 'roster'];
type BotsView = 'roster' | 'rooms';

/**
 * Admin-only Bots surface (Hermes Bot Mode). Roster of profiles from the gateway with create,
 * per-bot detail (model/skills/soul, provider pin, org-share, routines, chat), and a Rooms view
 * for multi-bot group chats. All calls go through the admin-gated /bots broker.
 */
export default function BotsPanel() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState<BotsView>('roster');
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const health = useQuery({
    queryKey: ['atk-bots', 'health'],
    queryFn: () => botsHealth(token),
    staleTime: 30_000,
  });

  const roster = useQuery({
    queryKey: ROSTER_KEY,
    queryFn: () => botsRpc<ProfilesListResult>('profiles.list', { include_sessions: true }, token),
    enabled: health.data?.reachable === true,
  });

  const createBot = useMutation({
    mutationFn: async (name: string) => {
      await botsRpc('profiles.create', { name }, token);
      await botsRpc(
        'profiles.configure',
        { name, ui_meta: { 'hermes-bots': { title: name } } },
        token,
      );
    },
    onSuccess: () => {
      setNewName('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ROSTER_KEY });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'create failed'),
  });

  if (health.isLoading) {
    return <div className="p-3 text-xs text-text-tertiary">Connecting to the Bots gateway…</div>;
  }
  if (health.data?.configured === false) {
    return (
      <div className="p-3 text-xs text-text-tertiary">
        Bots gateway not configured. Set <code>HERMES_GATEWAY_URL</code> and deploy the
        <code> hermes-gateway</code> service.
      </div>
    );
  }
  if (health.data?.reachable === false) {
    return (
      <div className="p-3 text-xs text-text-destructive">
        Bots gateway configured but unreachable. Check the <code>hermes-gateway</code> container.
      </div>
    );
  }

  const profiles = roster.data?.profiles ?? [];
  const botNames = profiles.filter(isBot).map((p) => p.name);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-0.5 border-b border-border-light px-2 py-1">
        {(['roster', 'rooms'] as BotsView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            data-active={view === v}
            className="rounded-lg px-2.5 py-1 text-xs capitalize text-text-secondary data-[active=true]:bg-surface-active data-[active=true]:text-text-primary"
          >
            {v}
          </button>
        ))}
      </div>

      {view === 'rooms' ? (
        <RoomsView botNames={botNames} token={token} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-sm">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) {
                createBot.mutate(name);
              }
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="new bot name…"
              aria-label="New bot name"
              className="min-w-0 flex-1 rounded-lg bg-surface-secondary px-2.5 py-1.5 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={createBot.isLoading || newName.trim() === ''}
              className="rounded-lg bg-surface-active px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50"
            >
              {createBot.isLoading ? '…' : 'New bot'}
            </button>
          </form>

          {error != null && <div className="text-xs text-text-destructive">{error}</div>}
          {roster.isLoading && <div className="text-xs text-text-tertiary">Loading roster…</div>}

          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {profiles.map((profile) => (
              <li key={profile.name}>
                <button
                  type="button"
                  onClick={() => setSelected(profile.name === selected ? null : profile.name)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover"
                  data-active={selected === profile.name}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-active text-[11px] uppercase text-text-secondary"
                  >
                    {(profile.display_name || profile.name).slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-text-primary">
                        {profile.display_name || profile.name}
                      </span>
                      {isBot(profile) && (
                        <span className="rounded bg-surface-active px-1 text-[10px] text-text-tertiary">
                          bot
                        </span>
                      )}
                      {isSharedWithOrg(profile) && (
                        <span className="rounded bg-surface-active px-1 text-[10px] text-text-tertiary">
                          org
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-text-tertiary">
                      {profile.canonical_session?.preview || profile.model || 'no model'}
                    </span>
                  </span>
                </button>

                {selected === profile.name && <BotDetail profile={profile} token={token} />}
              </li>
            ))}
            {!roster.isLoading && profiles.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-text-tertiary">
                No profiles yet. Create your first bot above.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function BotDetail({ profile, token }: { profile: BotProfile; token: string | undefined }) {
  const queryClient = useQueryClient();
  const name = profile.name;
  const [chatOpen, setChatOpen] = useState(false);
  const [provider, setProvider] = useState(profile.provider ?? '');
  const [model, setModel] = useState(profile.model ?? '');

  const detail = useQuery({
    queryKey: ['atk-bots', 'describe', name],
    queryFn: () => botsRpc<ProfileDescribeResult>('profiles.describe', { name }, token),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ROSTER_KEY });
    void queryClient.invalidateQueries({ queryKey: ['atk-bots', 'describe', name] });
  };

  const configure = useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      botsRpc('profiles.configure', { name, ...params }, token),
    onSuccess: invalidate,
  });

  const markAsBot = () =>
    configure.mutate({ ui_meta: { 'hermes-bots': { title: profile.display_name || name } } });

  const toggleShare = () =>
    configure.mutate({
      ui_meta: {
        'hermes-bots': { ...botMeta(profile), shared_with_org: !isSharedWithOrg(profile) },
      },
    });

  const pinModel = () => {
    const params: Record<string, unknown> = {};
    if (model.trim()) {
      params.model = model.trim();
    }
    if (provider.trim()) {
      params.provider = provider.trim();
    }
    if (Object.keys(params).length > 0) {
      configure.mutate(params);
    }
  };

  if (detail.isLoading) {
    return <div className="px-9 py-1 text-xs text-text-tertiary">Loading…</div>;
  }
  if (detail.isError || detail.data == null) {
    return <div className="px-9 py-1 text-xs text-text-destructive">Couldn’t load this bot.</div>;
  }

  const { soul, skills } = detail.data;
  const enabledSkills = skills.filter((s) => s.enabled).length;

  return (
    <div className="mx-2 mb-1.5 flex flex-col gap-1.5 rounded-lg bg-surface-secondary p-2 text-xs">
      <div className="text-text-secondary">
        Skills: <span className="text-text-primary">{enabledSkills}</span> / {skills.length} enabled
      </div>
      {soul && <div className="line-clamp-3 whitespace-pre-wrap text-text-tertiary">{soul}</div>}

      <div className="flex flex-wrap items-center gap-1">
        <input
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="provider"
          aria-label="Provider pin"
          className="w-24 rounded bg-surface-primary px-1.5 py-1 outline-none"
        />
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model"
          aria-label="Model pin"
          className="min-w-0 flex-1 rounded bg-surface-primary px-1.5 py-1 outline-none"
        />
        <button
          type="button"
          onClick={pinModel}
          className="rounded bg-surface-active px-2 py-1 text-[11px] text-text-primary"
        >
          Pin
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {!isBot(profile) && (
          <button
            type="button"
            onClick={markAsBot}
            className="rounded bg-surface-active px-2 py-1 text-[11px] text-text-primary"
          >
            Mark as Bot
          </button>
        )}
        <button
          type="button"
          onClick={toggleShare}
          className="rounded bg-surface-active px-2 py-1 text-[11px] text-text-primary"
        >
          {isSharedWithOrg(profile) ? 'Unshare from org' : 'Share with org'}
        </button>
        <button
          type="button"
          onClick={() => setChatOpen((v) => !v)}
          className="rounded bg-surface-active px-2 py-1 text-[11px] text-text-primary"
        >
          {chatOpen ? 'Close chat' : 'Open chat'}
        </button>
      </div>

      <RoutinesSection name={name} token={token} />
      {chatOpen && (
        <BotChat botName={name} canonicalSessionId={profile.canonical_session?.id} token={token} />
      )}
    </div>
  );
}

function RoutinesSection({ name, token }: { name: string; token: string | undefined }) {
  const queryClient = useQueryClient();
  const key = ['atk-bots', 'cron', name];
  const [schedule, setSchedule] = useState('');
  const [prompt, setPrompt] = useState('');

  const jobs = useQuery({
    queryKey: key,
    queryFn: () => botsRpc<CronListResult>('cron.manage', { action: 'list', profile: name }, token),
  });

  const addJob = useMutation({
    mutationFn: () =>
      botsRpc(
        'cron.manage',
        {
          action: 'add',
          name: `${name}-${Date.now()}`,
          schedule: schedule.trim(),
          prompt: prompt.trim(),
          deliver: 'bot-chat',
          profile: name,
        },
        token,
      ),
    onSuccess: () => {
      setSchedule('');
      setPrompt('');
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const removeJob = useMutation({
    mutationFn: (jobId: string) =>
      botsRpc('cron.manage', { action: 'remove', name: jobId, profile: name }, token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const jobList = jobs.data?.jobs ?? [];

  return (
    <div className="rounded bg-surface-primary p-1.5">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-text-tertiary">Routines</div>
      <ul className="space-y-0.5">
        {jobList.map((job) => (
          <li key={job.id} className="flex items-center justify-between gap-1">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-text-primary">{job.schedule}</span>{' '}
              <span className="text-text-tertiary">{job.prompt || job.name}</span>
            </span>
            <button
              type="button"
              onClick={() => removeJob.mutate(job.id)}
              aria-label="Remove routine"
              className="shrink-0 rounded px-1 text-text-tertiary hover:text-text-destructive"
            >
              ✕
            </button>
          </li>
        ))}
        {jobList.length === 0 && <li className="text-text-tertiary">No routines.</li>}
      </ul>
      <form
        className="mt-1 flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (schedule.trim() && prompt.trim()) {
            addJob.mutate();
          }
        }}
      >
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="cron (e.g. 0 9 * * *)"
          aria-label="Routine schedule"
          className="w-28 rounded bg-surface-secondary px-1.5 py-1 outline-none"
        />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="prompt"
          aria-label="Routine prompt"
          className="min-w-0 flex-1 rounded bg-surface-secondary px-1.5 py-1 outline-none"
        />
        <button
          type="submit"
          disabled={addJob.isLoading || !schedule.trim() || !prompt.trim()}
          className="rounded bg-surface-active px-2 py-1 text-[11px] text-text-primary disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}
