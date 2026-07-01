/**
 * LIVE end-to-end test against the REAL Cloudflare Images API. OPT-IN only — runs when
 * RUN_LIVE_CF=1. It uploads real test images through the full HTTP stack (route → multer →
 * controller → service → CloudflareImagesClient → Cloudflare), verifies they are publicly
 * viewable, then SURGICALLY deletes exactly the ids it created and confirms they are gone.
 *
 * SAFETY: the Cloudflare account may be shared with the main site's listing images, so this test
 * only ever deletes the specific ids it just created — never a list/bulk delete.
 *
 * Requires real CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_IMAGES_TOKEN in .env.
 * Run: RUN_LIVE_CF=1 npx vitest run tests/live.cloudflare.test.js
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
// Vitest does NOT auto-load .env into process.env, so load it explicitly (by absolute path) at
// module-eval time — BEFORE bootTestApp() dynamically imports config, which reads these vars.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { bootTestApp } from './helpers/app.js';

const RUN = process.env.RUN_LIVE_CF === '1';

// A valid 1x1 grayscale PNG (verified accepted by Cloudflare Images' strict decoder).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/images/v1`;
const CF_HEADERS = { Authorization: `Bearer ${process.env.CLOUDFLARE_IMAGES_TOKEN}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Delete one image by id via the CF API. Returns true on 2xx. */
async function cfDelete(id) {
  const res = await fetch(`${CF_BASE}/${id}`, { method: 'DELETE', headers: CF_HEADERS });
  return res.ok;
}
/** Authoritative existence check via the CF API (not the CDN, which may cache). */
async function cfExists(id) {
  const res = await fetch(`${CF_BASE}/${id}`, { headers: CF_HEADERS });
  return res.status === 200;
}
/** GET a delivery URL, retrying briefly to absorb CDN propagation. */
async function fetchOk(url, tries = 4) {
  let res;
  for (let i = 0; i < tries; i++) {
    res = await fetch(url);
    if (res.status === 200) return res;
    await sleep(750);
  }
  return res;
}

describe.skipIf(!RUN)('LIVE: POST /uploads/images → Cloudflare (real)', () => {
  let ctx;
  let app;
  const token = '0123456789abcdef01234567'; // dev-mode auth: token === userId
  const createdIds = [];

  beforeAll(async () => {
    ctx = await bootTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    // Surgical cleanup: delete ONLY the ids we created, then verify each is gone.
    const results = [];
    for (const id of createdIds) {
      const deleted = await cfDelete(id);
      const stillThere = await cfExists(id);
      results.push({ id, deleted, stillThere });
    }
    // eslint-disable-next-line no-console
    console.log('[live-cf] created ids:', createdIds, '\n[live-cf] cleanup:', JSON.stringify(results));
    for (const r of results) expect(r.stillThere).toBe(false);
    if (ctx) await ctx.shutdown();
  });

  it(
    'uploads 2 real images and returns publicly viewable delivery URLs',
    async () => {
      const mkfile = () => [
        PNG_1x1,
        { filename: `chat-e2e-${randomUUID()}.png`, contentType: 'image/png' },
      ];
      const res = await request(app)
        .post('/uploads/images')
        .set({ Authorization: `Bearer ${token}` })
        .attach('images', ...mkfile())
        .attach('images', ...mkfile());

      // Capture ids IMMEDIATELY so afterAll cleans up even if an assertion below throws.
      if (res.body?.images) createdIds.push(...res.body.images.map((i) => i.id));

      expect(res.status).toBe(200);
      expect(res.body.images).toHaveLength(2);
      expect(res.body.failed).toEqual([]);
      expect(res.body.imageUrls).toHaveLength(2);

      for (const img of res.body.images) {
        expect(img.url).toMatch(/^https:\/\/imagedelivery\.net\/.+\/.+/);
        expect(img.key).toBe(img.id);
        const view = await fetchOk(img.url);
        expect(view.status).toBe(200); // unsigned delivery URL is publicly viewable
      }
    },
    90_000,
  );
});
