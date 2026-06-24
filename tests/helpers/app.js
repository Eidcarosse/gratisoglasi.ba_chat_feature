/**
 * Test harness: boots the real app against an in-memory mongod with TWO databases on one
 * instance (GratisChat = chat DB, Gratis = main-site read-only DB) — exercising the two-connection
 * topology without a real Atlas cluster. Env is set BEFORE importing config so the dynamic import
 * of the loaders picks up the test URIs.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

export async function bootTestApp({ authMode = 'dev', jwtSecret } = {}) {
  const mongod = await MongoMemoryServer.create();
  const base = mongod.getUri(); // mongodb://127.0.0.1:port/
  const chatUri = `${base}GratisChat`;
  const gratisUri = `${base}Gratis`;

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  process.env.PORT = '4555'; // unused — tests never call listen()
  process.env.CHAT_MONGO_URI = chatUri;
  process.env.GRATIS_MONGO_URI = gratisUri;
  process.env.AUTH_MODE = authMode;
  if (jwtSecret) process.env.JWT_SECRET = jwtSecret;
  process.env.CORS_ORIGINS = '*';

  // Dynamic imports AFTER env is set so config validates the test environment.
  const { bootstrap } = await import('../../src/loaders/index.js');
  const { closeDatabases } = await import('../../src/loaders/db.js');
  const booted = await bootstrap();

  // Separate WRITE connection to the Gratis DB for seeding (the app itself never writes there).
  const seedConn = mongoose.createConnection(gratisUri);
  await seedConn.asPromise();
  const SeedUser = seedConn.collection('users');
  const SeedItem = seedConn.collection('items');

  async function shutdown() {
    await seedConn.close();
    await booted.io.close();
    await closeDatabases();
    await mongod.stop();
  }

  return { ...booted, chatUri, gratisUri, seedConn, SeedUser, SeedItem, shutdown };
}

/** Insert a user doc into the Gratis `users` collection; returns its ObjectId. */
export async function seedUser(ctx, fields) {
  const _id = new mongoose.Types.ObjectId();
  await ctx.SeedUser.insertOne({ _id, ...fields });
  return _id;
}

/** Insert an item doc into the Gratis `items` collection; returns its ObjectId. */
export async function seedItem(ctx, fields) {
  const _id = new mongoose.Types.ObjectId();
  await ctx.SeedItem.insertOne({ _id, ...fields });
  return _id;
}

/** Update a seeded item in place (for the open-refresh test). */
export async function updateItem(ctx, id, set) {
  await ctx.SeedItem.updateOne({ _id: id }, { $set: set });
}
