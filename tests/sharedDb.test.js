import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem, deleteItem } from './helpers/app.js';

/**
 * The chat service on the shared (Fastify-schema) database: what it WRITES must be exactly what the Fastify
 * BE would have written, what it READS must include what Fastify wrote, and what clients SEE must stay the
 * legacy shape.
 */
let ctx;
let app;
let db;
let buyerId;
let sellerId;
let itemId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const open = async (buyer = buyerId, item = itemId) =>
  (await request(app).post('/conversations').set(auth(buyer)).send({ itemId: String(item) })).body.conversation;
const send = (userId, id, body, extra = {}) =>
  request(app)
    .post(`/conversations/${id}/messages`)
    .set(auth(userId))
    .send({ clientMessageId: randomUUID(), type: 'text', body, ...extra });
const room = (id) => db.collection('chat_rooms').findOne({ _id: oid(id) });

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
  db = ctx.db;
  buyerId = await seedUser(ctx, { firstname: 'Aida', lastname: 'Buyer', email: 'aida@example.com', profilePicture: 'https://cdn/aida.png' });
  sellerId = await seedUser(ctx, { firstname: 'Sam', lastname: 'Seller', email: 'sam@example.com' });
  itemId = await seedItem(ctx, { addedBy: sellerId, title: 'Vintage bike', price: 120.5, images: ['https://cdn/bike1.jpg'], hidden: false, status: 'Approved' });
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('what the chat service writes (the Fastify shape)', () => {
  it('opens one shared room per (ad, buyer) with the ad snapshot and every Fastify default', async () => {
    const c = await open();
    const stored = await room(c._id);
    expect(stored).toMatchObject({
      adId: itemId,
      buyerId,
      sellerId,
      adTitle: 'Vintage bike',
      adImageId: 'bike1',
      adPriceMinor: 12050,
      lastMessage: null,
      buyerLastRead: null,
      sellerLastRead: null,
      buyerUnreadCount: 0,
      sellerUnreadCount: 0,
      buyerArchivedAt: null,
      sellerArchivedAt: null,
      buyerMutedAt: null,
      sellerMutedAt: null,
      buyerClearedTo: null,
      sellerClearedTo: null,
      schemaVersion: 1,
    });
    expect(stored.lastMessageAt).toBeInstanceOf(Date); // seeded so the fresh room is in both inboxes
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeGreaterThan(29 * 86_400_000);
    expect((await open())._id).toBe(c._id);
    expect(await db.collection('chat_rooms').countDocuments({ adId: itemId, buyerId })).toBe(1);
  });

  it('a sent message is one messages row + one message.sent outbox event that must not push again', async () => {
    const c = await open();
    const clientMessageId = randomUUID();
    const res = await send(buyerId, c._id, 'hello <b>there</b> $100', { clientMessageId });
    expect(res.status).toBe(201);

    const row = await db.collection('messages').findOne({ clientMessageId });
    expect(row).toMatchObject({ roomId: oid(c._id), senderId: buyerId, type: 'text', deletedAt: null, schemaVersion: 2 });
    expect(row.text).toBe('hello <b>there</b> $100'); // stored RAW
    expect(row.attachments).toEqual([]);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 86_400_000);

    const event = await db.collection('outbox').findOne({ aggregateId: row._id });
    expect(event).toMatchObject({ type: 'message.sent', status: 'pending', attempts: 0 });
    expect(event.payload).toMatchObject({ roomId: oid(c._id), senderId: buyerId, recipientId: sellerId, clientMessageId, pushRequested: false });

    const r = await room(c._id);
    expect(r.lastMessage).toMatchObject({ messageId: row._id, text: 'hello <b>there</b> $100', type: 'text', senderId: buyerId });
    expect(r.lastMessage.at).toEqual(row.createdAt);
    expect(r.lastMessageAt).toEqual(row.createdAt);
    expect(r.sellerUnreadCount).toBe(1);
    expect(r.buyerUnreadCount).toBe(0);
    expect(r.expiresAt).toEqual(row.expiresAt);
  });

  it('clients still see the escaped text everywhere (REST send, history, inbox preview, open)', async () => {
    const c = await open();
    const res = await send(sellerId, c._id, 'a <script> b');
    expect(res.body.message.body).toBe('a &lt;script&gt; b');
    const history = await request(app).get(`/conversations/${c._id}/messages`).set(auth(buyerId));
    expect(history.body.messages[0].body).toBe('a &lt;script&gt; b');
    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    expect(inbox.body.conversations.find((x) => x._id === c._id).lastMessage.body).toBe('a &lt;script&gt; b');
    const one = await request(app).get(`/conversations/${c._id}`).set(auth(buyerId));
    expect(one.body.conversation.lastMessage.body).toBe('a &lt;script&gt; b');
  });

  it('rejects the retired file message type with the usual validation error', async () => {
    const c = await open();
    const res = await send(buyerId, c._id, 'x.pdf', { type: 'file', attachments: [{ key: 'k', url: 'https://x.test/k', mime: 'application/pdf', size: 1 }] });
    expect(res.status).toBe(400);
  });

  it('a resend with the same clientMessageId is a no-op, even when two arrive at once', async () => {
    const c = await open();
    const clientMessageId = randomUUID();
    const [a, b] = await Promise.all([send(buyerId, c._id, 'once', { clientMessageId }), send(buyerId, c._id, 'once', { clientMessageId })]);
    expect([a.status, b.status].every((s) => s === 201)).toBe(true);
    expect(a.body.message._id).toBe(b.body.message._id);
    expect(await db.collection('messages').countDocuments({ clientMessageId })).toBe(1);
    expect(await db.collection('outbox').countDocuments({ 'payload.clientMessageId': clientMessageId })).toBe(1);
    const r = await room(c._id);
    expect(r.sellerUnreadCount).toBeGreaterThanOrEqual(1);
    const again = await send(buyerId, c._id, 'once', { clientMessageId });
    expect(again.body.message._id).toBe(a.body.message._id);
    expect((await room(c._id)).sellerUnreadCount).toBe(r.sellerUnreadCount); // no second increment
  });

  it('images are stored as Cloudflare ids and come back as delivery URLs', async () => {
    const c = await open();
    const res = await send(buyerId, c._id, undefined, {
      type: 'image',
      body: undefined,
      attachments: [{ key: 'img-1', url: 'https://imagedelivery.net/x/img-1/public', mime: 'image/jpeg', size: 10, width: 100, height: 50 }],
    });
    expect(res.status).toBe(201);
    const row = await db.collection('messages').findOne({ _id: oid(res.body.message._id) });
    expect(row.type).toBe('image');
    expect(row.attachments).toEqual([{ id: 'img-1', width: 100, height: 50 }]);
    expect(row.text).toBeNull();
    expect(res.body.message.attachments[0]).toMatchObject({ key: 'img-1', url: 'https://imagedelivery.net/testhash/img-1/public', width: 100, height: 50 });
    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    expect(inbox.body.conversations.find((x) => x._id === c._id).lastMessage).toMatchObject({ body: '[image]', type: 'image' });
  });

  it('unsend tombstones the row the Fastify way and recomputes the preview', async () => {
    const c = await open();
    const first = await send(buyerId, c._id, 'keep me');
    const second = await send(buyerId, c._id, 'unsend me');
    const del = await request(app).delete(`/conversations/${c._id}/messages/${second.body.message._id}`).set(auth(buyerId));
    expect(del.status).toBe(200);
    const row = await db.collection('messages').findOne({ _id: oid(second.body.message._id) });
    expect(row).toMatchObject({ type: 'system', text: null, attachments: [] });
    expect(row.deletedAt).toBeInstanceOf(Date);
    // Like the old chat service and like Fastify, the preview is rebuilt from the NEWEST message, i.e. the
    // tombstone itself: it stays pointing at the unsent message, now as an empty 'system' preview.
    const r = await room(c._id);
    expect(String(r.lastMessage.messageId)).toBe(second.body.message._id);
    expect(r.lastMessage).toMatchObject({ type: 'system', text: '' });
    expect(first.status).toBe(201);
    const history = await request(app).get(`/conversations/${c._id}/messages`).set(auth(sellerId));
    const gone = history.body.messages.find((m) => m._id === second.body.message._id);
    expect(gone).toMatchObject({ body: '', type: 'text', attachments: [] });
    expect(gone.deletedAt).toBeTruthy();
  });

  it('read watermarks, archive and mute land on the right side of the room', async () => {
    const c = await open();
    const m = await send(sellerId, c._id, 'ping');
    expect((await room(c._id)).buyerUnreadCount).toBeGreaterThan(0);
    await ctx.container.conversationService.markRead(c._id, buyerId, m.body.message._id);
    const read = await room(c._id);
    expect(read.buyerUnreadCount).toBe(0);
    expect(String(read.buyerLastRead.messageId)).toBe(m.body.message._id);
    expect(read.buyerLastRead.at).toEqual((await db.collection('messages').findOne({ _id: oid(m.body.message._id) })).createdAt);
    expect(read.sellerLastRead).toBeNull();

    await request(app).patch(`/conversations/${c._id}/mute`).set(auth(buyerId)).send({ muted: true });
    expect((await room(c._id)).buyerMutedAt).toBeInstanceOf(Date);
    expect((await room(c._id)).sellerMutedAt).toBeNull();
    await request(app).delete(`/conversations/${c._id}`).set(auth(sellerId));
    const archived = await room(c._id);
    expect(archived.sellerArchivedAt).toBeInstanceOf(Date);
    expect(archived.buyerArchivedAt).toBeNull();
    expect(String(archived.sellerClearedTo.messageId)).toBe(m.body.message._id);

    const legacy = (await request(app).get(`/conversations/${c._id}`).set(auth(buyerId))).body.conversation;
    expect(legacy.mutedBy).toEqual([String(buyerId)]);
    expect(legacy.deletedFor).toEqual([String(sellerId)]);
    expect(legacy.readState[String(buyerId)]).toMatchObject({ lastReadMessageId: m.body.message._id });
    expect(legacy.clearedAt[String(sellerId)]).toBe(m.body.message._id);
    expect(legacy.unreadCounts).toEqual({ [String(buyerId)]: 0, [String(sellerId)]: 0 });
  });
});

describe('what the chat service reads (including what Fastify wrote)', () => {
  it('serves the legacy conversation shape for a room opened by Fastify, with its messages', async () => {
    const buyer2 = await seedUser(ctx, { firstname: 'Fast', lastname: 'Ify' });
    const now = new Date();
    const roomId = new mongoose.Types.ObjectId();
    await db.collection('chat_rooms').insertOne({
      _id: roomId, adId: itemId, buyerId: buyer2, sellerId, adTitle: 'Vintage bike', adImageId: 'bike1', adPriceMinor: 12050,
      lastMessage: null, lastMessageAt: now, buyerLastRead: null, sellerLastRead: null, buyerUnreadCount: 0, sellerUnreadCount: 0,
      buyerArchivedAt: null, sellerArchivedAt: null, buyerMutedAt: null, sellerMutedAt: null, buyerClearedTo: null, sellerClearedTo: null,
      expiresAt: null, schemaVersion: 1, createdAt: now, updatedAt: now,
    });
    const fastifyMessage = { _id: new mongoose.Types.ObjectId(), roomId, senderId: buyer2, type: 'text', text: 'sent by the new app <b>', attachments: [], clientMessageId: randomUUID(), deletedAt: null, schemaVersion: 2, expiresAt: null, createdAt: new Date() };
    await db.collection('messages').insertOne(fastifyMessage);
    await db.collection('chat_rooms').updateOne({ _id: roomId }, { $set: { lastMessage: { messageId: fastifyMessage._id, text: fastifyMessage.text, type: 'text', senderId: buyer2, at: fastifyMessage.createdAt }, lastMessageAt: fastifyMessage.createdAt, sellerUnreadCount: 1 } });

    const inbox = await request(app).get('/conversations').set(auth(sellerId));
    const legacy = inbox.body.conversations.find((c) => c._id === String(roomId));
    expect(legacy).toMatchObject({
      itemId: String(itemId),
      pairKey: `${buyer2}:${sellerId}`,
      participantIds: [String(buyer2), String(sellerId)],
      item: { title: 'Vintage bike', thumbnailUrl: 'https://imagedelivery.net/testhash/bike1/public', price: 120.5, status: 'Approved', sellerId: String(sellerId) },
      lastMessage: { body: 'sent by the new app &lt;b&gt;', type: 'text', senderId: String(buyer2), deletedAt: null },
      unreadCounts: { [String(buyer2)]: 0, [String(sellerId)]: 1 },
      deletedFor: [],
      mutedBy: [],
    });
    expect(legacy.participants[String(buyer2)].displayName).toBe('Fast Ify');
    expect(legacy.participants[String(buyer2)].avatarUrl).toBe('https://imagedelivery.net/testhash/e0452e1f-1270-461a-fec0-a14322ab9400/public');
    expect(JSON.stringify(legacy)).not.toContain('example.com');

    const history = await request(app).get(`/conversations/${roomId}/messages`).set(auth(sellerId));
    expect(history.body.messages.map((m) => m.body)).toEqual(['sent by the new app &lt;b&gt;']);

    // the old app answers on the same room; both sides' views stay consistent
    const reply = await send(sellerId, String(roomId), 'reply from the old app');
    expect(reply.status).toBe(201);
    const r = await db.collection('chat_rooms').findOne({ _id: roomId });
    expect(r.buyerUnreadCount).toBe(1);
    expect(r.sellerUnreadCount).toBe(1); // untouched by the seller's own message
    const both = await request(app).get(`/conversations/${roomId}/messages`).set(auth(buyer2));
    expect(both.body.messages.map((m) => m.body)).toEqual(['reply from the old app', 'sent by the new app &lt;b&gt;']);
  });

  it('maps a Fastify tombstone (type system) back to an unsent text message and previews it as deleted', async () => {
    const buyer3 = await seedUser(ctx, { firstname: 'T', lastname: 'Omb' });
    const c = await open(buyer3);
    const m = await send(buyer3, c._id, 'will be unsent');
    // Fastify's unsend: tombstone + preview rebuilt from the newest message
    await db.collection('messages').updateOne({ _id: oid(m.body.message._id) }, { $set: { type: 'system', text: null, attachments: [], deletedAt: new Date() } });
    await db.collection('chat_rooms').updateOne({ _id: oid(c._id) }, { $set: { 'lastMessage.type': 'system', 'lastMessage.text': '' } });
    const inbox = await request(app).get('/conversations').set(auth(buyer3));
    const last = inbox.body.conversations.find((x) => x._id === c._id).lastMessage;
    expect(last).toMatchObject({ body: '', type: 'text' });
    expect(last.deletedAt).toBeTruthy();
  });

  it('chat with the buyer needs an accepted, not-rejected, active offer', async () => {
    const offerBuyer = await seedUser(ctx, { firstname: 'O', lastname: 'Ffer' });
    const offerItem = await seedItem(ctx, { addedBy: sellerId, title: 'Offer item', images: [], hidden: false, status: 'Approved', bids: [{ bidder: offerBuyer, amount: 10, status: 'accepted' }] });
    const start = () => request(app).post('/conversations').set(auth(sellerId)).send({ itemId: String(offerItem), counterpartId: String(offerBuyer) });
    expect((await start()).status).toBe(201);
    await db.collection('bids').updateOne({ adId: offerItem, bidderId: offerBuyer }, { $set: { rejectedAt: new Date() } });
    expect((await start()).status).toBe(403);
    await db.collection('bids').updateOne({ adId: offerItem, bidderId: offerBuyer }, { $set: { rejectedAt: null, status: 'withdrawn' } });
    expect((await start()).status).toBe(403);
  });

  it('a soft-deleted or moderated ad is treated like the old hidden / missing item', async () => {
    const buyer4 = await seedUser(ctx, { firstname: 'G', lastname: 'One' });
    const item = await seedItem(ctx, { addedBy: sellerId, title: 'Short lived', price: 5, images: [], hidden: false, status: 'Approved' });
    const c = await open(buyer4, item);
    await deleteItem(ctx, item);
    const opened = (await request(app).get(`/conversations/${c._id}`).set(auth(buyer4))).body.conversation;
    expect(opened.itemDeleted).toBe(true);
    expect(opened.itemAvailable).toBe(false);
    expect(opened.item.title).toBe('Short lived'); // the room still renders from its snapshot
    expect((await request(app).post('/conversations').set(auth(buyer4)).send({ itemId: String(item) })).status).toBe(404);

    const pending = await seedItem(ctx, { addedBy: sellerId, title: 'Pending', images: [], hidden: false, status: 'Pending' });
    expect((await request(app).post('/conversations').set(auth(buyer4)).send({ itemId: String(pending) })).status).toBe(403);
  });

  it('the inbox lists empty and active rooms newest activity first, and hides archived ones', async () => {
    const buyer5 = await seedUser(ctx, { firstname: 'I', lastname: 'Nbox' });
    const a = await seedItem(ctx, { addedBy: sellerId, title: 'A', images: [], hidden: false, status: 'Approved' });
    const b = await seedItem(ctx, { addedBy: sellerId, title: 'B', images: [], hidden: false, status: 'Approved' });
    const ca = await open(buyer5, a);
    const cb = await open(buyer5, b);
    await send(buyer5, ca._id, 'bump A');
    let inbox = await request(app).get('/conversations').set(auth(buyer5));
    expect(inbox.body.conversations.map((c) => c._id)).toEqual([ca._id, cb._id]);
    await request(app).delete(`/conversations/${ca._id}`).set(auth(buyer5));
    inbox = await request(app).get('/conversations').set(auth(buyer5));
    expect(inbox.body.conversations.map((c) => c._id)).toEqual([cb._id]);
  });
});
