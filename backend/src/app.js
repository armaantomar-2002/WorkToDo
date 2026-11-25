'use strict';
const express = require('express');
const { rootRouter } = require('./routes/root');
const { healthRouter } = require('./routes/health');
const { recommendationsRouter } = require('./routes/recommendations');
const { readyRouter } = require('./routes/ready');
const { createMlClient } = require('./clients/mlClient');
const { createRecommendationService } = require('./services/recommendationService');
const { notFound } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');

/**
 * Builds the Express app without starting a server (keeps configuration separate from startup and easy to test).
 * Database-backed routes (/api/v1/auth, users, tasks, sessions, recommendations/runs|history, dashboard, insights) are
 * mounted ONLY when a Prisma client is supplied, so the hermetic unit-test suite runs without a database.
 */
function createApp(config, { mlClient = createMlClient(config.mlService), prisma, emailProvider, now } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (prisma) {
    const { cors, securityHeaders } = require('./http/security');
    app.set('trust proxy', config.trustProxy ? 1 : false);
    app.use('/api', securityHeaders, cors(config.cors.allowedOrigins));
  }
  app.use(express.json({ limit: '1mb' }));
  app.use(rootRouter(config));
  app.use(healthRouter(config));
  app.use(readyRouter(config, mlClient));
  const recommendationService = createRecommendationService({ mlClient });
  // The stateless, unauthenticated endpoint is disabled by default in production when a database is configured.
  if (!config.features || config.features.statelessRecommendations !== false) app.use(recommendationsRouter(recommendationService));
  if (prisma) {
    const { createDbRouter } = require('./api');
    app.use('/api/v1', createDbRouter({ prisma, config, recommendationService, emailProvider, now }));
  }
  app.use(notFound);
  app.use(errorHandler(config));
  return app;
}

module.exports = { createApp };
