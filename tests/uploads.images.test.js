/**
 * HTTP-level tests for POST /uploads/images. bootTestApp() sets no Cloudflare env, so the client is
 * disabled and the endpoint 503s — which lets us exercise auth, the multer fileFilter/limits, and
 * the MulterError→AppError wrapper without ever reaching Cloudflare (no fetch stub needed).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootTestApp } from './helpers/app.js';

let ctx;
let app;
const TOKEN = '0123456789abcdef01234567'; // any 24-hex string authenticates under AUTH_MODE=dev
const auth = { Authorization: `Bearer ${TOKEN}` };
const jpg = () => [Buffer.from('fake-image-bytes'), { filename: 'a.jpg', contentType: 'image/jpeg' }];

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('POST /uploads/images', () => {
  it('401s without an auth token (before any bytes are buffered)', async () => {
    const res = await request(app).post('/uploads/images').attach('images', ...jpg());
    expect(res.status).toBe(401);
  });

  it('503s when Cloudflare Images is not configured', async () => {
    const res = await request(app).post('/uploads/images').set(auth).attach('images', ...jpg());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UNAVAILABLE');
  });

  it('400s on a non-image file (fileFilter)', async () => {
    const res = await request(app)
      .post('/uploads/images')
      .set(auth)
      .attach('images', Buffer.from('plain'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('400s when more than 5 files are sent (multer limit → wrapper)', async () => {
    let req = request(app).post('/uploads/images').set(auth);
    for (let i = 0; i < 6; i++) {
      req = req.attach('images', Buffer.from('x'), { filename: `a${i}.jpg`, contentType: 'image/jpeg' });
    }
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
