const { createEndpointsConfigService } = require('@librechat/api');
const loadDefaultEndpointsConfig = require('./loadDefaultEConfig');
const { getAppConfig } = require('./app');
const { filterEndpointsConfig } = require('./endpointAccess');

const { getEndpointsConfig: baseGetEndpointsConfig, checkCapability } =
  createEndpointsConfigService({
    getAppConfig,
    loadDefaultEndpointsConfig,
  });

/**
 * Wrap the base service so restricted endpoints (vLLM, etc.) are stripped
 * for users not on the env-var allowlist. ADMIN role always sees everything.
 */
async function getEndpointsConfig(req) {
  const config = await baseGetEndpointsConfig(req);
  return filterEndpointsConfig(config, req);
}

module.exports = { getEndpointsConfig, checkCapability };
