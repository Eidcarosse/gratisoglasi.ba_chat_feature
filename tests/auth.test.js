import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { bootTestApp } from './helpers/app.js';
import { DevVerifier } from '../src/modules/auth/auth.verifier.dev.js';
import { JwtVerifier } from '../src/modules/auth/auth.verifier.jwt.js';

const oid = () => String(new mongoose.Types.ObjectId());

describe('auth verifier units', () => {
  it('DevVerifier trusts a valid ObjectId token and rejects garbage', async () => {
    const v = new DevVerifier();
    const id = oid();
    expect(await v.verify(id)).toEqual({ userId: id });
    await expect(v.verify('not-an-oid')).rejects.toMatchObject({ statusCode: 401 });
    await expect(v.verify(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('JwtVerifier accepts a signed token and rejects an unsigned one', async () => {
    const secret = 'test-secret-at-least-16-chars';
    const v = new JwtVerifier(secret);
    const id = oid();
    const token = jwt.sign({ userId: id }, secret);
    expect(await v.verify(token)).toEqual({ userId: id });
    await expect(v.verify(id)).rejects.toMatchObject({ statusCode: 401 }); // raw id, not a JWT
    await expect(v.verify(jwt.sign({ userId: id }, 'wrong-secret'))).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('AUTH_MODE=dev guard (end to end)', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await bootTestApp({ authMode: 'dev' });
  });
  afterAll(async () => {
    await ctx.shutdown();
  });

  it('accepts a Bearer <userId> and rejects missing/garbage tokens', async () => {
    expect((await request(ctx.app).get('/conversations').set({ Authorization: `Bearer ${oid()}` })).status).toBe(200);
    expect((await request(ctx.app).get('/conversations')).status).toBe(401);
    expect((await request(ctx.app).get('/conversations').set({ Authorization: 'Bearer garbage' })).status).toBe(401);
  });
});
