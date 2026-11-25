'use strict';

/** Creates the Prisma client (loaded lazily so the hermetic test-suite never needs @prisma/client). */
function createPrismaClient(config) {
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasourceUrl: config.database.url, log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'] });
}
module.exports = { createPrismaClient };
