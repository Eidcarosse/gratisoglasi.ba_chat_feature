/**
 * Layer: Transport (route definitions).
 * Declares /conversations/:conversationId/messages routes guarded by requireAuth, with
 * validate() zod schemas (history cursor params, send body), mapping to message.controller
 * handlers. mergeParams:true so :conversationId from the parent mount is visible. Factory
 * receiving deps from the container.
 */
import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import {
  z,
  objectIdString,
  pagination,
  messageType,
  messageBody,
  clientMessageId,
  attachment,
} from '../../common/validation/index.js';
import { rateLimit } from '../../common/middleware/rateLimit.js';
import { RATE_LIMITS } from '../../config/constants.js';
import { createMessageController } from './message.controller.js';

export function createMessageRoutes(container) {
  const router = Router({ mergeParams: true });
  const controller = createMessageController(container);
  const { requireAuth } = container;

  const paramsSchema = z.object({ conversationId: objectIdString });

  router.get(
    '/',
    requireAuth,
    validate({ params: paramsSchema, query: pagination }),
    controller.history,
  );

  router.post(
    '/',
    requireAuth,
    rateLimit({ ...RATE_LIMITS.MESSAGE_SEND, keyPrefix: 'msg' }),
    validate({
      params: paramsSchema,
      body: z
        .object({
          clientMessageId,
          type: messageType,
          body: messageBody.optional(),
          attachments: z.array(attachment).optional(),
        })
        .refine((d) => d.type !== 'text' || (d.body && d.body.length > 0), {
          message: 'Text messages require a body',
          path: ['body'],
        }),
    }),
    controller.send,
  );

  return router;
}

export default createMessageRoutes;
