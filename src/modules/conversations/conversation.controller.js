/**
 * Layer: Transport (REST controller).
 * Conversation HTTP endpoints (list inbox, find-or-create for an item, get one): validate input,
 * rely on the service to enforce that req.userId is a participant, call conversationService,
 * shape the response. Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createConversationController({ conversationService }) {
  return {
    // POST /conversations { itemId, counterpartId? } — without counterpartId the caller is the
    // buyer; with it the caller must be the seller and counterpartId an accepted bidder.
    create: asyncHandler(async (req, res) => {
      const convo = await conversationService.findOrCreate(req.body.itemId, req.userId, {
        counterpartId: req.body.counterpartId,
      });
      res.status(201).json({ conversation: convo });
    }),

    // GET /conversations — inbox (snapshot only).
    listInbox: asyncHandler(async (req, res) => {
      const conversations = await conversationService.listInbox(req.userId);
      res.json({ conversations });
    }),

    // GET /conversations/:conversationId — open w/ live item refresh.
    getOne: asyncHandler(async (req, res) => {
      const convo = await conversationService.open(req.params.conversationId, req.userId);
      res.json({ conversation: convo });
    }),

    // DELETE /conversations/:conversationId — "delete for me" (hide from caller's inbox).
    remove: asyncHandler(async (req, res) => {
      await conversationService.hideForUser(req.params.conversationId, req.userId);
      res.json({ ok: true });
    }),

    // PATCH /conversations/:conversationId/mute { muted } — mute/unmute push for the caller.
    mute: asyncHandler(async (req, res) => {
      await conversationService.setMute(req.params.conversationId, req.userId, req.body.muted);
      res.json({ ok: true, muted: req.body.muted });
    }),
  };
}

export default createConversationController;
