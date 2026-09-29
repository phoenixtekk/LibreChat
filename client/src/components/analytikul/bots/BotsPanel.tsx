import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '~/hooks';
import {
  botsRpc,
  botsHealth,
  isBot,
  type BotProfile,
  type ProfilesListResult,
  type ProfileDescribeResult,
} from './rpc';

const ROSTER_KEY = ['atk-bots', 'roster'];

/**
 * Admin-only Bots surface (Hermes Bot Mode). Renders the profile roster from the gateway, lets an
 * admin create a Bot (a profile marked with the `hermes-bots` ui_meta), and inspect/edit one.
 * Group-chat rooms, routines, and per-bot budgets/vault are layered on in later stages.
 */
export default function BotsPanel() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
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

  const markAsBot = useMutation({
    mutationFn: (profile: BotProfile) =>
      botsRpc(
        'profiles.configure',
        {
          name: profile.name,
          ui_meta: { 'hermes-bots': { title: profile.display_name || profile.name } },
        },
        token,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ROSTER_KEY }),
    onError: (err) => setError(err instanceof Error ? err.message : 'update failed'),
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

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-sm">
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
                </span>
                <span className="block truncate text-xs text-text-tertiary">
                  {profile.canonical_session?.preview || profile.model || 'no model'}
                </span>
              </span>
            </button>

            {selected === profile.name && (
              <BotDetail
                name={profile.name}
                token={token}
                canMark={!isBot(profile)}
                onMark={() => markAsBot.mutate(profile)}
              />
            )}
          </li>
        ))}
        {!roster.isLoading && profiles.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-text-tertiary">
            No profiles yet. Create your first bot above.
          </li>
        )}
      </ul>
    </div>
  );
}

function BotDetail({
  name,
  token,
  canMark,
  onMark,
}: {
  name: string;
  token: string | undefined;
  canMark: boolean;
  onMark: () => void;
}) {
  const detail = useQuery({
    queryKey: ['atk-bots', 'describe', name],
    queryFn: () => botsRpc<ProfileDescribeResult>('profiles.describe', { name }, token),
  });

  if (detail.isLoading) {
    return <div className="px-9 py-1 text-xs text-text-tertiary">Loading…</div>;
  }
  if (detail.isError || detail.data == null) {
    return <div className="px-9 py-1 text-xs text-text-destructive">Couldn’t load this bot.</div>;
  }

  const { soul, model, skills } = detail.data;
  const enabledSkills = skills.filter((s) => s.enabled).length;

  return (
    <div className="mx-2 mb-1.5 rounded-lg bg-surface-secondary p-2 text-xs">
      <div className="text-text-secondary">
        Model: <span className="text-text-primary">{model.default || '—'}</span> (
        {model.provider || '—'})
      </div>
      <div className="text-text-secondary">
        Skills: <span className="text-text-primary">{enabledSkills}</span> / {skills.length} enabled
      </div>
      {soul && (
        <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-text-tertiary">{soul}</div>
      )}
      {canMark && (
        <button
          type="button"
          onClick={onMark}
          className="mt-1.5 rounded bg-surface-active px-2 py-1 text-[11px] text-text-primary"
        >
          Mark as Bot
        </button>
      )}
    </div>
  );
}
