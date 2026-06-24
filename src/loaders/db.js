/**
 * Layer: Loader (was mongoose.js).
 * Builds TWO Mongoose connections:
 *   - chat   (default connection) → config.CHAT_MONGO_URI — READ-WRITE. Owns conversations,
 *            messages, devices. Index sync runs here.
 *   - gratis (separate connection) → config.GRATIS_MONGO_URI — READ-ONLY. The main-site Gratis
 *            DB (users, items). autoIndex/autoCreate are OFF so a read-only DB user is never
 *            asked to run DDL, and we never mutate the main DB.
 * Cross-DB .populate() is impossible across two connections — main-site data is resolved
 * explicitly via the gratis integration layer. Exposes connection state for /readyz.
 * Must NOT hold business logic.
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { logger } from '../common/logger.js';

mongoose.set('strictQuery', true);

function wireEvents(conn, label) {
  conn.on('connected', () => logger.info({ db: label }, 'mongo connected'));
  conn.on('disconnected', () => logger.warn({ db: label }, 'mongo disconnected'));
  conn.on('error', (err) => logger.error({ db: label, err }, 'mongo connection error'));
}

let chatConn;
let gratisConn;

/**
 * Connect both databases. Returns { chatConn, gratisConn }. Awaits both being ready so that
 * traffic is only served once the data layer is actually reachable.
 */
export async function connectDatabases() {
  // Default connection (mongoose.connection) → chat DB. Using the default connection lets chat
  // models register via the plain `mongoose.model(...)` registry.
  await mongoose.connect(config.CHAT_MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  chatConn = mongoose.connection;
  wireEvents(chatConn, 'chat');

  // Separate, read-only connection → main Gratis DB. Never syncs indexes / creates collections.
  gratisConn = mongoose.createConnection(config.GRATIS_MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
    autoCreate: false,
  });
  wireEvents(gratisConn, 'gratis');
  await gratisConn.asPromise();

  logger.info('both database connections established');
  return { chatConn, gratisConn };
}

export function getConnections() {
  return { chatConn, gratisConn };
}

/**
 * Readiness probe for /readyz: ready only when BOTH connections report connected (readyState 1).
 */
export function databasesReady() {
  return chatConn?.readyState === 1 && gratisConn?.readyState === 1;
}

export async function closeDatabases() {
  await Promise.allSettled([
    chatConn ? mongoose.disconnect() : Promise.resolve(),
    gratisConn ? gratisConn.close() : Promise.resolve(),
  ]);
  logger.info('database connections closed');
}
