import { useCallback, useRef, useState } from 'react';
import { SSE } from 'sse.js';
import { useAuthContext } from '~/hooks';

export type AgentEventType =
  | 'text_chunk'
  | 'tool_start'
  | 'tool_output'
  | 'tool_complete'
  | 'step'
  | 'cost_event'
  | 'status'
  | 'done'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  seq: number;
  ts: number;
  task_id: string;
  text?: string;
  tool?: string;
  call_id?: string;
  args?: Record<string, unknown>;
  output?: string;
  kind?: string;
  state?: string;
  model?: string;
  cost_usd?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  final_response?: string;
  message?: string;
  interrupted?: boolean;
}

export type AgentRunState = 'idle' | 'starting' | 'running' | 'done' | 'error' | 'cancelled';

export interface AgentStreamApi {
  state: AgentRunState;
  events: AgentEvent[];
  responseText: string;
  finalResponse: string | null;
  errorMessage: string | null;
  totalCostUsd: number;
  totalTokens: number;
  taskId: string | null;
  run: (message: string, conversationId: string) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

const EVENT_TYPES: AgentEventType[] = [
  'text_chunk',
  'tool_start',
  'tool_output',
  'tool_complete',
  'step',
  'cost_event',
  'status',
  'done',
  'error',
];

export default function useAgentStream(): AgentStreamApi {
  const { token } = useAuthContext();
  const [state, setState] = useState<AgentRunState>('idle');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [responseText, setResponseText] = useState('');
  const [finalResponse, setFinalResponse] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [totalCostUsd, setTotalCostUsd] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const sseRef = useRef<SSE | null>(null);
  const taskRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;
    taskRef.current = null;
    setState('idle');
    setEvents([]);
    setResponseText('');
    setFinalResponse(null);
    setErrorMessage(null);
    setTotalCostUsd(0);
    setTotalTokens(0);
    setTaskId(null);
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);
    if (event.type === 'text_chunk' && event.text) {
      setResponseText((prev) => prev + event.text);
    } else if (event.type === 'cost_event') {
      setTotalCostUsd((prev) => prev + (event.cost_usd ?? 0));
      setTotalTokens((prev) => prev + (event.input_tokens ?? 0) + (event.output_tokens ?? 0));
    } else if (event.type === 'done') {
      setFinalResponse(event.final_response ?? null);
      setState(event.interrupted ? 'cancelled' : 'done');
    } else if (event.type === 'error') {
      setErrorMessage(event.message ?? 'agent error');
      setState('error');
    }
  }, []);

  const run = useCallback(
    async (message: string, conversationId: string) => {
      reset();
      setState('starting');
      try {
        const res = await fetch('/api/analytikul/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message, conversationId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `run failed (${res.status})`);
        }
        const { taskId: id } = (await res.json()) as { taskId: string };
        taskRef.current = id;
        setTaskId(id);
        setState('running');

        const sse = new SSE(`/api/analytikul/agent/stream/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        sseRef.current = sse;
        for (const type of EVENT_TYPES) {
          sse.addEventListener(type, ((evt: MessageEvent) => {
            try {
              handleEvent(JSON.parse(evt.data) as AgentEvent);
            } catch {
              /* skip malformed frame */
            }
          }) as EventListener);
        }
        sse.addEventListener('error', () => {
          setState((prev) => (prev === 'running' || prev === 'starting' ? 'error' : prev));
          setErrorMessage((prev) => prev ?? 'stream disconnected');
        });
        sse.stream();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'agent run failed');
        setState('error');
      }
    },
    [token, reset, handleEvent],
  );

  const cancel = useCallback(async () => {
    const id = taskRef.current;
    if (!id) {
      return;
    }
    await fetch(`/api/analytikul/agent/cancel/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }, [token]);

  return {
    state,
    events,
    responseText,
    finalResponse,
    errorMessage,
    totalCostUsd,
    totalTokens,
    taskId,
    run,
    cancel,
    reset,
  };
}
