/**
 * Layer: Loader.
 * ONE Mongoose connection to the shared database (config.MONGO_URI) — the same MongoDB the Fastify BE
 * and the legacy main BE use. Fastify's scripts/indexes.ts owns every index and collection, so this
 * service runs with autoIndex/autoCreate OFF and never builds or syncs indexes.
 * `chatConn` and `gratisConn` both name that single connection: the chat module code and the main-site
 * integration keep their separate names, but there is no longer a second database.
 * Must NOT hold business logic.
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { logger } from '../common/logger.js';

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
// Legacy clients send ids in odd shapes; unknown filter paths must reach Mongo, not be stripped.
mongoose.set('strictQuery', false);

let conn;

/** Connect the shared database. Returns { chatConn, gratisConn } (the same connection twice). */
export async function connectDatabases() {
  await mongoose.connect(config.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
    autoCreate: false,
  });
  conn = mongoose.connection;
  conn.on('connected', () => logger.info('mongo connected'));
  conn.on('disconnected', () => logger.warn('mongo disconnected'));
  conn.on('error', (err) => logger.error({ err }, 'mongo connection error'));

  logger.info('database connection established');
  return getConnections();
}

export function getConnections() {
  return { chatConn: conn, gratisConn: conn };
}

/** Readiness probe for /readyz: ready only when the connection reports connected (readyState 1). */
export function databasesReady() {
  return conn?.readyState === 1;
}

export async function closeDatabases() {
  if (conn) await mongoose.disconnect();
  logger.info('database connection closed');
}
