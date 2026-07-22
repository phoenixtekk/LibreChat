const express = require('express');
const { modelController } = require('~/server/controllers/ModelController');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware/');

const router = express.Router();
/** configMiddleware sets req.config (incl. per-user BYOK endpoints) so the
 *  model list reflects the user's custom endpoints. */
router.get('/', requireJwtAuth, configMiddleware, modelController);

module.exports = router;
