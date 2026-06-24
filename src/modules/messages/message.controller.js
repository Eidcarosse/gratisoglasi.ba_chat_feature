/**
 * Layer: Transport (REST controller).
 * Message HTTP endpoints (history fetch with keyset pagination; REST send fallback for
 * non-socket clients): validate input, let the service enforce membership, call messageService,
 * shape the response. The realtime path lives in realtime/handlers/message.handler.js.
 * Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createMessageController({ messageService }) {
  return {
    // GET /conversations/:conversationId/messages?before=&limit=
    history: asyncHandler(async (req, res) => {
      const messages = await messageService.history(req.params.conversationId, req.userId, {
        before: req.query.before,
        limit: req.query.limit,
      });
      res.json({ messages });
    }),

    // POST /conversations/:conversationId/messages  (REST fallback for the socket path)
    send: asyncHandler(async (req, res) => {
      const message = await messageService.send({
        conversationId: req.params.conversationId,
        senderId: req.userId,
        clientMessageId: req.body.clientMessageId,
        type: req.body.type,
        body: req.body.body,
        attachments: req.body.attachments,
      });
      res.status(201).json({ message });
    }),
  };
}

export default createMessageController;
