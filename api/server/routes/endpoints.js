const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const configMiddleware = require('~/server/middleware/config/app');
const endpointController = require('~/server/controllers/EndpointController');

const router = express.Router();
/** Auth required for role/tenant-scoped endpoint config resolution.
 *  configMiddleware sets req.config (incl. per-user BYOK endpoints) so the
 *  picker reflects the same endpoints the runtime will route to. */
router.get('/', requireJwtAuth, configMiddleware, endpointController);

module.exports = router;
