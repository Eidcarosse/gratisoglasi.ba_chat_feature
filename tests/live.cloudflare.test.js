/**
 * LIVE end-to-end test against the REAL Cloudflare Images API. OPT-IN only — runs when
 * RUN_LIVE_CF=1. It exercises the full Direct Creator Upload flow exactly as a client would:
 *   1) POST /uploads/direct-upload on OUR server → one-time { id, uploadURL } (no bytes touch us)
 *   2) POST the image bytes DIRECTLY to Cloudflare's uploadURL (multipart field `file`)
 *   3) read back the delivery URL from Cloudflare's response and verify it is publicly viewable
 * then SURGICALLY deletes exactly the ids it created and confirms they are gone.
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

/** Upload bytes DIRECTLY to a Cloudflare one-time uploadURL (what the client does). */
async function uploadToCloudflare(uploadURL, bytes, filename) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename);
  const res = await fetch(uploadURL, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json?.success, result: json?.result };
}

describe.skipIf(!RUN)('LIVE: direct-upload → client → Cloudflare (real)', () => {
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
    console.log('[live-cf] created ids:', createdIds, '\n[live-cf] cleanup:', JSON.stringify(results));
    for (const r of results) expect(r.stillThere).toBe(false);
    if (ctx) await ctx.shutdown();
  });

  it(
    'mints 2 one-time URLs, uploads directly to Cloudflare, and gets publicly viewable delivery URLs',
    async () => {
      // 1) Our server mints one-time upload URLs — NO bytes sent to us.
      const mint = await request(app)
        .post('/uploads/direct-upload')
        .set({ Authorization: `Bearer ${token}` })
        .send({ count: 2 });

      expect(mint.status).toBe(200);
      expect(mint.body.uploads).toHaveLength(2);
      expect(mint.body.failed).toEqual([]);
      expect(mint.body.expiresInSeconds).toBeGreaterThan(0);

      // Capture ids IMMEDIATELY so afterAll cleans up even if an assertion below throws. The id CF
      // assigns at direct_upload time is the id the image will have once uploaded.
      createdIds.push(...mint.body.uploads.map((u) => u.id));

      // 2) Client uploads bytes DIRECTLY to each one-time URL.
      for (const upload of mint.body.uploads) {
        expect(upload.uploadURL).toMatch(/^https:\/\/upload\.imagedelivery\.net\/.+/);

        const up = await uploadToCloudflare(upload.uploadURL, PNG_1x1, `chat-e2e-${upload.id}.png`);
        expect(up.ok).toBe(true);
        expect(up.result.id).toBe(upload.id); // CF confirms the pre-assigned id

        // 3) The delivery URL from CF's response is publicly viewable (unsigned).
        const deliveryUrl = (up.result.variants || []).find((v) => v.endsWith('/public')) ?? up.result.variants?.[0];
        expect(deliveryUrl).toMatch(/^https:\/\/imagedelivery\.net\/.+\/.+/);
        const view = await fetchOk(deliveryUrl);
        expect(view.status).toBe(200);
      }
    },
    90_000,
  );
});
