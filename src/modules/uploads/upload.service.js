/**
 * Layer: Service.
 * Image-upload business logic (server-proxy flow): validate the incoming files (count/mime/size),
 * forward each buffer to Cloudflare Images via the injected CloudflareImagesClient, and return
 * attachment-ready objects the client can drop straight into a message's `attachments[]`.
 *
 * Partial-success contract: if some uploads fail, the succeeded ones are returned alongside an
 * explicit `failed` list (client retries just the failures) — never a silent drop. If EVERY upload
 * fails, throws 503. If Cloudflare is not configured, throws 503 (mirrors the old presign behavior).
 *
 * The Cloudflare client is injected (the composition root reads config, not this service) so the
 * service stays config-free and unit-testable.
 */
import { AppError } from '../../common/errors/AppError.js';
import { LIMITS } from '../../config/constants.js';

// Images only (a subset of the old presign allowlist, which also permitted application/pdf).
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB — matches the multer fileSize limit
const MAX_FILES = LIMITS.MAX_ATTACHMENTS; // 5 — keeps the "max 5 images per message" rule in lockstep

export class UploadService {
  constructor({ cloudflareImages }) {
    this.cf = cloudflareImages;
    this.enabled = Boolean(cloudflareImages?.enabled);
  }

  /**
   * Upload up to MAX_FILES images to Cloudflare.
   * @param {Array<{ buffer: Buffer, originalname: string, mimetype: string, size: number }>} files
   * @returns {Promise<{ images: object[], failed: object[] }>}
   */
  async uploadMany(files, { userId } = {}) {
    void userId; // reserved for future per-user keying/metrics; identity already enforced upstream
    if (!this.enabled) throw AppError.unavailable('Image uploads are not configured'); // 503
    if (!files?.length) throw AppError.validation('No image files provided');
    if (files.length > MAX_FILES) {
      throw AppError.validation(`At most ${MAX_FILES} images per request`);
    }
    // Defense-in-depth — multer's fileFilter/limits already enforce these, but re-check here so the
    // service is safe when called directly (e.g. unit tests) and independent of transport config.
    for (const f of files) {
      if (!ALLOWED_IMAGE_MIME.has(f.mimetype)) {
        throw AppError.validation(`Unsupported mime type: ${f.mimetype}`);
      }
      if (f.size > MAX_SIZE) throw AppError.validation('File exceeds the 10MB limit');
    }

    const settled = await Promise.allSettled(
      files.map((f) =>
        this.cf
          .uploadImage({ buffer: f.buffer, filename: f.originalname, mime: f.mimetype })
          .then(({ id, url }) => ({
            id,
            key: id, // attachment.key === Cloudflare image id (used later for deletion)
            url,
            mime: f.mimetype,
            size: f.size,
            filename: f.originalname,
          })),
      ),
    );

    const images = [];
    const failed = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        images.push(s.value);
      } else {
        // Do not leak the raw Cloudflare error / token — a stable code is enough for the client.
        failed.push({ filename: files[i].originalname, error: 'upload_failed' });
      }
    });

    if (images.length === 0) {
      // Distinguish "Cloudflare down / all failed" from valid partial success.
      throw AppError.unavailable('All image uploads failed', { failed });
    }
    return { images, failed };
  }

  /**
   * Best-effort Cloudflare cleanup for a message's attachments on unsend. Never throws — deletion is
   * fire-and-forget and must not block or fail the unsend. Prefers the stored `key` (Cloudflare id),
   * falling back to parsing the delivery URL.
   */
  async deleteImages(attachments = []) {
    if (!this.enabled || !attachments.length) return;
    await Promise.allSettled(
      attachments
        .map((a) => a?.key || this.cf.parseImageId(a?.url))
        .filter(Boolean)
        .map((id) => this.cf.deleteImage(id)),
    );
  }
}

export default UploadService;
