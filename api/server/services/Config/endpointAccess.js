/**
 * Per-user endpoint access control (Feature 1a — env-var allowlist).
 *
 * Restricts specific endpoints to specific users + ADMIN role. Drives both:
 *   - the picker (filtered in /api/config + /api/endpoints responses)
 *   - downstream validation (a request for an endpoint the user can't see
 *     naturally fails because the endpoint isn't in their endpointsConfig)
 *
 * Configured via env vars of the form `<NAME>_ALLOWED_EMAILS`, comma-separated.
 * Currently restricting: vLLM (the free local Qwen on linuxg3 GPU). If a
 * restricted endpoint's env var is unset or empty, the endpoint is open to
 * everyone (no breaking default).
 *
 * Admins always have access — no need to list every admin email.
 */

/**
 * Endpoint names governed by an allowlist, mapped to their env-var key and
 * an inline fallback list. The inline fallback is the SOURCE OF TRUTH today
 * because production env vars on the analytikul-app container come from the
 * docker-compose env block, and adding a new key there requires
 * `up -d --force-recreate` which wipes every docker-cp hotfix on the
 * writable layer (dist, api routes, librechat.yaml, network bridges).
 *
 * Until a fuller solution lands (1b admin UI with DB-backed access OR a
 * deliberate compose-recreate sprint), the inline fallback is what's
 * actually enforcing access. If the env var IS set, it takes precedence.
 */
const RESTRICTED_ENDPOINTS = {
  vLLM: {
    envKey: 'VLLM_ALLOWED_EMAILS',
    fallback: ['lacy@intuneexperts.com'],
  },
};

function parseEmailList(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdmin(user) {
  const role = (user?.role || '').toString().toUpperCase();
  return role === 'ADMIN';
}

/**
 * @param {string} endpointName
 * @param {{ user?: { role?: string, email?: string } }} req
 * @returns {boolean} true if the user may use this endpoint
 */
function isEndpointAllowed(endpointName, req) {
  const entry = RESTRICTED_ENDPOINTS[endpointName];
  if (!entry) {
    return true;
  }
  const envList = parseEmailList(process.env[entry.envKey]);
  const allowList = envList.length > 0
    ? envList
    : (entry.fallback || []).map((s) => s.toLowerCase());
  if (allowList.length === 0) {
    return true;
  }
  const user = req?.user;
  if (!user) {
    return false;
  }
  if (isAdmin(user)) {
    return true;
  }
  const email = (user.email || '').toLowerCase();
  return email !== '' && allowList.includes(email);
}

/**
 * Remove restricted endpoints the current user can't access from the
 * endpointsConfig object returned by getEndpointsConfig.
 */
function filterEndpointsConfig(endpointsConfig, req) {
  if (!endpointsConfig || typeof endpointsConfig !== 'object') {
    return endpointsConfig;
  }
  const filtered = { ...endpointsConfig };
  for (const name of Object.keys(RESTRICTED_ENDPOINTS)) {
    if (Object.prototype.hasOwnProperty.call(filtered, name) && !isEndpointAllowed(name, req)) {
      delete filtered[name];
    }
  }
  return filtered;
}

/**
 * Strip modelSpecs whose preset.endpoint points at a restricted endpoint
 * the user can't access. Operates on the sanitized output (which is a shape
 * the client consumes).
 */
function filterModelSpecs(modelSpecsPayload, req) {
  if (!modelSpecsPayload || !Array.isArray(modelSpecsPayload.list)) {
    return modelSpecsPayload;
  }
  const filtered = {
    ...modelSpecsPayload,
    list: modelSpecsPayload.list.filter((spec) => {
      const ep = spec?.preset?.endpoint;
      if (!ep || !Object.prototype.hasOwnProperty.call(RESTRICTED_ENDPOINTS, ep)) {
        return true;
      }
      return isEndpointAllowed(ep, req);
    }),
  };
  return filtered;
}

module.exports = {
  RESTRICTED_ENDPOINTS,
  isEndpointAllowed,
  filterEndpointsConfig,
  filterModelSpecs,
};
