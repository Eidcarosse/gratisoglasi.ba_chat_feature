import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
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

  it('is soft only: when both participants delete a thread nothing is removed (the TTL ages it out later)', async () => {
    const buyer3 = await seedUser(ctx, { firstname: 'D', lastname: 'Elete', email: 'd@e.com' });
    const item3 = await seedItem(ctx, {
      addedBy: sellerId,
      title: 'Desk',
      images: [],
      hidden: false,
      status: 'Approved',
    });
    const c = await request(app)
      .post('/conversations')
      .set(auth(buyer3))
      .send({ itemId: String(item3) });
    const id = c.body.conversation._id;
    await send(buyer3, id, 'remove me');

    expect((await request(app).delete(`/conversations/${id}`).set(auth(buyer3))).status).toBe(200);
    expect((await request(app).delete(`/conversations/${id}`).set(auth(sellerId))).status).toBe(200);

    const room = await mongoose.connection.collection('chat_rooms').findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    expect(room).toBeTruthy();
    expect(room.buyerArchivedAt).toBeInstanceOf(Date);
    expect(room.sellerArchivedAt).toBeInstanceOf(Date);
    expect(room.buyerClearedTo).toBeTruthy();
    expect(room.sellerClearedTo).toBeTruthy();
    expect(await mongoose.connection.collection('messages').countDocuments({
      roomId: new mongoose.Types.ObjectId(id),
    })).toBe(1);
    expect(await inboxHas(buyer3, id)).toBe(false);
    expect(await inboxHas(sellerId, id)).toBe(false);
    expect(await historyBodies(buyer3, id)).toEqual([]);
    expect(await historyBodies(sellerId, id)).toEqual([]);

    // Either side writing again brings the thread back for both; the old messages stay hidden.
    await send(sellerId, id, 'hello again');
    expect(await inboxHas(buyer3, id)).toBe(true);
    expect(await historyBodies(buyer3, id)).toEqual(['hello again']);
  });

  it('keeps an empty conversation after both participants delete it', async () => {
    const buyerEmpty = await seedUser(ctx, { firstname: 'E', lastname: 'Mpty', email: 'empty@e.com' });
    const itemEmpty = await seedItem(ctx, {
      addedBy: sellerId,
      title: 'Empty room item',
      images: [],
      hidden: false,
      status: 'Approved',
    });
    const c = await request(app)
      .post('/conversations')
      .set(auth(buyerEmpty))
      .send({ itemId: String(itemEmpty) });
    const id = c.body.conversation._id;

    expect((await request(app).delete(`/conversations/${id}`).set(auth(buyerEmpty))).status).toBe(200);
    expect((await request(app).delete(`/conversations/${id}`).set(auth(sellerId))).status).toBe(200);

    const conversation = await mongoose.connection.collection('chat_rooms').findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    expect(conversation).toBeTruthy();
    expect(conversation.lastMessage).toBeNull();
    expect(conversation.buyerClearedTo).toBeNull(); // nothing to clear on an empty thread
    expect(await mongoose.connection.collection('messages').countDocuments({
      roomId: new mongoose.Types.ObjectId(id),
    })).toBe(0);
  });

  it('a send that overlaps a delete never leaves an orphan or a hidden new message', async () => {
    const buyer4 = await seedUser(ctx, { firstname: 'R', lastname: 'Ace', email: 'race@e.com' });
    const item4 = await seedItem(ctx, { addedBy: sellerId, title: 'Lamp', images: [], hidden: false, status: 'Approved' });
    const c = await request(app).post('/conversations').set(auth(buyer4)).send({ itemId: String(item4) });
    const id = c.body.conversation._id;
    await send(buyer4, id, 'before delete');
    expect((await request(app).delete(`/conversations/${id}`).set(auth(buyer4))).status).toBe(200);

    const [sent, deleted] = await Promise.all([
      send(buyer4, id, 'in flight'),
      request(app).delete(`/conversations/${id}`).set(auth(sellerId)),
    ]);
    expect(sent.status).toBe(201);
    expect(deleted.status).toBe(200);
    const room = await mongoose.connection.collection('chat_rooms').findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(room).toBeTruthy();
    expect(await mongoose.connection.collection('messages').countDocuments({ roomId: room._id })).toBe(2);
    // The message sent after the buyer's delete is visible to the buyer, whichever order the seller's delete landed in.
    expect(await historyBodies(buyer4, id)).toEqual(['in flight']);
  });
});
