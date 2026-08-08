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

  it('removes the conversation and messages after both participants delete it', async () => {
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

    expect(await mongoose.connection.collection('conversations').findOne({
      _id: new mongoose.Types.ObjectId(id),
    })).toBeNull();
    expect(await mongoose.connection.collection('messages').countDocuments({
      conversationId: new mongoose.Types.ObjectId(id),
    })).toBe(0);
  });

  it('does not leave an orphan message when a send overlaps final deletion', async () => {
    const buyer4 = await seedUser(ctx, { firstname: 'R', lastname: 'Ace', email: 'race@e.com' });
    const item4 = await seedItem(ctx, {
      addedBy: sellerId,
      title: 'Lamp',
      images: [],
      hidden: false,
      status: 'Approved',
    });
    const c = await request(app)
      .post('/conversations')
      .set(auth(buyer4))
      .send({ itemId: String(item4) });
    const id = c.body.conversation._id;
    await send(buyer4, id, 'before delete');
    expect((await request(app).delete(`/conversations/${id}`).set(auth(buyer4))).status).toBe(200);

    const messageRepository = ctx.container.messageService.repo;
    const originalAppend = messageRepository.append.bind(messageRepository);

    let appendEntered;
    const appendStarted = new Promise((resolve) => {
      appendEntered = resolve;
    });
    let releaseAppend;
    const appendReleased = new Promise((resolve) => {
      releaseAppend = resolve;
    });

    messageRepository.append = async (...args) => {
      const result = await originalAppend(...args);
      appendEntered();
      await appendReleased;
      return result;
    };

    let sendResponse;
    let deleteResponse;
    try {
      const sending = send(buyer4, id, 'in flight').then((res) => res);
      await appendStarted;

      const deleting = request(app)
        .delete(`/conversations/${id}`)
        .set(auth(sellerId))
        .then((res) => res);
      // Let the delete request enter its transaction while the send is paused after append.
      await new Promise((resolve) => setImmediate(resolve));
      releaseAppend();

      [sendResponse, deleteResponse] = await Promise.all([sending, deleting]);
    } finally {
      releaseAppend();
      messageRepository.append = originalAppend;
    }

    expect(deleteResponse.status).toBe(200);
    // Depending on transaction ordering, the send either commits before deletion (201) or is
    // rejected after the deleted conversation is observed (404). A committed send can also
    // resurface the thread before the delete transaction retries; neither outcome may orphan data.
    expect([201, 404]).toContain(sendResponse.status);
    const conversation = await mongoose.connection.collection('conversations').findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    const messageCount = await mongoose.connection.collection('messages').countDocuments({
      conversationId: new mongoose.Types.ObjectId(id),
    });
    // If the conversation committed deletion, its partition must be gone. If the send won and
    // resurfaced the conversation, its messages must still have a live parent.
    if (conversation) expect(messageCount).toBeGreaterThan(0);
    else expect(messageCount).toBe(0);
  });

  it('rolls back the conversation delete when message cleanup fails', async () => {
    const buyer5 = await seedUser(ctx, { firstname: 'T', lastname: 'Ransact', email: 'tx@e.com' });
    const item5 = await seedItem(ctx, {
      addedBy: sellerId,
      title: 'Chair',
      images: [],
      hidden: false,
      status: 'Approved',
    });
    const c = await request(app)
      .post('/conversations')
      .set(auth(buyer5))
      .send({ itemId: String(item5) });
    const id = c.body.conversation._id;
    await send(buyer5, id, 'keep me until rollback');
    expect((await request(app).delete(`/conversations/${id}`).set(auth(buyer5))).status).toBe(200);

    const messageRepository = ctx.container.messageService.repo;
    const originalDeleteByConversation = messageRepository.deleteByConversation.bind(
      messageRepository,
    );
    messageRepository.deleteByConversation = async (...args) => {
      await originalDeleteByConversation(...args);
      throw new Error('simulated cleanup failure');
    };

    let failed;
    try {
      failed = await request(app).delete(`/conversations/${id}`).set(auth(sellerId));
    } finally {
      messageRepository.deleteByConversation = originalDeleteByConversation;
    }

    expect(failed.status).toBe(500);
    const restored = await mongoose.connection.collection('conversations').findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    expect(restored).toBeTruthy();
    expect(restored.deletedFor.map(String)).toEqual([String(buyer5)]);
    expect(await mongoose.connection.collection('messages').countDocuments({
      conversationId: new mongoose.Types.ObjectId(id),
    })).toBe(1);

    // Once cleanup is available again, the same delete completes atomically.
    expect((await request(app).delete(`/conversations/${id}`).set(auth(sellerId))).status).toBe(200);
    expect(await mongoose.connection.collection('conversations').findOne({
      _id: new mongoose.Types.ObjectId(id),
    })).toBeNull();
    expect(await mongoose.connection.collection('messages').countDocuments({
      conversationId: new mongoose.Types.ObjectId(id),
    })).toBe(0);
  });
});
