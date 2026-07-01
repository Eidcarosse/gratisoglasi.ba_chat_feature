/**
 * Layer: Transport (REST controller).
 * Upload HTTP endpoint (POST /uploads/images): flatten the multipart files (multer has already
 * parsed + validated them), call uploadService, return the uploaded images plus any `failed`
 * entries (partial-success contract) and a flat `imageUrls` list for convenience.
 * Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createUploadController({ uploadService }) {
  return {
    uploadImages: asyncHandler(async (req, res) => {
      // Accept both the primary `images` field and the singular `image` (main-BE parity).
      const files = [...(req.files?.images ?? []), ...(req.files?.image ?? [])];
      const { images, failed } = await uploadService.uploadMany(files, { userId: req.userId });
      res.json({ images, failed, imageUrls: images.map((i) => i.url) });
    }),
  };
}

export default createUploadController;
