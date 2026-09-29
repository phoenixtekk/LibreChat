import type { CodeExecutionProvider } from './provider';
import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeExecErrorKind,
} from './types';

/** Hermes-backed code execution provider.
 *
 *  Sends the code-run request to the Analytikul Hermes adapter, which
 *  spawns an ephemeral container under gVisor (runsc) via the
 *  docker-socket-proxy and runs the code inside it. See
 *  services/hermes-runtime/analytikul_adapter/code_exec.py for the
 *  adapter side.
 *
 *  This provider is the production path on Analytikul today (Phase 1
 *  gVisor at daemon level). Phase 2 will move to per-task ephemeral
 *  containers via the proxy — no code change needed here; the URL/host
 *  stays the same. */

const DEFAULT_BASE_URL =
  process.env.HERMES_RUNTIME_URL ?? 'http://analytikul-hermes-adapter:8001';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_MB = 512;
const MAX_TIMEOUT_MS = 120_000;
const MAX_MEMORY_MB = 2048;

type HermesResponseBody = {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  artifacts?: Array<{ path: string; content_b64: string; mime?: string; size: number }>;
  error_kind?: string;
};

function classifyHttpError(status: number, body: string): CodeExecErrorKind {
  if (status === 408 || status === 504) {
    return 'timeout';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'provider_unavailable';
  }
  if (status === 422 && body.toLowerCase().includes('sandbox')) {
    return 'sandbox_violation';
  }
  return 'unknown';
}

export class HermesProvider implements CodeExecutionProvider {
  readonly name = 'hermes' as const;
  private readonly baseUrl: string;
  private readonly internalToken: string | undefined;

  constructor(opts?: { baseUrl?: string; internalToken?: string }) {
    this.baseUrl = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.internalToken = opts?.internalToken ?? process.env.INTERNAL_SERVICE_TOKEN;
  }

  isAvailable(): boolean {
    /** Hermes is always considered available — analytikul-hermes-adapter is
     *  a peer service in our compose stack. If it's down, execute() will
     *  return a provider_unavailable result rather than throwing. */
    return true;
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const start = Date.now();
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
    const memoryMb = Math.min(
      MAX_MEMORY_MB,
      Math.max(64, request.memoryMb ?? DEFAULT_MEMORY_MB),
    );

    const payload = {
      language: request.language,
      code: request.code,
      timeout_ms: timeoutMs,
      memory_mb: memoryMb,
      stdin: request.stdin ?? '',
      files: request.files ?? [],
      conversation_id: request.conversationId,
      user_id: request.userId,
    };

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.internalToken) {
      headers['x-internal-token'] = this.internalToken;
    }

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs + 5_000);

    try {
      const res = await fetch(`${this.baseUrl}/v1/code/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const bodyText = await res.text();
      if (!res.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Hermes runtime returned ${res.status}: ${bodyText.slice(0, 500)}`,
          durationMs: Date.now() - start,
          artifacts: [],
          providerUsed: 'hermes',
          errorKind: classifyHttpError(res.status, bodyText),
        };
      }
      let body: HermesResponseBody;
      try {
        body = JSON.parse(bodyText) as HermesResponseBody;
      } catch {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Malformed JSON from Hermes runtime: ${bodyText.slice(0, 200)}`,
          durationMs: Date.now() - start,
          artifacts: [],
          providerUsed: 'hermes',
          errorKind: 'provider_unavailable',
        };
      }
      return {
        exitCode: body.exit_code,
        stdout: body.stdout ?? '',
        stderr: body.stderr ?? '',
        durationMs: body.duration_ms ?? Date.now() - start,
        artifacts: (body.artifacts ?? []).map((a) => ({
          path: a.path,
          content_b64: a.content_b64,
          mime: a.mime,
          size: a.size,
        })),
        providerUsed: 'hermes',
        errorKind: (body.error_kind as CodeExecErrorKind | undefined) ?? 'ok',
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        exitCode: 1,
        stdout: '',
        stderr: isAbort
          ? `Hermes runtime did not respond within ${timeoutMs + 5_000}ms`
          : `Hermes runtime unreachable: ${err instanceof Error ? err.message : 'unknown error'}`,
        durationMs: Date.now() - start,
        artifacts: [],
        providerUsed: 'hermes',
        errorKind: isAbort ? 'timeout' : 'provider_unavailable',
      };
    } finally {
      clearTimeout(abortTimer);
    }
  }
}
