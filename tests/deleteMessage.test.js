import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;
let convoId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const sendAs = (userId, body) =>
  request(app).post(`/conversations/${convoId}/messages`).set(auth(userId)).send(body);

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
  const res = await request(app)
    .post('/conversations')
    .set(auth(buyerId))
    .send({ itemId: String(itemId) });
  convoId = res.body.conversation._id;
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('unsend (delete message for everyone)', () => {
  let msgId;

  it('lets the sender unsend; the message becomes a tombstone in history', async () => {
    const s = await sendAs(buyerId, { clientMessageId: randomUUID(), type: 'text', body: 'oops' });
    msgId = s.body.message._id;

    const del = await request(app)
      .delete(`/conversations/${convoId}/messages/${msgId}`)
      .set(auth(buyerId));
    expect(del.status).toBe(200);

    const hist = await request(app).get(`/conversations/${convoId}/messages`).set(auth(buyerId));
    const m = hist.body.messages.find((x) => x._id === msgId);
    expect(m).toBeTruthy();
    expect(m.deletedAt).toBeTruthy();
    expect(m.body).toBe('');
    expect(m.attachments).toHaveLength(0);
  });

  it('forbids a non-sender (but member) from unsending', async () => {
    const s = await sendAs(buyerId, { clientMessageId: randomUUID(), type: 'text', body: 'mine' });
    const id = s.body.message._id;
    const del = await request(app)
      .delete(`/conversations/${convoId}/messages/${id}`)
      .set(auth(sellerId));
    expect(del.status).toBe(403);
  });

  it('404s for a non-existent message', async () => {
    const del = await request(app)
      .delete(`/conversations/${convoId}/messages/${new mongoose.Types.ObjectId()}`)
      .set(auth(buyerId));
    expect(del.status).toBe(404);
  });

  it('is idempotent (second unsend still 200)', async () => {
    const del = await request(app)
      .delete(`/conversations/${convoId}/messages/${msgId}`)
      .set(auth(buyerId));
    expect(del.status).toBe(200);
  });

  it('recomputes the inbox preview when the last message is unsent', async () => {
    const s = await sendAs(buyerId, { clientMessageId: randomUUID(), type: 'text', body: 'latest' });
    const id = s.body.message._id;
    await request(app).delete(`/conversations/${convoId}/messages/${id}`).set(auth(buyerId));

    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    const convo = inbox.body.conversations.find((c) => c._id === convoId);
    expect(convo.lastMessage.messageId).toBe(id);
    expect(convo.lastMessage.deletedAt).toBeTruthy();
  });
});
