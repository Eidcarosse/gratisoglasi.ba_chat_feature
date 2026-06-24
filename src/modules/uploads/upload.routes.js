/**
 * Layer: Transport (route definitions).
 * Declares /uploads routes guarded by requireAuth, with validate() zod schemas, mapping to
 * upload.controller handlers. Factory receiving deps from the container.
 */
import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { z } from '../../common/validation/index.js';
import { createUploadController } from './upload.controller.js';

export function createUploadRoutes(container) {
  const router = Router();
  const controller = createUploadController(container);
  const { requireAuth } = container;

  router.post(
    '/presign',
    requireAuth,
    validate({
      body: z.object({
        mime: z.string().min(1),
        size: z.number().int().positive(),
        filename: z.string().min(1).optional(),
      }),
    }),
    controller.presign,
  );

  return router;
}

export default createUploadRoutes;
