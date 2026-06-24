/**
 * Layer: Transport (REST controller).
 * Upload HTTP endpoint (POST /uploads/presign): validate the requested mime/size, call
 * uploadService, return { url, key } to the client. Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createUploadController({ uploadService }) {
  return {
    presign: asyncHandler(async (req, res) => {
      const result = await uploadService.presign({
        userId: req.userId,
        mime: req.body.mime,
        size: req.body.size,
        filename: req.body.filename,
      });
      res.json(result);
    }),
  };
}

export default createUploadController;
