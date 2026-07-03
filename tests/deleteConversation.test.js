import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const inboxHas = async (userId, id) => {
  const res = await request(app).get('/conversations').set(auth(userId));
  return res.body.conversations.some((c) => c._id === id);
};
const historyBodies = async (userId, id) => {
  const res = await request(app).get(`/conversations/${id}/messages`).set(auth(userId));
  return res.body.messages.map((m) => m.body); // newest-first
};
const send = (userId, id, body) =>
  request(app)
    .post(`/conversations/${id}/messages`)
    .set(auth(userId))
    .send({ clientMessageId: randomUUID(), type: 'text', body });

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
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('delete conversation (hide for me)', () => {
  it('hides from my inbox only; a new message resurfaces it', async () => {
    const c = await request(app)
      .post('/conversations')
      .set(auth(buyerId))
      .send({ itemId: String(itemId) });
    const id = c.body.conversation._id;

    expect(await inboxHas(buyerId, id)).toBe(true);

    const del = await request(app).delete(`/conversations/${id}`).set(auth(buyerId));
    expect(del.status).toBe(200);

    // Gone from the buyer's inbox, still present for the seller.
    expect(await inboxHas(buyerId, id)).toBe(false);
    expect(await inboxHas(sellerId, id)).toBe(true);

    // The seller sends a message → the thread resurfaces for the buyer.
    await request(app)
      .post(`/conversations/${id}/messages`)
      .set(auth(sellerId))
      .send({ clientMessageId: randomUUID(), type: 'text', body: 'still there?' });

    expect(await inboxHas(buyerId, id)).toBe(true);
  });

  it('clears MY message history at the delete point; the other user still sees everything', async () => {
    // Fresh pair so history is isolated from the resurface test above.
    const buyer2 = await seedUser(ctx, { firstname: 'C', lastname: 'Lear', email: 'c@e.com' });
    const item2 = await seedItem(ctx, {
      addedBy: sellerId,
      title: 'Car',
      images: [],
      hidden: false,
      status: 'Approved',
    });
    const c = await request(app)
      .post('/conversations')
      .set(auth(buyer2))
      .send({ itemId: String(item2) });
    const id = c.body.conversation._id;

    // Three messages exist before the delete.
    await send(buyer2, id, 'old-1');
    await send(sellerId, id, 'old-2');
    await send(buyer2, id, 'old-3');
    expect(await historyBodies(buyer2, id)).toHaveLength(3);

    // buyer2 deletes the conversation.
    const del = await request(app).delete(`/conversations/${id}`).set(auth(buyer2));
    expect(del.status).toBe(200);

    // buyer2's history is now empty; the seller still sees all three.
    expect(await historyBodies(buyer2, id)).toEqual([]);
    expect(await historyBodies(sellerId, id)).toHaveLength(3);

    // A new message resurfaces the thread for buyer2 — but only the post-delete message shows.
    await send(sellerId, id, 'new-1');
    expect(await inboxHas(buyer2, id)).toBe(true);
    expect(await historyBodies(buyer2, id)).toEqual(['new-1']);
    // The seller's view is unaffected — all four messages.
    expect(await historyBodies(sellerId, id)).toHaveLength(4);
  });
});
