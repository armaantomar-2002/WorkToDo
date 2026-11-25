'use strict';

function startupMessage(err, port) {
  if (err.code === 'EADDRINUSE') {
    return `Failed to start server: port ${port} is already in use (EADDRINUSE). Stop the process using it or set a different PORT.`;
  }
  if (err.code === 'EACCES') return `Failed to start server: permission denied for port ${port} (EACCES). Choose a different PORT.`;
  return `Failed to start server: ${err.message}`;
}

/**
 * Starts listening. Startup failures (EADDRINUSE, EACCES, ...) are emitted on the server's 'error' event, never through the
 * listen callback, so a handler is attached before listening. Any later server error is also fatal (logged, exit code 1).
 */
function listen(server, config, { logger = console, exit = process.exit } = {}) {
  server.on('error', (err) => {
    logger.error(server.listening ? `Server error: ${err.message}` : startupMessage(err, config.port));
    exit(1);
  });
  const args = config.host ? [config.port, config.host] : [config.port];
  server.listen(...args, () => {
    logger.log(`${config.name} (${config.nodeEnv}) listening on port ${server.address().port}`);
  });
}

/**
 * Graceful shutdown on SIGINT/SIGTERM: stop accepting connections, let in-flight requests finish, close idle keep-alive
 * connections, then exit 0. If that takes longer than timeoutMs, exit 1. Repeated signals are ignored. `proc`, `exit` and
 * `logger` are injectable so the logic can be tested without terminating the test process.
 */
function registerShutdown(server, { proc = process, exit = process.exit, logger = console, timeoutMs = 10000, signals = ['SIGINT', 'SIGTERM'], beforeExit } = {}) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received, shutting down`);
    const force = setTimeout(() => { logger.error('Shutdown timed out, forcing exit'); exit(1); }, timeoutMs);
    force.unref();
    const sweep = setInterval(() => server.closeIdleConnections?.(), 200); // connections that become idle after their response
    sweep.unref();
    server.close(() => {
      clearTimeout(force); clearInterval(sweep);
      if (typeof beforeExit !== 'function') return exit(0); // optional async cleanup (e.g. closing the database pool)
      return Promise.resolve().then(beforeExit).catch((e) => logger.error(`Cleanup failed: ${e && e.message}`)).finally(() => exit(0));
    });
    server.closeIdleConnections?.();
  };
  for (const signal of signals) proc.on(signal, () => shutdown(signal));
  return shutdown;
}

module.exports = { listen, registerShutdown, startupMessage };
