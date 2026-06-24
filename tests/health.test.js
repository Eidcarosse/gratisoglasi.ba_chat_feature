import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootTestApp } from './helpers/app.js';

let ctx;
let app;

beforeAll(async () => {
  ctx = await bootTestApp();
  app = ctx.app;
});

afterAll(async () => {
  await ctx.shutdown();
});

describe('health endpoints (two-connection /readyz)', () => {
  it('/healthz is liveness-only and always ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('/readyz is ready when BOTH connections are up', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('/readyz flips to 503 when the gratis connection drops, while /healthz stays ok', async () => {
    await ctx.conns.gratisConn.close();
    const ready = await request(app).get('/readyz');
    expect(ready.status).toBe(503);
    const live = await request(app).get('/healthz');
    expect(live.status).toBe(200);
  });
});
