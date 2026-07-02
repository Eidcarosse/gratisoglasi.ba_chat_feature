/**
 * Unit tests for the Cloudflare Images client + UploadService (no app boot, no DB).
 * global fetch is stubbed; the client is constructed with explicit fake creds so nothing reads the
 * frozen env-backed config. Covers the Direct Creator Upload flow (mint one-time URLs — no bytes
 * ever pass through the server) plus best-effort delete on unsend.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CloudflareImagesClient } from '../src/modules/uploads/cloudflareImages.client.js';
import { UploadService } from '../src/modules/uploads/upload.service.js';

const directUploadOk = (id = 'img1', uploadURL = `https://upload.imagedelivery.net/acc/${id}-tok`) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, result: { id, uploadURL } }),
});

afterEach(() => vi.unstubAllGlobals());

describe('CloudflareImagesClient', () => {
  it('is enabled only when both account id and token are present', () => {
    expect(new CloudflareImagesClient({}).enabled).toBe(false);
    expect(new CloudflareImagesClient({ accountId: 'acc' }).enabled).toBe(false);
    expect(new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' }).enabled).toBe(true);
  });

  it('createDirectUploadUrl POSTs to the v2/direct_upload URL with Bearer auth and no bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(directUploadOk('img1'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });
    const res = await client.createDirectUploadUrl({ metadata: { source: 'chat' } });

    expect(res).toEqual({ id: 'img1', uploadURL: 'https://upload.imagedelivery.net/acc/img1-tok' });
    const [calledUrl, opts] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/images/v2/direct_upload',
    );
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    // undici sets the multipart boundary — we must NOT set Content-Type manually.
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
    // No image bytes: the body carries only mint parameters.
    expect(opts.body.get('metadata')).toBe(JSON.stringify({ source: 'chat' }));
    expect(opts.body.get('requireSignedURLs')).toBe('false');
    expect(opts.body.get('expiry')).toEqual(expect.any(String)); // RFC-3339 window
    expect(opts.body.get('file')).toBeNull();
  });

  it('createDirectUploadUrl throws on non-2xx / unsuccessful responses (without leaking the token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) }),
    );
    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });
    await expect(client.createDirectUploadUrl()).rejects.toThrow(/direct_upload failed/);
  });

  it('createDirectUploadUrl throws when the result is missing uploadURL or id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, result: { id: 'x' } }) }),
    );
    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });
    await expect(client.createDirectUploadUrl()).rejects.toThrow(/direct_upload failed/);
  });

  it('parseImageId extracts the id from a delivery URL and is safe on garbage', () => {
    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });
    expect(client.parseImageId('https://imagedelivery.net/hash/img1/public')).toBe('img1');
    expect(client.parseImageId('not a url')).toBeUndefined();
  });
});

describe('UploadService.createDirectUploads', () => {
  const svcWith = (client) => new UploadService({ cloudflareImages: client });
  const enabledClient = () => new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });

  it('503s when Cloudflare is not configured', async () => {
    const svc = svcWith(new CloudflareImagesClient({}));
    await expect(svc.createDirectUploads({ count: 1, userId: 'u1' })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('mints N one-time upload URLs and reports the expiry window', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => directUploadOk(`img${++n}`)),
    );
    const { uploads, failed, expiresInSeconds } = await svcWith(enabledClient()).createDirectUploads({
      count: 3,
      userId: 'u1',
    });
    expect(failed).toEqual([]);
    expect(uploads).toHaveLength(3);
    for (const u of uploads) {
      expect(u.id).toMatch(/^img\d$/);
      expect(u.uploadURL).toContain('upload.imagedelivery.net');
    }
    expect(expiresInSeconds).toBeGreaterThan(0);
  });

  it('defaults count to 1 when omitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(directUploadOk('only')));
    const { uploads } = await svcWith(enabledClient()).createDirectUploads({ userId: 'u1' });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].id).toBe('only');
  });

  it('reports partial failures in `failed` and still returns the successes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(directUploadOk('okimg'))
      .mockRejectedValueOnce(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);

    const { uploads, failed } = await svcWith(enabledClient()).createDirectUploads({
      count: 2,
      userId: 'u1',
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].id).toBe('okimg');
    expect(failed).toEqual([{ index: 1, error: 'direct_upload_failed' }]);
  });

  it('503s (with a failed list) when every mint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(
      svcWith(enabledClient()).createDirectUploads({ count: 1, userId: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('validates count (positive integer, at most MAX_ATTACHMENTS) before calling Cloudflare', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = svcWith(enabledClient());
    await expect(svc.createDirectUploads({ count: 0, userId: 'u1' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(svc.createDirectUploads({ count: 6, userId: 'u1' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(svc.createDirectUploads({ count: 1.5, userId: 'u1' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('UploadService.deleteImages', () => {
  it('best-effort deletes by key (preferred) and by parsed URL (fallback); never throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const svc = new UploadService({ cloudflareImages: new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' }) });
    await svc.deleteImages([
      { key: 'img1' },
      { url: 'https://imagedelivery.net/hash/img2/public' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.cloudflare.com/client/v4/accounts/acc/images/v1/img1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.cloudflare.com/client/v4/accounts/acc/images/v1/img2');
  });

  it('no-ops when disabled or empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await new UploadService({ cloudflareImages: new CloudflareImagesClient({}) }).deleteImages([{ key: 'x' }]);
    await new UploadService({ cloudflareImages: new CloudflareImagesClient({ accountId: 'a', apiToken: 't' }) }).deleteImages([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
