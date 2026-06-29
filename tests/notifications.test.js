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

let lastMessages; // captured push payload
let returnInvalid; // make the fake provider report all tokens invalid

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const sendAs = (userId, body) =>
  request(app).post(`/conversations/${convoId}/messages`).set(auth(userId)).send(body);

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
  ctx.container.notificationService.push = {
    send: async (messages) => {
      lastMessages = messages;
      return { tickets: [], invalidTokens: returnInvalid ? messages.map((m) => m.to) : [] };
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
});

afterAll(async () => {
  await ctx.shutdown();
});

beforeEach(() => {
  lastMessages = undefined;
  returnInvalid = false;
});

describe('push notifications', () => {
  it('pushes to an offline recipient with the right payload', async () => {
    await request(app)
      .post('/devices')
      .set(auth(sellerId))
      .send({ token: 'ExponentPushToken[notif-1]', platform: 'android' });

    await sendAs(buyerId, { clientMessageId: randomUUID(), type: 'text', body: 'Hello there' });

    expect(lastMessages).toBeTruthy();
    expect(lastMessages[0].title).toBe('B Uyer'); // sender displayName
    expect(lastMessages[0].body).toBe('Hello there');
    expect(lastMessages[0].data.conversationId).toBe(convoId);
  });

  it('previews image messages as a photo label', async () => {
    await sendAs(buyerId, {
      clientMessageId: randomUUID(),
      type: 'image',
      attachments: [{ key: 'k', url: 'https://cdn/x.jpg', mime: 'image/jpeg', size: 10 }],
    });
    expect(lastMessages[0].body).toBe('📷 Photo');
  });

  it('does not push to an online recipient', async () => {
    await ctx.container.presenceService.online(String(sellerId), 'sock-1');
    await sendAs(buyerId, { clientMessageId: randomUUID(), type: 'text', body: 'online test' });
    expect(lastMessages).toBeUndefined();
    await ctx.container.presenceService.offline(String(sellerId), 'sock-1');
  });

  it('prunes tokens Expo reports as invalid (DeviceNotRegistered)', async () => {
    returnInvalid = true;
    await sendAs(buyerId, { clientMessageId: randomUUID(), type: 'text', body: 'cleanup' });
    const devices = await ctx.container.deviceRepository.findByUserId(String(sellerId));
    expect(devices.length).toBe(0);
  });
});
