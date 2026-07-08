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

    // POST /blocks { userId } — block a user. blockerId = authenticated caller. Echoes the
    // resulting directed status so the FE can update without a refetch.
    create: asyncHandler(async (req, res) => {
      const status = await blockService.block(req.userId, req.body.userId);
      res.status(201).json({ ok: true, status });
    }),

    // DELETE /blocks/:userId — unblock a user (idempotent). Echoes the resulting status (a reverse
    // block may still stand, so canMessage is not guaranteed true after unblocking).
    remove: asyncHandler(async (req, res) => {
      const status = await blockService.unblock(req.userId, req.params.userId);
      res.json({ ok: true, status });
    }),

    // GET /blocks/status/:userId — directed block status between the caller and :userId.
    status: asyncHandler(async (req, res) => {
      const status = await blockService.statusBetween(req.userId, req.params.userId);
      res.json({ status });
    }),
  };
}

export default createBlockController;
