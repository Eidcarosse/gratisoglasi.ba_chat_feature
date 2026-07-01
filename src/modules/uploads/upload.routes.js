/**
 * Layer: Transport (route definitions).
 * Declares /uploads routes guarded by requireAuth. POST /uploads/images accepts multipart image
 * files (server-proxy upload to Cloudflare Images). Guards run BEFORE multer so unauthenticated /
 * rate-limited requests are rejected before any bytes are buffered into memory. Factory receiving
 * deps from the container.
 */
import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../common/errors/AppError.js';
import { rateLimit } from '../../common/middleware/rateLimit.js';
import { RATE_LIMITS, LIMITS } from '../../config/constants.js';
import { createUploadController } from './upload.controller.js';

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Memory storage: files buffer in RAM (up to MAX_ATTACHMENTS × 10 MB per request) and are forwarded
// straight to Cloudflare — never written to disk. NOTE: express.json({ limit: '256kb' }) is
// content-type gated and does NOT apply to multipart/form-data; multer's limits.fileSize governs.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: LIMITS.MAX_ATTACHMENTS },
  fileFilter: (req, file, cb) =>
    ALLOWED_IMAGE_MIME.has(file.mimetype)
      ? cb(null, true)
      : cb(AppError.validation(`Only image files are allowed: ${file.mimetype}`)),
});

// Multer surfaces MulterError / fileFilter errors OUTSIDE the AppError family; without this wrapper
// they'd hit the generic 500 branch in the central error handler. Translate them to 400 VALIDATION.
const handleUpload = (mw) => (req, res, next) =>
  mw(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err); // from fileFilter
    if (err?.name === 'MulterError') {
      const msg =
        {
          LIMIT_FILE_SIZE: 'One or more files exceed the 10MB limit',
          LIMIT_FILE_COUNT: `At most ${LIMITS.MAX_ATTACHMENTS} images per request`,
          LIMIT_UNEXPECTED_FILE: 'Unexpected file field — use "images"',
        }[err.code] || `Upload error: ${err.code}`;
      return next(AppError.validation(msg));
    }
    return next(err);
  });

export function createUploadRoutes(container) {
  const router = Router();
  const controller = createUploadController(container);
  const { requireAuth } = container;

  router.post(
    '/images',
    requireAuth,
    rateLimit({ ...RATE_LIMITS.IMAGE_UPLOAD, keyPrefix: 'imgup' }),
    handleUpload(
      upload.fields([
        { name: 'images', maxCount: LIMITS.MAX_ATTACHMENTS },
        { name: 'image', maxCount: LIMITS.MAX_ATTACHMENTS },
      ]),
    ),
    controller.uploadImages,
  );

  return router;
}

export default createUploadRoutes;
