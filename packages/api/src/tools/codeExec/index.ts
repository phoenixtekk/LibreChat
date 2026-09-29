import { createSelector } from './select';
import { HermesProvider } from './hermesProvider';
import { LibreChatProvider } from './libreChatProvider';
import type { CodeExecConfig, CodeProviderName } from './types';

export { HermesProvider } from './hermesProvider';
export { LibreChatProvider } from './libreChatProvider';
export { createSelector } from './select';
export type { CodeExecutionProvider } from './provider';
export type {
  CodeExecConfig,
  CodeExecArtifact,
  CodeExecErrorKind,
  CodeExecFile,
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeLanguage,
  CodeProviderName,
} from './types';

/** Default factory — builds a Selector wired to the standard providers
 *  using env-derived config. Use this from the wiring layer that
 *  intercepts LibreChat's `bash_tool` invocations.
 *
 *  Env knobs:
 *    CODE_EXECUTION_PROVIDER     — default provider name (hermes|librechat).
 *                                  Defaults to 'hermes'.
 *    CODE_EXECUTION_AB_SPLIT     — optional A/B split spec, e.g.
 *                                  "hermes:80,librechat:20" (must sum to 100).
 *    HERMES_RUNTIME_URL          — Hermes adapter base URL.
 *                                  Defaults to http://analytikul-hermes-adapter:8080.
 *    LIBRECHAT_CODE_API_KEY      — if set, the LibreChat provider becomes
 *                                  available; otherwise it stays a stub.
 *    INTERNAL_SERVICE_TOKEN      — forwarded to Hermes as x-internal-token. */
export function createDefaultSelector(): ReturnType<typeof createSelector> {
  const defaultName = (process.env.CODE_EXECUTION_PROVIDER as CodeProviderName | undefined);
  const safeDefault: Exclude<CodeProviderName, 'auto'> =
    defaultName === 'librechat' ? 'librechat' : 'hermes';
  const config: CodeExecConfig = {
    defaultProvider: safeDefault,
    abSplit: process.env.CODE_EXECUTION_AB_SPLIT,
  };
  return createSelector(
    [new HermesProvider(), new LibreChatProvider()],
    config,
  );
}
