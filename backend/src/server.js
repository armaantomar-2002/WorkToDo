'use strict';
const http = require('node:http');
const { loadConfig, assertMlConfigured, assertDatabaseConfigured } = require('./config/env');
const { createApp } = require('./app');
const { listen, registerShutdown } = require('./lifecycle');

function start() {
  let config;
  try {
    config = loadConfig();
    assertMlConfigured(config);
    assertDatabaseConfigured(config);
  } catch (err) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }

  config.warnings.forEach((w) => console.warn(`Warning: ${w}`));
  let prisma;
  if (config.database.url) {
    prisma = require('./db/prisma').createPrismaClient(config);
  } else {
    console.warn('Warning: DATABASE_URL is not set; only the stateless endpoints (/, /health, /ready, POST /api/v1/recommendations) are available.');
  }
  const server = http.createServer(createApp(config, { prisma }));
  listen(server, config);
  registerShutdown(server, { beforeExit: prisma ? () => prisma.$disconnect() : undefined });
  return server;
}

if (require.main === module) start();

module.exports = { start };
