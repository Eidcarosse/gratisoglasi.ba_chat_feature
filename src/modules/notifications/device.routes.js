/**
 * Layer: Transport (route definitions).
 * Declares /devices routes guarded by requireAuth, with validate() zod schemas, mapping to
 * device.controller handlers. Factory receiving deps from the container.
 */
import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { z } from '../../common/validation/index.js';
import { DEVICE_PLATFORM } from '../../config/constants.js';
import { createDeviceController } from './device.controller.js';

export function createDeviceRoutes(container) {
  const router = Router();
  const controller = createDeviceController(container);
  const { requireAuth } = container;

  router.post(
    '/',
    requireAuth,
    validate({
      body: z.object({ token: z.string().min(1), platform: z.enum(DEVICE_PLATFORM) }),
    }),
    controller.register,
  );

  router.delete(
    '/',
    requireAuth,
    validate({ body: z.object({ token: z.string().min(1) }) }),
    controller.unregister,
  );

  return router;
}

export default createDeviceRoutes;
