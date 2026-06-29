import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;
let convoId;
let convoCreatedAt;

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
  convoCreatedAt = new Date(c.body.conversation.createdAt).getTime();
  await request(app)
    .post(`/conversations/${convoId}/messages`)
    .set(auth(buyerId))
    .send({ clientMessageId: randomUUID(), type: 'text', body: 'hi' });
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('7-day TTL (auto-delete since creation)', () => {
  it('stamps the conversation expiresAt ~7 days after creation', async () => {
    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    const convo = inbox.body.conversations.find((x) => x._id === convoId);
    expect(convo.expiresAt).toBeTruthy();
    const diff = new Date(convo.expiresAt).getTime() - new Date(convo.createdAt).getTime();
    expect(Math.abs(diff - SEVEN_DAYS_MS)).toBeLessThan(5000);
  });

  it('aligns each message expiresAt to the conversation creation + 7 days', async () => {
    const hist = await request(app).get(`/conversations/${convoId}/messages`).set(auth(buyerId));
    const m = hist.body.messages[0];
    expect(m.expiresAt).toBeTruthy();
    const diff = new Date(m.expiresAt).getTime() - convoCreatedAt;
    expect(Math.abs(diff - SEVEN_DAYS_MS)).toBeLessThan(1000);
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
