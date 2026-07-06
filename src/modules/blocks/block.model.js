/**
 * Layer: Model (Mongoose schema — chat DB).
 * blocks collection — one row per (blocker, blocked) directed pair. A user blocking another
 * inserts { blockerId, blockedId }; the guards on the message-send and conversation-create write
 * paths treat a block in EITHER direction as forbidding contact both ways (see block.repository
 * existsBetween). Ids are main-site users._id (ObjectId, UNENFORCED cross-DB ref).
 *
 * Indexes:
 *   { blockerId: 1, blockedId: 1 } unique  -> one row per directed pair; makes block idempotent
 *   { blockedId: 1 }                        -> reverse lookups (who blocked me)
 * Schema + indexes only; no cross-entity logic.
 */
import mongoose from 'mongoose';

const blockSchema = new mongoose.Schema(
  {
    // The user who created the block (from req.userId — never a client-supplied id).
    blockerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // The user being blocked.
    blockedId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedId: 1 });

export const BlockModel = mongoose.model('Block', blockSchema);
export default BlockModel;
