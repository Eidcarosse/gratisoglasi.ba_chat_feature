/**
 * Test harness: boots the real app against an in-memory replica set holding ONE database in the shared
 * (Fastify) schema — the same topology as production now that the chat service no longer has its own DB.
 * Fixtures are still described in the terms the tests were written in (item price in BAM, image URLs, the
 * 'Approved' status label, embedded bids); the seed helpers translate them into Fastify-shaped documents
 * (`ads`, `bids`, `users`), so the assertions exercise the same legacy-shaped API as before.
 * Env is set BEFORE importing config so the dynamic import of the loaders picks up the test URI.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const MODERATION = { Approved: 'approved', Pending: 'pending', Review: 'rejected' };

/** 'https://cdn/bike1.jpg' -> 'bike1' (the Cloudflare image id the shared schema stores). */
export const imageIdOf = (url) => String(url).split('/').pop().replace(/\.\w+$/, '');

export async function bootTestApp({ authMode = 'dev', jwtSecret, env = {} } = {}) {
  // Transactions are part of the production write path, so tests must use a replica set.
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongod.getUri('Shared');

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  process.env.PORT = '4555'; // unused — tests never call listen()
  process.env.MONGO_URI = mongoUri;
  process.env.AUTH_MODE = authMode;
  process.env.CF_IMAGES_ACCOUNT_HASH = 'testhash';
  process.env.CORS_ORIGINS = '*';
  Object.assign(process.env, env);
  if (jwtSecret) process.env.JWT_SECRET = jwtSecret;

  // Dynamic imports AFTER env is set so config validates the test environment.
  const { bootstrap } = await import('../../src/loaders/index.js');
  const { closeDatabases } = await import('../../src/loaders/db.js');
  const booted = await bootstrap();

  // The service never builds indexes (Fastify's scripts/indexes.ts owns them in real deployments); the
  // ones its idempotency and dedup rely on are created here.
  const db = mongoose.connection.db;
  await db.collection('chat_rooms').createIndex({ adId: 1, buyerId: 1 }, { unique: true });
  await db.collection('messages').createIndex({ roomId: 1, clientMessageId: 1 }, { unique: true });
  await db.collection('messages').createIndex({ roomId: 1, createdAt: 1, _id: 1 });
  await db.collection('blocks').createIndex({ blockerId: 1, blockedId: 1 }, { unique: true });
  await db.collection('devices').createIndex({ token: 1 }, { unique: true });

  const SeedUser = db.collection('users');
  const SeedItem = db.collection('ads');
  const SeedBid = db.collection('bids');

  async function shutdown() {
    await booted.io.close();
    await closeDatabases();
    await mongod.stop();
  }

  return { ...booted, mongoUri, db, SeedUser, SeedItem, SeedBid, shutdown };
}

/** Insert a user into `users` (shared schema); returns its ObjectId. */
export async function seedUser(ctx, fields = {}) {
  const _id = new mongoose.Types.ObjectId();
  const { showEmail, profilePicture, ...rest } = fields;
  const now = new Date();
  await ctx.SeedUser.insertOne({
    _id,
    firebaseUid: String(_id),
    emailVerified: true,
    firstname: '',
    lastname: '',
    cityId: null,
    cityName: '',
    contact: { phone: null, whatsapp: null, viber: null },
    socials: { facebook: null, instagram: null, tiktok: null, twitter: null },
    status: 'active',
    roles: [],
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...rest,
    profilePicture: profilePicture ? imageIdOf(profilePicture) : null,
    privacy: { showAllAds: true, showEmail: showEmail !== false },
  });
  return _id;
}

/** Insert an ad into `ads` (+ its embedded-style `bids` as `bids` rows); returns the ad's ObjectId. */
export async function seedItem(ctx, fields = {}) {
  const _id = new mongoose.Types.ObjectId();
  const { addedBy, title, price, images = [], hidden = false, status = 'Approved', bids = [], ...rest } = fields;
  const now = new Date();
  await ctx.SeedItem.insertOne({
    _id,
    addedBy,
    title,
    description: '',
    priceMinor: price == null ? null : Math.round(price * 100),
    currency: 'BAM',
    status: hidden ? 'hidden' : 'active',
    expiresAt: new Date('2124-01-01'),
    moderation: { state: MODERATION[status] ?? 'approved', reviewedBy: null, reviewedAt: null, reason: null },
    images: images.map((url, order) => ({ id: imageIdOf(url), order, width: null, height: null })),
    bumpedAt: now,
    firstPublished: now,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    ...rest,
  });
  for (const bid of bids) {
    const accepted = bid.status === 'accepted';
    await ctx.SeedBid.insertOne({
      adId: _id,
      bidderId: bid.bidder,
      amountMinor: Math.round((bid.amount ?? 0) * 100),
      currency: 'BAM',
      status: 'active',
      acceptedAt: accepted ? now : null,
      rejectedAt: bid.status === 'rejected' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return _id;
}

/** Update a seeded ad in place (for the open-refresh test): `price` in BAM, `status` as the moderation label. */
export async function updateItem(ctx, id, set) {
  const patch = { ...set };
  if ('price' in patch) {
    patch.priceMinor = patch.price == null ? null : Math.round(patch.price * 100);
    delete patch.price;
  }
  if ('status' in patch) {
    patch['moderation.state'] = MODERATION[patch.status] ?? 'approved';
    delete patch.status;
  }
  if ('hidden' in patch) {
    patch.status = patch.hidden ? 'hidden' : 'active';
    delete patch.hidden;
  }
  await ctx.SeedItem.updateOne({ _id: id }, { $set: patch });
}

/** The main site now soft-deletes ads (status 'deleted'); the chat treats that as a missing item. */
export async function deleteItem(ctx, id) {
  await ctx.SeedItem.updateOne({ _id: id }, { $set: { status: 'deleted', deletedAt: new Date() } });
}
