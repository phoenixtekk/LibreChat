import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeProviderName,
} from './types';

/** Single-method interface every code-execution backend implements.
 *
 *  Throwing is reserved for *internal* failure (network refused, malformed
 *  config, provider crash). User-visible failures — code that exits nonzero,
 *  times out, OOMs, hits a sandbox violation — must be returned as a
 *  populated CodeExecutionResult with errorKind set. Callers downstream
 *  treat all non-throws as "the runner ran your code" so the agent can
 *  reason about the actual failure. */
export interface CodeExecutionProvider {
  /** Name reported back in CodeExecutionResult.providerUsed. */
  readonly name: Exclude<CodeProviderName, 'auto'>;

  /** True if the provider is fully configured and ready to receive requests.
   *  Used by select.ts to skip a provider that's wired but not connected
   *  (e.g. LibreChat paid API without a key). */
  isAvailable(): boolean;

  /** Run one code execution request. Always resolves; never rejects for
   *  user-visible code failures. */
  execute(request: CodeExecutionRequest): Promise<CodeExecutionResult>;
}
