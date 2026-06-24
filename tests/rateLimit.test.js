import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootTestApp, seedUser, seedItem } from './helpers/app.js';
import { RATE_LIMITS } from '../src/config/constants.js';

let ctx;
let buyerId;
let otherBuyerId;
let itemId;

const auth = (userId) => ({ Authorization: `Bearer ${userId}` });

beforeAll(async () => {
  ctx = await bootTestApp();
  const sellerId = await seedUser(ctx, { firstname: 'Sel', lastname: 'Ler', email: 's@x.com' });
  buyerId = await seedUser(ctx, { firstname: 'Bu', lastname: 'Yer', email: 'b@x.com' });
  otherBuyerId = await seedUser(ctx, { firstname: 'Oth', lastname: 'Er', email: 'o@x.com' });
  itemId = await seedItem(ctx, {
    addedBy: sellerId,
    title: 'Thing',
    images: ['https://cdn/t.jpg'],
    hidden: false,
    status: 'Approved',
  });
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('anti-scam new-conversation rate limit', () => {
  it('throttles one user past the cap but leaves a different user unaffected', async () => {
    const cap = RATE_LIMITS.NEW_CONVERSATION.max;
    let limited = 0;
    let ok = 0;
    for (let i = 0; i < cap + 3; i++) {
      const res = await request(ctx.app).post('/conversations').set(auth(buyerId)).send({ itemId: String(itemId) });
      if (res.status === 429) limited++;
      else ok++;
    }
    expect(ok).toBe(cap); // first `cap` allowed (all find-or-create the same convo)
    expect(limited).toBe(3); // the rest blocked

    // A different user is in their own bucket → still allowed.
    const other = await request(ctx.app).post('/conversations').set(auth(otherBuyerId)).send({ itemId: String(itemId) });
    expect(other.status).toBe(201);
  });
});
