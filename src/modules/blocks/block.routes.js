/**
 * Layer: Transport (route definitions).
 * Declares /blocks routes guarded by requireAuth, with validate() zod schemas, mapping to
 * block.controller handlers. Factory receiving deps from the container.
 */
import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { z, objectIdString } from '../../common/validation/index.js';
import { createBlockController } from './block.controller.js';

export function createBlockRoutes(container) {
  const router = Router();
  const controller = createBlockController(container);
  const { requireAuth } = container;

  router.get('/', requireAuth, controller.list);

  router.post(
    '/',
    requireAuth,
    validate({ body: z.object({ userId: objectIdString }) }),
    controller.create,
  );

  router.delete(
    '/:userId',
    requireAuth,
    validate({ params: z.object({ userId: objectIdString }) }),
    controller.remove,
  );

  return router;
}

export default createBlockRoutes;
