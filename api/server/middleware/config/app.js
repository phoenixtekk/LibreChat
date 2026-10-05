const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const { applyUserEndpoints } = require('~/server/services/Config/userEndpoints');

const configMiddleware = async (req, res, next) => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    const appConfig = await getAppConfig({ role: userRole, userId, tenantId });
    // Splice in this user's BYOK custom endpoints (2a) on a per-request clone.
    req.config = await applyUserEndpoints(appConfig, req);

    next();
  } catch (error) {
    logger.error('Config middleware error:', {
      error: error.message,
      userRole: req.user?.role,
      path: req.path,
    });

    try {
      req.config = await getAppConfig({ tenantId: req.user?.tenantId });
      next();
    } catch (fallbackError) {
      logger.error('Fallback config middleware error:', fallbackError);
      next(fallbackError);
    }
  }
};

module.exports = configMiddleware;
