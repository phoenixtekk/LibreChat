export interface AgentRunBody {
  message: string;
  conversationId: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  enabledToolsets?: string[];
  disabledToolsets?: string[];
}

export interface AdapterRunRequest {
  message: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string;
  model: string;
  provider: string;
  api_key: string;
  base_url: string;
  enabled_toolsets?: string[];
  disabled_toolsets?: string[];
}

export interface AgentStreamEvent {
  type:
    | 'text_chunk'
    | 'tool_start'
    | 'tool_output'
    | 'tool_complete'
    | 'step'
    | 'cost_event'
    | 'status'
    | 'done'
    | 'error';
  seq: number;
  ts: number;
  task_id: string;
  text?: string;
  tool?: string;
  call_id?: string;
  args?: unknown;
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

export interface AdapterToolInfo {
  name: string;
  description: string;
}
