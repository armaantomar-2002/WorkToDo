'use strict';
const express = require('express');

/** Readiness (separate from liveness at /health): probes the ML service on demand, with no caching or background polling. */
function readyRouter(config, mlClient) {
  const router = express.Router();
  router.get('/ready', async (req, res) => {
    const mlService = await mlClient.checkReadiness();
    const ready = mlService.status === 'ok';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', service: config.service, timestamp: new Date().toISOString(), checks: { node: { status: 'ok' }, mlService } });
  });
  return router;
}

module.exports = { readyRouter };
