/**
 * Layer: Transport (REST controller).
 * Upload HTTP endpoint (POST /uploads/direct-upload): mint one-time Cloudflare direct-upload URLs
 * (Direct Creator Upload flow) so the client uploads image bytes DIRECTLY to Cloudflare — no bytes
 * ever pass through this server. Returns the URLs + image ids plus any `failed` mints (partial-
 * success contract) and the URL expiry window.
 * Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createUploadController({ uploadService }) {
  return {
    createDirectUploads: asyncHandler(async (req, res) => {
      // `count` is validated + defaulted (1..MAX_ATTACHMENTS) by the route's zod schema.
      const { count } = req.body;
      const { uploads, failed, expiresInSeconds } = await uploadService.createDirectUploads({
        count,
        userId: req.userId,
      });
      res.json({ uploads, failed, expiresInSeconds });
    }),
  };
}

export default createUploadController;
