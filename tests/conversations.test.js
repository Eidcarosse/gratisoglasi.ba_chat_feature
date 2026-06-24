import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { bootTestApp, seedUser, seedItem, updateItem } from './helpers/app.js';
import { GratisRepository } from '../src/integrations/gratis/gratis.repository.js';

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;

  buyerId = await seedUser(ctx, {
    firstname: 'Aida',
    lastname: 'Buyer',
    email: 'aida@example.com',
    profilePicture: 'https://cdn/aida.png',
    showEmail: true,
  });
  // Seller hides email and has NO names → displayName must fall back to "User" (not email).
  sellerId = await seedUser(ctx, {
    email: 'seller@example.com',
    profilePicture: 'https://cdn/seller.png',
    showEmail: false,
  });
  itemId = await seedItem(ctx, {
    addedBy: sellerId,
    title: 'Vintage bike',
    price: null, // nullable price must pass through
    images: ['https://cdn/bike1.jpg', 'https://cdn/bike2.jpg'],
    hidden: false,
    status: 'Approved',
  });
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('POST /conversations (create / find-or-create)', () => {
  it('creates a conversation with a correct denormalized snapshot', async () => {
    const res = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
    expect(res.status).toBe(201);
    const c = res.body.conversation;
    expect(c.item.title).toBe('Vintage bike');
    expect(c.item.thumbnailUrl).toBe('https://cdn/bike1.jpg'); // images[0]
    expect(c.item.price).toBeNull(); // null passes through
    expect(c.item.status).toBe('Approved');
    expect(String(c.item.sellerId)).toBe(String(sellerId));

    // participant snapshots: buyer name derived; seller falls back to "User"; NO email leaked.
    expect(c.participants[String(buyerId)].displayName).toBe('Aida Buyer');
    expect(c.participants[String(sellerId)].displayName).toBe('User');
    expect(JSON.stringify(c)).not.toContain('seller@example.com');
    expect(JSON.stringify(c)).not.toContain('aida@example.com');
  });

  it('is idempotent — a second identical call returns the SAME conversation', async () => {
    const first = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
    const second = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
    expect(first.body.conversation._id).toBe(second.body.conversation._id);
  });

  it('rejects messaging yourself (buyer === seller)', async () => {
    const res = await request(app).post('/conversations').set(auth(sellerId)).send({ itemId: String(itemId) });
    expect(res.status).toBe(400);
  });

  it('rejects a hidden item', async () => {
    const hiddenItem = await seedItem(ctx, {
      addedBy: sellerId,
      title: 'Hidden',
      images: [],
      hidden: true,
      status: 'Approved',
    });
    const res = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(hiddenItem) });
    expect(res.status).toBe(403);
  });

  it('rejects a missing item', async () => {
    const res = await request(app)
      .post('/conversations')
      .set(auth(buyerId))
      .send({ itemId: String(new mongoose.Types.ObjectId()) });
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated request and a malformed itemId', async () => {
    expect((await request(app).post('/conversations').send({ itemId: String(itemId) })).status).toBe(401);
    expect((await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: 'nope' })).status).toBe(400);
  });
});

describe('GET /conversations/:id (open) + membership + open-refresh', () => {
  let convId;
  beforeAll(async () => {
    const res = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
    convId = res.body.conversation._id;
  });

  it('lets a participant open it but rejects a third party (membership, any auth mode)', async () => {
    const ok = await request(app).get(`/conversations/${convId}`).set(auth(buyerId));
    expect(ok.status).toBe(200);

    const stranger = new mongoose.Types.ObjectId();
    const denied = await request(app).get(`/conversations/${convId}`).set(auth(stranger));
    expect(denied.status).toBe(403);
  });

  it('reflects LIVE item price/status on open while inbox keeps the snapshot', async () => {
    await updateItem(ctx, itemId, { price: 250, status: 'Approved' });

    const opened = await request(app).get(`/conversations/${convId}`).set(auth(buyerId));
    expect(opened.body.conversation.item.price).toBe(250); // live overlay

    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    const row = inbox.body.conversations.find((c) => c._id === convId);
    expect(row.item.price).toBeNull(); // snapshot unchanged (taken at creation, price was null)
  });
});

describe('message send updates inbox snapshot WITHOUT clobbering item/participants', () => {
  it('sets lastMessage + unread but preserves the snapshot fields', async () => {
    const created = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
    const convId = created.body.conversation._id;
    const titleBefore = created.body.conversation.item.title;

    const send = await request(app)
      .post(`/conversations/${convId}/messages`)
      .set(auth(buyerId))
      .send({ clientMessageId: randomUUID(), type: 'text', body: 'Is this still available?' });
    expect(send.status).toBe(201);

    const inbox = await request(app).get('/conversations').set(auth(sellerId));
    const row = inbox.body.conversations.find((c) => c._id === convId);
    expect(row.lastMessage.body).toBe('Is this still available?');
    expect(row.unreadCounts[String(sellerId)]).toBe(1); // recipient incremented
    expect(row.item.title).toBe(titleBefore); // snapshot intact
    expect(row.participants[String(buyerId)].displayName).toBe('Aida Buyer'); // intact
  });
});

describe('read-only safety of the gratis integration', () => {
  it('exposes only read methods (no write surface)', () => {
    const methods = Object.getOwnPropertyNames(GratisRepository.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['getItemById', 'getUserById', 'getUsersByIds']);
    const writeish = methods.filter((m) => /create|insert|update|save|delete|remove|write/i.test(m));
    expect(writeish).toEqual([]);
  });
});
