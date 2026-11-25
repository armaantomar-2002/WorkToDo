'use strict';
const express = require('express');

/** Reports only what this process actually knows. Dependencies are not probed yet, so they are never reported as healthy. */
function healthRouter(config) {
  const router = express.Router();
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: config.service,
      version: config.version,
      environment: config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: { mlService: { status: 'not_checked' }, database: { status: 'not_configured' } },
    });
  });
  return router;
}

module.exports = { healthRouter };
