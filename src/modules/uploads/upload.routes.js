/**
 * Layer: Transport (route definitions).
 * Declares /uploads routes guarded by requireAuth. POST /uploads/direct-upload mints one-time
 * Cloudflare direct-creator-upload URLs — a tiny JSON request/response. NO file bytes touch this
 * server (no multer, no memory buffering): the client uploads bytes DIRECTLY to Cloudflare using
 * the returned URL. Factory receiving deps from the container.
 */
import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { z } from '../../common/validation/index.js';
import { rateLimit } from '../../common/middleware/rateLimit.js';
import { RATE_LIMITS, LIMITS } from '../../config/constants.js';
import { createUploadController } from './upload.controller.js';

export function createUploadRoutes(container) {
  const router = Router();
  const controller = createUploadController(container);
  const { requireAuth } = container;

  router.post(
    '/direct-upload',
    requireAuth,
    rateLimit({ ...RATE_LIMITS.IMAGE_UPLOAD, keyPrefix: 'imgup' }),
    validate({
      // How many one-time upload URLs to mint. Defaults to 1; capped at the per-message attachment
      // limit. Size/mime are enforced by Cloudflare at upload time (we never see the bytes).
      body: z.object({
        count: z.coerce.number().int().min(1).max(LIMITS.MAX_ATTACHMENTS).default(1),
      }),
    }),
    controller.createDirectUploads,
  );

  return router;
}

export default createUploadRoutes;
