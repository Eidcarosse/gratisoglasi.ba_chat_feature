import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;
let convoId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const send = (fromId, body) =>
  request(app)
    .post(`/conversations/${convoId}/messages`)
    .set(auth(fromId))
    .send({ clientMessageId: randomUUID(), type: 'text', body });

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
  // Capture push fan-out instead of hitting Expo.
  ctx.container.notificationService.push = {
    send: async () => ({ tickets: [], invalidTokens: [] }),
  };
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
  // A pre-block message so we can later assert history stays readable while blocked.
  await send(buyerId, 'hello before block');
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('block validation', () => {
  it('rejects blocking yourself (400)', async () => {
    const r = await request(app).post('/blocks').set(auth(buyerId)).send({ userId: String(buyerId) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
  });

  it('rejects blocking a non-existent user (404)', async () => {
    const ghost = '0123456789abcdef01234567';
    const r = await request(app).post('/blocks').set(auth(buyerId)).send({ userId: ghost });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed userId (400)', async () => {
    const r = await request(app).post('/blocks').set(auth(buyerId)).send({ userId: 'not-an-id' });
    expect(r.status).toBe(400);
  });
});

describe('block prevents contact both ways', () => {
  it('buyer blocks seller (201) and it appears in the blocked list', async () => {
    const b = await request(app).post('/blocks').set(auth(buyerId)).send({ userId: String(sellerId) });
    expect(b.status).toBe(201);
    expect(b.body.ok).toBe(true);
    // The block response echoes the resulting directed status (from the blocker's perspective).
    expect(b.body.status).toEqual({ blockedByMe: true, blockedByThem: false, canMessage: false });

    const list = await request(app).get('/blocks').set(auth(buyerId));
    expect(list.status).toBe(200);
    expect(list.body.blocks).toHaveLength(1);
    expect(list.body.blocks[0].userId).toBe(String(sellerId));
    expect(list.body.blocks[0].displayName).toBe('S Eller');
  });

  it('is idempotent — re-blocking keeps a single row', async () => {
    const again = await request(app)
      .post('/blocks')
      .set(auth(buyerId))
      .send({ userId: String(sellerId) });
    expect(again.status).toBe(201);
    const list = await request(app).get('/blocks').set(auth(buyerId));
    expect(list.body.blocks).toHaveLength(1);
  });

  it('blocks the blocked user from messaging the blocker (403)', async () => {
    const r = await send(sellerId, 'can you hear me?');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks the blocker from messaging the blocked user (403, bidirectional)', async () => {
    const r = await send(buyerId, 'changed my mind');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents starting a new conversation for the same pair (403)', async () => {
    const r = await request(app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('leaves existing history readable while blocked', async () => {
    const h = await request(app).get(`/conversations/${convoId}/messages`).set(auth(buyerId));
    expect(h.status).toBe(200);
    expect(h.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(h.body.messages.some((m) => m.body === 'hello before block')).toBe(true);
  });
});

describe('unblock restores contact', () => {
  it('unblocks (200) and clears the blocked list', async () => {
    const u = await request(app).delete(`/blocks/${sellerId}`).set(auth(buyerId));
    expect(u.status).toBe(200);
    expect(u.body.ok).toBe(true);
    // No reverse block stands, so contact is restored.
    expect(u.body.status).toEqual({ blockedByMe: false, blockedByThem: false, canMessage: true });

    const list = await request(app).get('/blocks').set(auth(buyerId));
    expect(list.body.blocks).toHaveLength(0);
  });

  it('lets both users message again after unblock', async () => {
    const r1 = await send(sellerId, 'we are good now');
    expect(r1.status).toBe(201);
    const r2 = await send(buyerId, 'yes we are');
    expect(r2.status).toBe(201);
  });

  it('is idempotent — unblocking a non-blocked user still returns 200', async () => {
    const u = await request(app).delete(`/blocks/${sellerId}`).set(auth(buyerId));
    expect(u.status).toBe(200);
    expect(u.body.ok).toBe(true);
    expect(u.body.status.canMessage).toBe(true);
  });
});

describe('block status is exposed both directions', () => {
  it('GET /blocks/status/:userId reflects each side after buyer blocks seller', async () => {
    await request(app).post('/blocks').set(auth(buyerId)).send({ userId: String(sellerId) });

    // Blocker's view: "I blocked them".
    const asBuyer = await request(app).get(`/blocks/status/${sellerId}`).set(auth(buyerId));
    expect(asBuyer.status).toBe(200);
    expect(asBuyer.body.status).toEqual({
      blockedByMe: true,
      blockedByThem: false,
      canMessage: false,
    });

    // Blocked user's view: "they blocked me" (the mirror image).
    const asSeller = await request(app).get(`/blocks/status/${buyerId}`).set(auth(sellerId));
    expect(asSeller.body.status).toEqual({
      blockedByMe: false,
      blockedByThem: true,
      canMessage: false,
    });
  });

  it('open + inbox carry the caller-relative blockStatus while blocked', async () => {
    const open = await request(app).get(`/conversations/${convoId}`).set(auth(sellerId));
    expect(open.status).toBe(200);
    expect(open.body.conversation.blockStatus).toEqual({
      blockedByMe: false,
      blockedByThem: true,
      canMessage: false,
    });

    const inbox = await request(app).get('/conversations').set(auth(buyerId));
    const row = inbox.body.conversations.find((c) => c._id === convoId);
    expect(row.blockStatus).toEqual({ blockedByMe: true, blockedByThem: false, canMessage: false });
  });

  it('reports canMessage:true once unblocked', async () => {
    await request(app).delete(`/blocks/${sellerId}`).set(auth(buyerId));
    const s = await request(app).get(`/blocks/status/${sellerId}`).set(auth(buyerId));
    expect(s.body.status).toEqual({ blockedByMe: false, blockedByThem: false, canMessage: true });

    const open = await request(app).get(`/conversations/${convoId}`).set(auth(buyerId));
    expect(open.body.conversation.blockStatus.canMessage).toBe(true);
  });
});
