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
  | 'permission_request'
  | 'tool_dispatch'
  | 'done'
  | 'error';

export interface PermissionRequest {
  request_id: string;
  kind: string;
  tool?: string;
  path?: string;
  old_text?: string;
  new_text?: string;
  command?: string;
}

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
  request_id?: string;
  path?: string;
  old_text?: string;
  new_text?: string;
  command?: string;
}

export type AgentRunState = 'idle' | 'starting' | 'running' | 'done' | 'error' | 'cancelled';

export interface AgentRunOptions {
  enabledToolsets?: string[];
  disabledToolsets?: string[];
  model?: string;
  provider?: string;
  /** OpenAI-compatible base URL for a self-hosted / local model (e.g. vLLM, Ollama). */
  baseUrl?: string;
  /** Analytikul Coder: project folder (under the workspace root) to run in. */
  workspace?: string;
  /** Permission mode: plan | manual | accept_edits | auto | bypass. */
  permissionMode?: string;
  /** Where file/terminal tools run: 'container' (default) or 'bridge' (this machine). */
  execTarget?: 'container' | 'bridge';
}

export interface AgentStreamApi {
  state: AgentRunState;
  events: AgentEvent[];
  responseText: string;
  finalResponse: string | null;
  errorMessage: string | null;
  totalCostUsd: number;
  totalTokens: number;
  taskId: string | null;
  pendingApproval: PermissionRequest | null;
  run: (message: string, conversationId: string, options?: AgentRunOptions) => Promise<void>;
  cancel: () => Promise<void>;
  respond: (requestId: string, decision: string) => Promise<void>;
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
  'permission_request',
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
  const [pendingApproval, setPendingApproval] = useState<PermissionRequest | null>(null);
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
    setPendingApproval(null);
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
    } else if (event.type === 'permission_request') {
      setPendingApproval({
        request_id: event.request_id ?? '',
        kind: event.kind ?? 'edit',
        tool: event.tool,
        path: event.path,
        old_text: event.old_text,
        new_text: event.new_text,
        command: event.command,
      });
    } else if (event.type === 'error') {
      setErrorMessage(event.message ?? 'agent error');
      setState('error');
    }
  }, []);

  const run = useCallback(
    async (message: string, conversationId: string, options?: AgentRunOptions) => {
      reset();
      setState('starting');
      try {
        const res = await fetch('/api/analytikul/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message, conversationId, ...options }),
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

  const respond = useCallback(
    async (requestId: string, decision: string) => {
      const id = taskRef.current;
      setPendingApproval(null);
      if (!id) {
        return;
      }
      await fetch(`/api/analytikul/agent/respond/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, decision }),
      }).catch(() => undefined);
    },
    [token],
  );

  return {
    state,
    events,
    responseText,
    finalResponse,
    errorMessage,
    totalCostUsd,
    totalTokens,
    taskId,
    pendingApproval,
    run,
    cancel,
    respond,
    reset,
  };
}
