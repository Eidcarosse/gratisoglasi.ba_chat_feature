/**
 * Layer: Integration client (low-level Cloudflare Images REST wrapper).
 * Server-proxy upload: the chat server forwards a file buffer to Cloudflare Images'
 * `POST /accounts/<id>/images/v1` (multipart, field name `file`) and reads back the delivery URL —
 * mirroring the main marketplace backend's flow. Also deletes an image by id on message unsend.
 *
 * Credentials/variant are passed via the CONSTRUCTOR (not read from config) so the client is
 * unit-testable with fake creds + a stubbed global fetch. Uses Node ≥20 globals (fetch/FormData/
 * Blob) — no axios or form-data dependency. NEVER logs the Authorization header or raw Cloudflare
 * error bodies (the API token is a Bearer secret).
 */
export class CloudflareImagesClient {
  constructor({ accountId, apiToken, variant = 'public', timeoutMs = 30_000 } = {}) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.variant = variant;
    this.timeoutMs = timeoutMs;
    // "enabled" gate — no network call on construction. Matches the presign-era 503 behavior.
    this.enabled = Boolean(accountId && apiToken);
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;
  }

  /**
   * Upload one image buffer to Cloudflare Images.
   * @returns {Promise<{ id: string, url: string }>} the image id + selected variant delivery URL.
   */
  async uploadImage({ buffer, filename, mime }) {
    const form = new FormData();
    // Cloudflare expects the multipart field name to be exactly "file".
    form.append('file', new Blob([buffer], { type: mime }), filename);
    // Serve public (unsigned) delivery URLs so the returned URL is viewable without a signature.
    form.append('requireSignedURLs', 'false');
    // Tag chat-origin images so they stay identifiable if this Cloudflare account is shared with the
    // main site's listing images (see docs) — enables safe auditing/cleanup scoped to chat uploads.
    form.append('metadata', JSON.stringify({ source: 'chat' }));

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        // Do NOT set Content-Type — undici sets the multipart boundary automatically.
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: form,
        signal: ac.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success || !json?.result) {
        // Never surface the token/headers or raw CF error body upstream.
        throw new Error(`Cloudflare upload failed: ${res.status}`);
      }
      const variants = json.result.variants ?? [];
      const url = variants.find((v) => v.split('/').pop() === this.variant) ?? variants[0];
      if (!url) throw new Error('Cloudflare returned no variant URL');
      return { id: json.result.id, url };
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
