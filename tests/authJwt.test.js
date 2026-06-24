import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { bootTestApp } from './helpers/app.js';

const oid = () => String(new mongoose.Types.ObjectId());
const secret = 'another-test-secret-16+';

describe('AUTH_MODE=jwt guard (config-only swap)', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await bootTestApp({ authMode: 'jwt', jwtSecret: secret });
  });
  afterAll(async () => {
    await ctx.shutdown();
  });

  it('rejects an unsigned bearer and accepts a properly signed JWT — no call-site change', async () => {
    const id = oid();
    expect((await request(ctx.app).get('/conversations').set({ Authorization: `Bearer ${id}` })).status).toBe(401);
    const token = jwt.sign({ userId: id }, secret);
    expect((await request(ctx.app).get('/conversations').set({ Authorization: `Bearer ${token}` })).status).toBe(200);
  });
});
