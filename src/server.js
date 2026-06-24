/**
 * Layer: Entry (boot).
 * Process entrypoint: runs the loaders, starts the HTTP + Socket.io server listening on
 * config.PORT, and installs graceful-shutdown handlers (SIGTERM/SIGINT): stop accepting
 * connections → drain in-flight events → close Socket.io → close BOTH Mongo connections → exit.
 * Clients auto-reconnect. Also wires uncaught-exception / unhandled-rejection logging.
 */
import { config } from './config/index.js';
import { bootstrap } from './loaders/index.js';
import { closeDatabases } from './loaders/db.js';
import { logger } from './common/logger.js';

async function main() {
  const { httpServer, io } = await bootstrap();

  httpServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'marketplace-chat listening');
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown started');
    try {
      // Stop accepting new HTTP connections.
      await new Promise((resolve) => httpServer.close(resolve));
      // Close Socket.io (disconnects clients — they auto-reconnect elsewhere).
      await io.close();
      // Close both Mongo connections.
      await closeDatabases();
      logger.info('graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'failed to boot');
  process.exit(1);
});
