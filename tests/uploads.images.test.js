/**
 * HTTP-level tests for POST /uploads/direct-upload (Direct Creator Upload flow — the server only
 * mints one-time Cloudflare URLs; no image bytes ever pass through it). bootTestApp() sets no
 * Cloudflare env, so the client is disabled and the endpoint 503s — which lets us exercise auth and
 * the `count` validation without ever reaching Cloudflare (no fetch stub needed).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootTestApp } from './helpers/app.js';

let ctx;
let app;
const TOKEN = '0123456789abcdef01234567'; // any 24-hex string authenticates under AUTH_MODE=dev
const auth = { Authorization: `Bearer ${TOKEN}` };

beforeAll(async () => {
  // Force Cloudflare "unconfigured" regardless of the developer's local .env (dotenv would
  // otherwise populate real creds and this endpoint would mint real URLs → 200 instead of 503).
  // Empty strings keep the keys "present" so dotenv won't re-fill them, and Boolean('') === false
  // disables the client. The opt-in live test (live.cloudflare.test.js) sets real creds itself.
  process.env.CLOUDFLARE_ACCOUNT_ID = '';
  process.env.CLOUDFLARE_IMAGES_TOKEN = '';
  ctx = await bootTestApp();
  app = ctx.app;
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('POST /uploads/direct-upload', () => {
  it('401s without an auth token', async () => {
    const res = await request(app).post('/uploads/direct-upload').send({ count: 1 });
    expect(res.status).toBe(401);
  });

  it('503s when Cloudflare Images is not configured', async () => {
    const res = await request(app).post('/uploads/direct-upload').set(auth).send({ count: 1 });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UNAVAILABLE');
  });

  it('defaults count to 1 when the body is empty (still 503 — CF unconfigured — not 400)', async () => {
    const res = await request(app).post('/uploads/direct-upload').set(auth).send({});
    expect(res.status).toBe(503);
  });

  it('400s when count exceeds the 5-attachment cap', async () => {
    const res = await request(app).post('/uploads/direct-upload').set(auth).send({ count: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('400s on a non-positive / non-integer count', async () => {
    for (const count of [0, -1, 1.5]) {
      const res = await request(app).post('/uploads/direct-upload').set(auth).send({ count });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });
});
