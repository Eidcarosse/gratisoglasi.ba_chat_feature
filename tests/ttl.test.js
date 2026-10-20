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
  await request(app)
    .post(`/conversations/${convoId}/messages`)
    .set(auth(buyerId))
    .send({ clientMessageId: randomUUID(), type: 'text', body: 'hi' });
});

afterAll(async () => {
  await ctx.shutdown();
});

// Retention is stored as `expiresAt` on the shared rows; the TTL indexes themselves belong to the Fastify repo.
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
    await mongoose.connection.collection('chat_rooms').updateOne(
      { _id: new mongoose.Types.ObjectId(convoId) },
      { $set: { expiresAt: new Date(Date.now() + 60_000) } },
    );
    await request(app)
      .post(`/conversations/${convoId}/messages`)
      .set(auth(buyerId))
      .send({ clientMessageId: randomUUID(), type: 'text', body: 'fresh' });

    const convo = await mongoose.connection.collection('chat_rooms').findOne({
      _id: new mongoose.Types.ObjectId(convoId),
    });
    const newest = await mongoose.connection.collection('messages').findOne(
      { roomId: new mongoose.Types.ObjectId(convoId) },
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

    const convo = await mongoose.connection.collection('chat_rooms').findOne({
      _id: new mongoose.Types.ObjectId(convoId),
    });
    expect(convo.expiresAt.getTime()).toBe(newerExpiry.getTime());
  });
});
