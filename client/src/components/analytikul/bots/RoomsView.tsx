import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { botsRpc, type Room, type RoomsListResult } from './rpc';

const ROOMS_KEY = ['atk-bots', 'rooms'];

/** Compact one-line rendering of an opaque room-log event (shape not asserted). */
function eventLine(event: unknown): string {
  if (event != null && typeof event === 'object') {
    try {
      return JSON.stringify(event).slice(0, 240);
    } catch {
      return String(event);
    }
  }
  return String(event);
}

/**
 * Group-chat rooms (Hermes Bot Mode). Admin lists/creates rooms (2–6 bots) and inspects a room's
 * state + log; the bots deliberate autonomously via the gateway. Sending a user event into a room
 * is deferred until the groups.send payload schema is confirmed against the live gateway.
 */
export default function RoomsView({
  botNames,
  token,
}: {
  botNames: string[];
  token: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const rooms = useQuery({
    queryKey: ROOMS_KEY,
    queryFn: () => botsRpc<RoomsListResult>('groups.list', {}, token),
  });

  const createRoom = useMutation({
    mutationFn: (payload: { name: string; members: string[] }) =>
      botsRpc<{ room: Room }>('groups.create', payload, token),
    onSuccess: () => {
      setName('');
      setMembers([]);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ROOMS_KEY });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'create failed'),
  });

  const toggleMember = (bot: string) =>
    setMembers((prev) => (prev.includes(bot) ? prev.filter((b) => b !== bot) : [...prev, bot]));

  const roomList = rooms.data?.rooms ?? [];
  const canCreate = name.trim() !== '' && members.length >= 2 && members.length <= 6;

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-sm">
      <form
        className="flex flex-col gap-1.5 rounded-lg bg-surface-secondary p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) {
            createRoom.mutate({ name: name.trim(), members });
          }
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="room name…"
          aria-label="Room name"
          className="rounded-lg bg-surface-primary px-2.5 py-1.5 text-sm outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {botNames.map((bot) => (
            <button
              key={bot}
              type="button"
              onClick={() => toggleMember(bot)}
              data-active={members.includes(bot)}
              className="rounded-full border border-border-light px-2 py-0.5 text-[11px] data-[active=true]:bg-surface-active data-[active=true]:text-text-primary"
            >
              {bot}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-tertiary">{members.length} selected (2–6)</span>
          <button
            type="submit"
            disabled={!canCreate || createRoom.isLoading}
            className="rounded-lg bg-surface-active px-2.5 py-1 text-xs text-text-primary disabled:opacity-50"
          >
            {createRoom.isLoading ? '…' : 'Create room'}
          </button>
        </div>
      </form>

      {error != null && <div className="text-xs text-text-destructive">{error}</div>}
      {rooms.isLoading && <div className="text-xs text-text-tertiary">Loading rooms…</div>}

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {roomList.map((room) => (
          <li key={room.room_id}>
            <button
              type="button"
              onClick={() => setSelected(room.room_id === selected ? null : room.room_id)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover"
            >
              <span className="truncate text-text-primary">{room.name || room.room_id}</span>
              <span className="text-xs text-text-tertiary">
                {(room.members ?? []).length} members
                {room.disbanded_at != null ? ' · disbanded' : ''}
              </span>
            </button>
            {selected === room.room_id && <RoomDetail roomId={room.room_id} token={token} />}
          </li>
        ))}
        {!rooms.isLoading && roomList.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-text-tertiary">
            No rooms yet. Create one with 2–6 bots above.
          </li>
        )}
      </ul>
    </div>
  );
}

function RoomDetail({ roomId, token }: { roomId: string; token: string | undefined }) {
  const log = useQuery({
    queryKey: ['atk-bots', 'room-log', roomId],
    queryFn: () => botsRpc<{ events?: unknown[] }>('groups.log', { room_id: roomId }, token),
    refetchInterval: 4000,
  });
  const events = log.data?.events ?? [];

  return (
    <div className="mx-2 mb-1.5 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-surface-secondary p-2 text-[11px]">
      {log.isLoading && <div className="text-text-tertiary">Loading log…</div>}
      {!log.isLoading && events.length === 0 && (
        <div className="text-text-tertiary">No events yet.</div>
      )}
      {events.map((event, i) => (
        <div key={i} className="whitespace-pre-wrap break-all text-text-secondary">
          {eventLine(event)}
        </div>
      ))}
    </div>
  );
}
