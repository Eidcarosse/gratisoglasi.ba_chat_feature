/**
 * Layer: Loader (composition root entry).
 * Orchestrates the boot loaders IN ORDER: config → db (both connections) → container
 * (build repos + services, inject impls) → express (app, middleware, routes) → socket
 * (Socket.io server, auth middleware, register gateway). Returns the assembled
 * { app, httpServer, io, container, conns } to server.js.
 * Must NOT hold business logic — wiring only.
 */
import http from 'node:http';
import { connectDatabases } from './db.js';
import { buildContainer, syncChatIndexes } from './container.js';
import { createExpressApp } from './express.js';
import { attachSocket } from './socket.js';
import { logger } from '../common/logger.js';

export async function bootstrap() {
  // config/index.js validated env at import time (fail-fast); reaching here means it's valid.
  const conns = await connectDatabases();
  const container = buildContainer(conns);
  await syncChatIndexes(container); // build the unique {itemId, participantIds} index etc.
  const app = createExpressApp(container);
  const httpServer = http.createServer(app);
  const io = attachSocket(httpServer, container);

  logger.info('application bootstrap complete');
  return { app, httpServer, io, container, conns };
}

export default bootstrap;
