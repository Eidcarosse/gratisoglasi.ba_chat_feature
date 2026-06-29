import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootTestApp, seedUser } from './helpers/app.js';

let ctx;
let app;
let buyerId;
let sellerId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });
const T = 'ExponentPushToken[device-xyz]';
const tokensFor = async (userId) => {
  const devices = await ctx.container.deviceRepository.findByUserId(String(userId));
  return devices.map((d) => d.token);
};

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
  buyerId = await seedUser(ctx, { firstname: 'B', lastname: 'Uyer', email: 'b@e.com' });
  sellerId = await seedUser(ctx, { firstname: 'S', lastname: 'Eller', email: 's@e.com' });
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('device registration', () => {
  it('registers a push token for the user', async () => {
    const res = await request(app).post('/devices').set(auth(buyerId)).send({ token: T, platform: 'ios' });
    expect(res.status).toBe(201);
    expect(await tokensFor(buyerId)).toContain(T);
  });

  it('reassigns a token when another user registers it', async () => {
    await request(app).post('/devices').set(auth(sellerId)).send({ token: T, platform: 'android' });
    expect(await tokensFor(buyerId)).not.toContain(T);
    expect(await tokensFor(sellerId)).toContain(T);
  });

  it('rejects an invalid platform', async () => {
    const res = await request(app)
      .post('/devices')
      .set(auth(buyerId))
      .send({ token: 'ExponentPushToken[x]', platform: 'desktop' });
    expect(res.status).toBe(400);
  });

  it('unregisters a device', async () => {
    const res = await request(app).delete('/devices').set(auth(sellerId)).send({ token: T });
    expect(res.status).toBe(200);
    expect(await tokensFor(sellerId)).not.toContain(T);
  });
});
