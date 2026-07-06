/**
 * Layer: Transport (REST controller).
 * Block endpoints (list blocked users, block a user, unblock a user): validate input, take the
 * blocker identity from req.userId (never the body), call blockService, shape the response.
 * Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createBlockController({ blockService }) {
  return {
    // GET /blocks — the caller's blocked-user list (hydrated with display data).
    list: asyncHandler(async (req, res) => {
      const blocks = await blockService.listBlocked(req.userId);
      res.json({ blocks });
    }),

    // POST /blocks { userId } — block a user. blockerId = authenticated caller.
    create: asyncHandler(async (req, res) => {
      await blockService.block(req.userId, req.body.userId);
      res.status(201).json({ ok: true });
    }),

    // DELETE /blocks/:userId — unblock a user (idempotent).
    remove: asyncHandler(async (req, res) => {
      await blockService.unblock(req.userId, req.params.userId);
      res.json({ ok: true });
    }),
  };
}

export default createBlockController;
