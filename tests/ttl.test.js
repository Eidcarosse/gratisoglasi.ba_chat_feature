import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;
let convoId;
let migrateChatRetention;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
  buyerId = await seedUser(ctx, { firstname: 'B', lastname: 'Uyer', email: 'b@e.com' });
  sellerId = await seedUser(ctx, { firstname: 'S', lastname: 'Eller', email: 's@e.com' });
  itemId = await seedItem(ctx, {
    addedBy: sellerId,
    title: 'Bike',
    images: ['https://cdn/x.jpg'],
    hidden: false,
    status: 'Approved',
  });
  const c = await request(app)
    .post('/conversations')
    .set(auth(buyerId))
    .send({ itemId: String(itemId) });
  convoId = c.body.conversation._id;
  ({ migrateChatRetention } = await import('../src/loaders/chat.migrations.js'));
  await request(app)
    .post(`/conversations/${convoId}/messages`)
    .set(auth(buyerId))
    .send({ clientMessageId: randomUUID(), type: 'text', body: 'hi' });
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('30-day TTL retention', () => {
  it('stamps the conversation expiresAt ~30 days after creation', async () => {
    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    const convo = inbox.body.conversations.find((x) => x._id === convoId);
    expect(convo.expiresAt).toBeTruthy();
    const diff = new Date(convo.expiresAt).getTime() - new Date(convo.createdAt).getTime();
    expect(Math.abs(diff - THIRTY_DAYS_MS)).toBeLessThan(5000);
  });

  it('expires each message 30 days after that message was sent', async () => {
    const hist = await request(app).get(`/conversations/${convoId}/messages`).set(auth(buyerId));
    const m = hist.body.messages[0];
    expect(m.expiresAt).toBeTruthy();
    const diff = new Date(m.expiresAt).getTime() - new Date(m.createdAt).getTime();
    expect(Math.abs(diff - THIRTY_DAYS_MS)).toBeLessThan(1000);
  });

  it('keeps the conversation until its newest message expires', async () => {
    // Simulate an older conversation whose prior deadline is close, then send a fresh message.
    await mongoose.connection.collection('conversations').updateOne(
      { _id: new mongoose.Types.ObjectId(convoId) },
      { $set: { expiresAt: new Date(Date.now() + 60_000) } },
    );
    await request(app)
      .post(`/conversations/${convoId}/messages`)
      .set(auth(buyerId))
      .send({ clientMessageId: randomUUID(), type: 'text', body: 'fresh' });

    const convo = await mongoose.connection.collection('conversations').findOne({
      _id: new mongoose.Types.ObjectId(convoId),
    });
    const newest = await mongoose.connection.collection('messages').findOne(
      { conversationId: new mongoose.Types.ObjectId(convoId) },
      { sort: { _id: -1 } },
    );
    expect(convo.expiresAt.getTime()).toBe(newest.expiresAt.getTime());
  });

  it('does not move the conversation deadline backward on an out-of-order update', async () => {
    const conversationRepository = ctx.container.conversationService.repo;
    const newerExpiry = new Date(Date.now() + 2 * THIRTY_DAYS_MS);
    const olderExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const message = (messageId, createdAt) => ({
      messageId,
      body: 'message',
      senderId: buyerId,
      type: 'text',
      createdAt,
      deletedAt: null,
    });

    // Simulate the newer write completing first and an older in-flight write completing after it.
    await conversationRepository.applyNewMessage({
      conversationId: new mongoose.Types.ObjectId(convoId),
      lastMessage: message(new mongoose.Types.ObjectId(), new Date()),
      expiresAt: newerExpiry,
      recipientIds: [],
    });
    await conversationRepository.applyNewMessage({
      conversationId: new mongoose.Types.ObjectId(convoId),
      lastMessage: message(new mongoose.Types.ObjectId(), new Date()),
      expiresAt: olderExpiry,
      recipientIds: [],
    });

    const convo = await mongoose.connection.collection('conversations').findOne({
      _id: new mongoose.Types.ObjectId(convoId),
    });
    expect(convo.expiresAt.getTime()).toBe(newerExpiry.getTime());
  });

  it('backfills legacy message, active-conversation, and empty-conversation deadlines', async () => {
    const legacyExpiry = new Date(Date.now() + 60_000);
    const conversations = mongoose.connection.collection('conversations');
    const messages = mongoose.connection.collection('messages');
    await messages.updateMany(
      { conversationId: new mongoose.Types.ObjectId(convoId) },
      { $set: { expiresAt: legacyExpiry } },
    );
    await conversations.updateOne(
      { _id: new mongoose.Types.ObjectId(convoId) },
      { $set: { expiresAt: legacyExpiry } },
    );

    const emptyId = new mongoose.Types.ObjectId();
    const emptyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await conversations.insertOne({
      _id: emptyId,
      itemId: new mongoose.Types.ObjectId(),
      pairKey: randomUUID(),
      participantIds: [buyerId, sellerId],
      createdAt: emptyCreatedAt,
      updatedAt: emptyCreatedAt,
      expiresAt: legacyExpiry,
    });

    await migrateChatRetention();
    await migrateChatRetention(); // safe to rerun on every process start

    const migratedMessages = await messages
      .find({ conversationId: new mongoose.Types.ObjectId(convoId) })
      .toArray();
    for (const message of migratedMessages) {
      expect(message.expiresAt.getTime()).toBe(
        message.createdAt.getTime() + THIRTY_DAYS_MS,
      );
    }
    const migratedConversation = await conversations.findOne({
      _id: new mongoose.Types.ObjectId(convoId),
    });
    expect(migratedConversation.expiresAt.getTime()).toBe(
      Math.max(...migratedMessages.map((message) => message.expiresAt.getTime())),
    );

    const migratedEmpty = await conversations.findOne({ _id: emptyId });
    expect(migratedEmpty.expiresAt.getTime()).toBe(
      emptyCreatedAt.getTime() + THIRTY_DAYS_MS,
    );
  });

  it('declares a TTL index on both collections', async () => {
    for (const name of ['conversations', 'messages']) {
      const indexes = await mongoose.connection.collection(name).indexes();
      const ttl = indexes.find((i) => i.key && i.key.expiresAt === 1);
      expect(ttl, `expiresAt TTL index on ${name}`).toBeTruthy();
      expect(ttl.expireAfterSeconds).toBe(0);
    }
  });
});
