/** Code execution abstraction — shared types.
 *
 *  Decouples LibreChat's main-chat `execute_code` tool from any single
 *  runner. Today: Hermes (gVisor sandbox in analytikul-hermes-adapter).
 *  Mocked: LibreChat paid Code API ($9/mo — not subscribed). Future:
 *  Anthropic native tools, on-host runners, etc.
 *
 *  See packages/api/src/tools/codeExec/provider.ts for the interface
 *  every provider implements. */

export type CodeLanguage = 'python' | 'javascript' | 'bash';

export type CodeProviderName = 'hermes' | 'librechat' | 'auto';

/** File the agent wants available in the runner's workdir. */
export type CodeExecFile = {
  /** Relative path inside the workdir; no leading slash, no ".." */
  path: string;
  /** Base64-encoded file bytes. */
  content_b64: string;
};

/** File the runner produced in its workdir, returned to the caller. */
export type CodeExecArtifact = {
  path: string;
  content_b64: string;
  mime?: string;
  /** Size in bytes; honored by transport limits even if content_b64 is omitted. */
  size: number;
};

export type CodeExecutionRequest = {
  language: CodeLanguage;
  code: string;
  /** Hard cap; runners should kill at this point and return exit_code = -1. */
  timeoutMs?: number;
  /** Per-run memory ceiling in MB. */
  memoryMb?: number;
  stdin?: string;
  files?: CodeExecFile[];
  /** Opaque correlation id forwarded to the runner for tracing. */
  conversationId?: string;
  /** User identifier — needed for per-user resource accounting and audit. */
  userId?: string;
};

export type CodeExecErrorKind =
  | 'ok'
  | 'timeout'
  | 'oom'
  | 'syntax_error'
  | 'runtime_error'
  | 'sandbox_violation'
  | 'provider_unavailable'
  | 'provider_unconfigured'
  | 'rate_limited'
  | 'unknown';

export type CodeExecutionResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Files the code wrote to its workdir, surfaced for the caller. */
  artifacts: CodeExecArtifact[];
  /** Which provider actually executed this (set by the dispatcher). */
  providerUsed: Exclude<CodeProviderName, 'auto'>;
  /** Coarse error classification for telemetry / agent retry logic. */
  errorKind: CodeExecErrorKind;
};

/** Used by select.ts to resolve which provider runs a given request. */
export type CodeExecConfig = {
  /** Default provider when no per-conversation/per-spec override is set. */
  defaultProvider: Exclude<CodeProviderName, 'auto'>;
  /**
   * Hash-based A/B split. Format: `hermes:80,librechat:20` (must sum to 100).
   * When set, overrides defaultProvider with a deterministic hash on
   * conversationId so the same chat always lands on the same provider.
   * Empty/unset disables splitting.
   */
  abSplit?: string;
  /** Per-modelSpec override map. modelSpec.executeCodeProvider wins over default. */
  perSpec?: Record<string, Exclude<CodeProviderName, 'auto'>>;
};
