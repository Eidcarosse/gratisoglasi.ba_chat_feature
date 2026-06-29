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
const att = (i) => ({ key: `k${i}`, url: `https://cdn.example/${i}.jpg`, mime: 'image/jpeg', size: 1000 });

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

const send = (body) =>
  request(app).post(`/conversations/${convoId}/messages`).set(auth(buyerId)).send(body);

describe('attachment limits (max 5 images per message)', () => {
  it('accepts up to 5 image attachments', async () => {
    const res = await send({
      clientMessageId: randomUUID(),
      type: 'image',
      attachments: [1, 2, 3, 4, 5].map(att),
    });
    expect(res.status).toBe(201);
    expect(res.body.message.attachments).toHaveLength(5);
  });

  it('rejects more than 5 attachments', async () => {
    const res = await send({
      clientMessageId: randomUUID(),
      type: 'image',
      attachments: [1, 2, 3, 4, 5, 6].map(att),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects an image message with no attachments', async () => {
    const res = await send({ clientMessageId: randomUUID(), type: 'image' });
    expect(res.status).toBe(400);
  });

  it('still requires a body for text messages', async () => {
    const res = await send({ clientMessageId: randomUUID(), type: 'text' });
    expect(res.status).toBe(400);
  });

  it('accepts a normal text message', async () => {
    const res = await send({ clientMessageId: randomUUID(), type: 'text', body: 'hello' });
    expect(res.status).toBe(201);
  });
});
