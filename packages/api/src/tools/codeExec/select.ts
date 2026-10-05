import { createHash } from 'crypto';
import type { CodeExecutionProvider } from './provider';
import type { CodeExecConfig, CodeExecutionRequest, CodeProviderName } from './types';

/** Provider-selection precedence (narrowest wins):
 *    1. Per-modelSpec override (config.perSpec[specName])
 *    2. A/B split if config.abSplit is set (hashes conversationId)
 *    3. config.defaultProvider
 *  After picking a provider, we verify isAvailable() — if false, we fall
 *  back to the first available provider in registry order so a configured
 *  but offline provider doesn't dead-end a chat. */

type Selector = {
  /** Pick a provider for this specific request. */
  select(args: {
    request: CodeExecutionRequest;
    /** Optional modelSpec name from the active chat — drives perSpec lookup. */
    specName?: string;
  }): CodeExecutionProvider;
};

/** Hash a stable input deterministically to a 0..99 bucket. */
function bucketOf(input: string): number {
  const digest = createHash('sha1').update(input).digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 100;
}

/** Parse an A/B split string like `hermes:80,librechat:20` into an
 *  ordered array of {name, weight} entries. Weights must sum to 100. */
function parseAbSplit(spec: string): Array<{ name: string; weight: number }> {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, weight] = s.split(':').map((p) => p.trim());
      return { name, weight: parseInt(weight, 10) };
    });
  const total = parts.reduce((acc, p) => acc + (Number.isFinite(p.weight) ? p.weight : 0), 0);
  if (parts.length === 0 || total !== 100 || parts.some((p) => !Number.isFinite(p.weight))) {
    return [];
  }
  return parts;
}

function pickByBucket(
  bucket: number,
  splits: Array<{ name: string; weight: number }>,
): string {
  let cumulative = 0;
  for (const part of splits) {
    cumulative += part.weight;
    if (bucket < cumulative) {
      return part.name;
    }
  }
  return splits[splits.length - 1]?.name ?? '';
}

export function createSelector(
  providers: CodeExecutionProvider[],
  config: CodeExecConfig,
): Selector {
  const byName = new Map<string, CodeExecutionProvider>();
  for (const p of providers) {
    byName.set(p.name, p);
  }

  function firstAvailable(preferredName?: string): CodeExecutionProvider {
    if (preferredName) {
      const preferred = byName.get(preferredName);
      if (preferred && preferred.isAvailable()) {
        return preferred;
      }
    }
    for (const p of providers) {
      if (p.isAvailable()) {
        return p;
      }
    }
    // Last resort: return the first provider registered. Its execute()
    // will surface a provider_unconfigured / provider_unavailable result
    // rather than throwing.
    return providers[0];
  }

  function resolveTargetName(
    request: CodeExecutionRequest,
    specName?: string,
  ): Exclude<CodeProviderName, 'auto'> {
    if (specName && config.perSpec?.[specName]) {
      return config.perSpec[specName];
    }
    if (config.abSplit) {
      const splits = parseAbSplit(config.abSplit);
      if (splits.length > 0 && request.conversationId) {
        const picked = pickByBucket(bucketOf(request.conversationId), splits);
        if (picked === 'hermes' || picked === 'librechat') {
          return picked;
        }
      }
    }
    return config.defaultProvider;
  }

  return {
    select({ request, specName }) {
      const targetName = resolveTargetName(request, specName);
      return firstAvailable(targetName);
    },
  };
}
