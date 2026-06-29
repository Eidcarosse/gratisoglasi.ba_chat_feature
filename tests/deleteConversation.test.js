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
});
