/**
 * Layer: Service.
 * Image-upload business logic (Direct Creator Upload flow): mint one or more ONE-TIME Cloudflare
 * upload URLs the client uploads its image bytes DIRECTLY to. The chat server never sees, buffers,
 * or re-encodes image bytes — it only ever handles small JSON. This is the root-cause fix for the
 * memory/GC/PM2-restart pressure the old server-proxy (multer buffering) flow put on the single
 * realtime process.
 *
 * Two-step, moderation-friendly contract (see docs §5.6):
 *   1) client → POST /uploads/direct-upload { count }  → this service mints N { id, uploadURL }
 *   2) client → uploads bytes DIRECTLY to each uploadURL (Cloudflare)
 *   3) client → message:send with attachments referencing the image id/url (a SEPARATE step)
 * Keeping "attach to a message" separate from "upload" is deliberate: a future async moderation
 * worker can gate an image's visibility on approval before it appears in a message, without
 * reworking message creation. See the TODO(moderation) below and message.model.js.
 *
 * Partial-success contract: if some URL mints fail, the succeeded ones are returned alongside an
 * explicit `failed` list. If EVERY mint fails, throws 503. If Cloudflare is not configured, throws
 * 503 (mirrors the old presign behavior). The Cloudflare client is injected (the composition root
 * reads config, not this service) so the service stays config-free and unit-testable.
 */
import { AppError } from '../../common/errors/AppError.js';
import { LIMITS } from '../../config/constants.js';

const MAX_FILES = LIMITS.MAX_ATTACHMENTS; // 5 — keeps the "max 5 images per message" rule in lockstep
// One-time upload URLs are short-lived and single-use. 30 min gives a user ample time to pick and
// upload on a flaky mobile network; Cloudflare requires this to be between 2 min and 6 h.
const DIRECT_UPLOAD_EXPIRY_MINUTES = 30;

export class UploadService {
  constructor({ cloudflareImages }) {
    this.cf = cloudflareImages;
    this.enabled = Boolean(cloudflareImages?.enabled);
  }

  /**
   * Mint up to MAX_FILES one-time Cloudflare direct-upload URLs.
   *
   * NOTE on validation that MOVED off the server: because we no longer receive bytes, per-file
   * SIZE and MIME are enforced by Cloudflare Images at direct-upload time (it rejects non-images and
   * anything over the account's max), not here. The client should still pre-check size/type for UX.
   * What we DO still enforce server-side is the per-request COUNT cap (we control how many URLs we
   * mint). See docs §5.6 for the exact client contract.
   *
   * @param {object} args
   * @param {number} [args.count=1]  how many upload URLs to mint (1..MAX_FILES)
   * @param {string} [args.userId]   authenticated caller (reserved for future per-user tagging)
   * @returns {Promise<{ uploads: Array<{id:string, uploadURL:string}>, failed: object[], expiresInSeconds: number }>}
   */
  async createDirectUploads({ count = 1, userId } = {}) {
    void userId; // reserved for future per-user metadata/metrics; identity already enforced upstream
    if (!this.enabled) throw AppError.unavailable('Image uploads are not configured'); // 503
    if (!Number.isInteger(count) || count < 1) {
      throw AppError.validation('count must be a positive integer');
    }
    if (count > MAX_FILES) {
      throw AppError.validation(`At most ${MAX_FILES} images per request`);
    }

    const settled = await Promise.allSettled(
      Array.from({ length: count }, () =>
        this.cf.createDirectUploadUrl({
          // TODO(moderation): to gate visibility behind async moderation later, mint with
          // requireSignedURLs:true and serve signed URLs only AFTER approval. Kept false today so
          // delivery URLs stay publicly viewable (matches prior behavior). Flipping this is safe
          // because we store the Cloudflare image id (attachment.key) — a future moderation worker
          // has everything it needs to approve/serve/delete per image without a re-upload.
          requireSignedURLs: false,
          metadata: { source: 'chat' },
          expiryMinutes: DIRECT_UPLOAD_EXPIRY_MINUTES,
        }),
      ),
    );

    const uploads = [];
    const failed = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        uploads.push(s.value);
      } else {
        // Do not leak the raw Cloudflare error / token — a stable code is enough for the client.
        failed.push({ index: i, error: 'direct_upload_failed' });
      }
    });

    if (uploads.length === 0) {
      // Distinguish "Cloudflare down / all failed" from valid partial success.
      throw AppError.unavailable('Could not create image upload URLs', { failed });
    }
    return { uploads, failed, expiresInSeconds: DIRECT_UPLOAD_EXPIRY_MINUTES * 60 };
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
