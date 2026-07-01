/**
 * Unit tests for the Cloudflare Images client + UploadService (no app boot, no DB).
 * global fetch is stubbed; the client is constructed with explicit fake creds so nothing reads the
 * frozen env-backed config.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CloudflareImagesClient } from '../src/modules/uploads/cloudflareImages.client.js';
import { UploadService } from '../src/modules/uploads/upload.service.js';

const file = (name = 'a.jpg', mime = 'image/jpeg', size = 5) => ({
  buffer: Buffer.from('bytes'),
  originalname: name,
  mimetype: mime,
  size,
});

const okResponse = (id = 'img1', variants = [`https://imagedelivery.net/hash/${id}/public`]) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, result: { id, variants } }),
});

afterEach(() => vi.unstubAllGlobals());

describe('CloudflareImagesClient', () => {
  it('is enabled only when both account id and token are present', () => {
    expect(new CloudflareImagesClient({}).enabled).toBe(false);
    expect(new CloudflareImagesClient({ accountId: 'acc' }).enabled).toBe(false);
    expect(new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' }).enabled).toBe(true);
  });

  it('POSTs to the accounts URL with Bearer auth, a FormData body, and no manual Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('img1'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok', variant: 'public' });
    const res = await client.uploadImage({ buffer: Buffer.from('x'), filename: 'a.jpg', mime: 'image/jpeg' });

    expect(res).toEqual({ id: 'img1', url: 'https://imagedelivery.net/hash/img1/public' });
    const [calledUrl, opts] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.cloudflare.com/client/v4/accounts/acc/images/v1');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
    // Chat-origin tag + unsigned delivery URLs are sent in the multipart body.
    expect(opts.body.get('metadata')).toBe(JSON.stringify({ source: 'chat' }));
    expect(opts.body.get('requireSignedURLs')).toBe('false');
  });

  it('selects the configured variant, falling back to variants[0]', async () => {
    const variants = [
      'https://imagedelivery.net/hash/img1/public',
      'https://imagedelivery.net/hash/img1/thumb',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('img1', variants)));

    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok', variant: 'thumb' });
    const res = await client.uploadImage({ buffer: Buffer.from('x'), filename: 'a.jpg', mime: 'image/jpeg' });
    expect(res.url).toBe('https://imagedelivery.net/hash/img1/thumb');
  });

  it('throws on non-2xx or unsuccessful responses (without leaking the token)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) }));
    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });
    await expect(
      client.uploadImage({ buffer: Buffer.from('x'), filename: 'a.jpg', mime: 'image/jpeg' }),
    ).rejects.toThrow(/Cloudflare upload failed/);
  });

  it('parseImageId extracts the id from a delivery URL and is safe on garbage', () => {
    const client = new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });
    expect(client.parseImageId('https://imagedelivery.net/hash/img1/public')).toBe('img1');
    expect(client.parseImageId('not a url')).toBeUndefined();
  });
});

describe('UploadService.uploadMany', () => {
  const svcWith = (client) => new UploadService({ cloudflareImages: client });
  const enabledClient = () => new CloudflareImagesClient({ accountId: 'acc', apiToken: 'tok' });

  it('503s when Cloudflare is not configured', async () => {
    const svc = svcWith(new CloudflareImagesClient({}));
    await expect(svc.uploadMany([file()], { userId: 'u1' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('returns attachment-ready objects on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('img1')));
    const { images, failed } = await svcWith(enabledClient()).uploadMany([file('a.jpg')], { userId: 'u1' });
    expect(failed).toEqual([]);
    expect(images).toEqual([
      {
        id: 'img1',
        key: 'img1',
        url: 'https://imagedelivery.net/hash/img1/public',
        mime: 'image/jpeg',
        size: 5,
        filename: 'a.jpg',
      },
    ]);
  });

  it('reports partial failures in `failed` and still returns the successes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse('okimg'))
      .mockRejectedValueOnce(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);

    const { images, failed } = await svcWith(enabledClient()).uploadMany(
      [file('good.jpg'), file('bad.jpg')],
      { userId: 'u1' },
    );
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe('good.jpg');
    expect(failed).toEqual([{ filename: 'bad.jpg', error: 'upload_failed' }]);
  });

  it('503s (with a failed list) when every upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(svcWith(enabledClient()).uploadMany([file()], { userId: 'u1' })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('validates empty / too-many / bad-mime / oversized before uploading', async () => {
    const svc = svcWith(enabledClient());
    await expect(svc.uploadMany([], { userId: 'u1' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      svc.uploadMany(Array.from({ length: 6 }, () => file()), { userId: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      svc.uploadMany([file('a.pdf', 'application/pdf')], { userId: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      svc.uploadMany([file('big.jpg', 'image/jpeg', 11 * 1024 * 1024)], { userId: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
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
