import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

let ctx;
let app;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });

beforeAll(async () => {
  ctx = await bootTestApp({ env: { CHAT_TTL_DAYS: '0' } });
  app = ctx.app;
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('CHAT_TTL_DAYS=0 (same switch as the Fastify BE)', () => {
  it('stores no expiry on rooms or messages', async () => {
    const buyer = await seedUser(ctx, { firstname: 'B', lastname: 'Uyer' });
    const seller = await seedUser(ctx, { firstname: 'S', lastname: 'Eller' });
    const item = await seedItem(ctx, { addedBy: seller, title: 'Bike', images: [], hidden: false, status: 'Approved' });
    const c = await request(app).post('/conversations').set(auth(buyer)).send({ itemId: String(item) });
    const id = c.body.conversation._id;
    const sent = await request(app)
      .post(`/conversations/${id}/messages`)
      .set(auth(buyer))
      .send({ clientMessageId: randomUUID(), type: 'text', body: 'hi' });
    expect(sent.status).toBe(201);

    const room = await mongoose.connection.collection('chat_rooms').findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(room.expiresAt).toBeNull();
    const message = await mongoose.connection.collection('messages').findOne({ roomId: room._id });
    expect(message.expiresAt).toBeNull();
  });
});
