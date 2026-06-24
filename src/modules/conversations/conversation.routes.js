/**
 * Layer: Transport (route definitions).
 * Declares /conversations routes guarded by requireAuth, with validate() zod schemas, mapping
 * to conversation.controller handlers. The find-or-create POST carries the dedicated
 * new-conversation rate limiter (anti-scam). Factory receiving deps from the container.
 */
import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { z, objectId, objectIdString } from '../../common/validation/index.js';
import { createConversationController } from './conversation.controller.js';

export function createConversationRoutes(container) {
  const router = Router();
  const controller = createConversationController(container);
  const { requireAuth, newConversationLimiter } = container;

  router.get('/', requireAuth, controller.listInbox);

  router.post(
    '/',
    requireAuth,
    newConversationLimiter,
    validate({ body: z.object({ itemId: objectId }) }),
    controller.create,
  );

  router.get(
    '/:conversationId',
    requireAuth,
    validate({ params: z.object({ conversationId: objectIdString }) }),
    controller.getOne,
  );

  return router;
}

export default createConversationRoutes;
