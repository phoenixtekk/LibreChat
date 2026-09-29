/**
 * Per-user BYOK custom endpoints (Feature 2a) — request-time injection.
 *
 * Each user registers their own OpenAI-compatible endpoints (stored encrypted
 * in the `userendpoints` collection). At request time we splice that user's
 * endpoints into a CLONE of `appConfig.endpoints.custom` so they appear ONLY
 * in that user's picker and route correctly when selected.
 *
 * Both the picker services (`getEndpointsConfig`, `loadConfigModels`) and the
 * runtime resolvers (`getCustomEndpointConfig` used by custom + agent paths)
 * read `req.config.endpoints.custom`, so augmenting `req.config` once in the
 * config middleware covers every consumer.
 *
 * IMPORTANT: `getAppConfig` returns a cached, shared object. We must never
 * mutate it — every augmentation returns a shallow clone so one user's
 * endpoints can't leak into another user's (or the global) config.
 */
const { logger } = require('@librechat/data-schemas');
const { resolveUserEndpoints } = require('~/models');

/**
 * @param {object} appConfig - the resolved app config (from getAppConfig)
 * @param {{ user?: { id?: string } }} req
 * @returns {Promise<object>} appConfig (cloned) with the user's endpoints merged in
 */
async function applyUserEndpoints(appConfig, req) {
  const userId = req?.user?.id;
  if (!userId || !appConfig || typeof appConfig !== 'object') {
    return appConfig;
  }

  let endpoints;
  try {
    endpoints = await resolveUserEndpoints({ userId });
  } catch (error) {
    logger.error('[userEndpoints] failed to resolve user endpoints', error);
    return appConfig;
  }
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return appConfig;
  }

  const existing = Array.isArray(appConfig.endpoints?.custom)
    ? appConfig.endpoints.custom
    : [];
  // Never shadow a global (yaml-defined) custom endpoint — those win.
  const taken = new Set(existing.map((e) => String(e?.name ?? '').toLowerCase()));

  const additions = [];
  for (const ep of endpoints) {
    const key = String(ep?.name ?? '').toLowerCase();
    if (!key || taken.has(key)) {
      continue;
    }
    taken.add(key);
    additions.push({
      name: ep.name,
      apiKey: ep.apiKey,
      baseURL: ep.baseURL,
      models: { default: ep.models ?? [], fetch: false },
      modelDisplayLabel: ep.name,
    });
  }

  if (additions.length === 0) {
    return appConfig;
  }

  return {
    ...appConfig,
    endpoints: {
      ...appConfig.endpoints,
      custom: [...existing, ...additions],
    },
  };
}

module.exports = { applyUserEndpoints };
