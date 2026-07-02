/**
 * Layer: Integration client (low-level Cloudflare Images REST wrapper).
 * Direct Creator Upload flow: the chat server asks Cloudflare for a ONE-TIME upload URL
 * (`POST /accounts/<id>/images/v2/direct_upload`, a tiny JSON call — NO file bytes) and hands it to
 * the client, which uploads the image bytes DIRECTLY to Cloudflare. The chat server never sees,
 * buffers, or re-encodes image bytes. Also deletes an image by id on message unsend.
 *
 * Why direct upload: the previous server-proxy flow buffered every image in RAM and re-streamed it
 * to Cloudflare on the same single-process event loop that serves realtime chat — causing GC
 * pressure, memory spikes, and PM2 restarts under load. Minting a one-time URL is O(bytes)=0 on us.
 *
 * Credentials/variant are passed via the CONSTRUCTOR (not read from config) so the client is
 * unit-testable with fake creds + a stubbed global fetch. Uses Node ≥20 globals (fetch/FormData) —
 * no axios or form-data dependency. NEVER logs the Authorization header or raw Cloudflare error
 * bodies (the API token is a Bearer secret).
 */
export class CloudflareImagesClient {
  constructor({ accountId, apiToken, variant = 'public', timeoutMs = 30_000 } = {}) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.variant = variant;
    this.timeoutMs = timeoutMs;
    // "enabled" gate — no network call on construction. Matches the presign-era 503 behavior.
    this.enabled = Boolean(accountId && apiToken);
    // v1 = per-image operations (delete). v2/direct_upload = mint a one-time creator-upload URL.
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;
    this.directUploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v2/direct_upload`;
  }

  /**
   * Mint a ONE-TIME direct-creator-upload URL. Returns the URL the client POSTs its file to
   * (multipart field `file`) plus the image `id` the image will have once uploaded. No bytes flow
   * through us. The URL is single-use and expires (see `expiryMinutes`).
   *
   * @param {object} [opts]
   * @param {object} [opts.metadata]           arbitrary tags stored on the image (e.g. {source:'chat'})
   * @param {boolean} [opts.requireSignedURLs]  false → delivery URLs are publicly viewable
   * @param {number} [opts.expiryMinutes]       URL validity window; Cloudflare requires 2min–6h
   * @returns {Promise<{ id: string, uploadURL: string }>}
   */
  async createDirectUploadUrl({ metadata, requireSignedURLs = false, expiryMinutes = 30 } = {}) {
    const form = new FormData();
    form.append('requireSignedURLs', requireSignedURLs ? 'true' : 'false');
    if (metadata) form.append('metadata', JSON.stringify(metadata));
    // Cloudflare requires `expiry` to be an RFC-3339 timestamp between now+2min and now+6h.
    const expiry = new Date(Date.now() + expiryMinutes * 60_000).toISOString();
    form.append('expiry', expiry);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.directUploadUrl, {
        method: 'POST',
        // Do NOT set Content-Type — undici sets the multipart boundary automatically.
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: form,
        signal: ac.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success || !json?.result?.uploadURL || !json?.result?.id) {
        // Never surface the token/headers or raw CF error body upstream.
        throw new Error(`Cloudflare direct_upload failed: ${res.status}`);
      }
      return { id: json.result.id, uploadURL: json.result.uploadURL };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Best-effort delete of a Cloudflare image by id. No-op when disabled or id is falsy. */
  async deleteImage(id) {
    if (!this.enabled || !id) return;
    await fetch(`${this.baseUrl}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
  }

  /**
   * Fallback id extraction from an imagedelivery.net delivery URL of the shape
   * `https://imagedelivery.net/<hash>/<imageId>/<variant>` — the second-to-last path segment.
   * Deletion should prefer the stored id (attachment.key); this is only a fallback.
   */
  parseImageId(url) {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      return segments[segments.length - 2];
    } catch {
      return undefined;
    }
  }
}

export default CloudflareImagesClient;
