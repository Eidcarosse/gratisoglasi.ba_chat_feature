import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';

let ctx;
let app;
let buyerId;
let sellerId;
let itemId;
let convoId;
const pushCalls = [];

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const sendText = (body) =>
  request(app)
    .post(`/conversations/${convoId}/messages`)
    .set(auth(buyerId))
    .send({ clientMessageId: randomUUID(), type: 'text', body });

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
  // Capture push fan-out instead of hitting Expo.
  ctx.container.notificationService.push = {
    send: async (messages) => {
      pushCalls.push(messages);
      return { tickets: [], invalidTokens: [] };
    },
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
  // The recipient (seller) has a device so an offline send would push.
  await request(app)
    .post('/devices')
    .set(auth(sellerId))
    .send({ token: 'ExponentPushToken[seller-1]', platform: 'android' });
});

afterAll(async () => {
  await ctx.shutdown();
});

beforeEach(() => {
  pushCalls.length = 0;
});

describe('mute conversation (suppresses push only)', () => {
  it('pushes to an offline recipient by default', async () => {
    await sendText('hi');
    expect(pushCalls.length).toBe(1);
  });

  it('suppresses push when the recipient muted the conversation', async () => {
    const m = await request(app)
      .patch(`/conversations/${convoId}/mute`)
      .set(auth(sellerId))
      .send({ muted: true });
    expect(m.status).toBe(200);

    await sendText('are you there?');
    expect(pushCalls.length).toBe(0);
  });

  it('resumes push after unmute', async () => {
    await request(app)
      .patch(`/conversations/${convoId}/mute`)
      .set(auth(sellerId))
      .send({ muted: false });

    await sendText('back again');
    expect(pushCalls.length).toBe(1);
  });
});
