import type { CodeExecutionProvider } from './provider';
import type {
  CodeExecutionRequest,
  CodeExecutionResult,
} from './types';

/** LibreChat Code Interpreter API provider — currently a mocked stub.
 *
 *  The real provider hits https://code.librechat.ai (paid LibreChat
 *  service, ~$9/mo) using LIBRECHAT_CODE_API_KEY. Not subscribed right now
 *  per the product call. This stub exists so the provider-selection layer
 *  can include LibreChat as a configured option without a real key — when
 *  isAvailable() returns false, select.ts falls through to the next
 *  configured provider (typically Hermes).
 *
 *  To activate for real later:
 *    1. Subscribe to LibreChat Code Interpreter API
 *    2. Set LIBRECHAT_CODE_API_KEY in the docker-compose env block
 *    3. Replace this file's execute() body with the real HTTP client
 *    4. isAvailable() will start returning true automatically */
export class LibreChatProvider implements CodeExecutionProvider {
  readonly name = 'librechat' as const;

  isAvailable(): boolean {
    return typeof process.env.LIBRECHAT_CODE_API_KEY === 'string' &&
      process.env.LIBRECHAT_CODE_API_KEY.length > 0;
  }

  async execute(_request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const start = Date.now();
    return {
      exitCode: 1,
      stdout: '',
      stderr:
        'LibreChat Code Interpreter API is not configured on this deployment ' +
        '(LIBRECHAT_CODE_API_KEY missing). Set the env var to enable, or use ' +
        'the Hermes provider (configured by default on Analytikul).',
      durationMs: Date.now() - start,
      artifacts: [],
      providerUsed: 'librechat',
      errorKind: 'provider_unconfigured',
    };
  }
}
