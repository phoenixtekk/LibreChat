export interface AgentRunBody {
  message: string;
  conversationId: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  enabledToolsets?: string[];
  disabledToolsets?: string[];
  /** Analytikul Coder: project folder under the workspace root to run in. */
  workspace?: string;
  /** Permission mode: plan | manual | accept_edits | auto | bypass. */
  permissionMode?: string;
  /** Where file/terminal tools execute: 'container' (default) or 'bridge' (user's machine). */
  execTarget?: string;
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
  workspace?: string;
  permission_mode?: string;
  exec_target?: string;
}

/** Analytikul Coder — first-class Deploy: ship a workspace project to a fleet server. */
export interface DeployBody {
  /** Project folder under the workspace root to deploy. */
  workspace: string;
  /** Target fleet server (linuxg1..linuxg6). */
  server: string;
  /** Optional public domain — surfaced as a Cloudflare route to wire up. */
  domain?: string;
  /** Optional subdomain (defaults to canonical www. when omitted). */
  subdomain?: string;
  /** auto | static | node | next */
  appType?: string;
}

export interface AdapterDeployRequest {
  workspace: string;
  server: string;
  domain: string;
  subdomain: string;
  app_type: string;
  user_id: string;
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
