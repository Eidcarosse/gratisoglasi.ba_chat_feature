/**
 * Layer: Repository (BlockRepository — Mongo impl).
 * Data access for user blocks: idempotent create (upsert), remove, list-by-blocker, and the
 * bidirectional existsBetween used by the write-path guards. The only place BlockModel is
 * read/written. Reads use .lean(). Must NOT hold business logic.
 */
import { BlockModel } from './block.model.js';

export class BlockRepository {
  /**
   * Idempotent create keyed by the unique { blockerId, blockedId } index. Re-blocking the same
   * user returns the existing row instead of throwing a duplicate-key error.
   */
  async create(blockerId, blockedId) {
    return BlockModel.findOneAndUpdate(
      { blockerId, blockedId },
      { $setOnInsert: { blockerId, blockedId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  /** Remove a block. Idempotent — deleting a non-existent block reports deletedCount: 0, not an error. */
  async remove(blockerId, blockedId) {
    return BlockModel.deleteOne({ blockerId, blockedId });
  }

  /** All users this blocker has blocked, newest first. */
  async listByBlocker(blockerId) {
    return BlockModel.find({ blockerId }).sort({ createdAt: -1 }).lean();
  }

  /**
   * True if a block exists in EITHER direction between a and b. This is the bidirectional guard:
   * if A blocked B (or B blocked A), neither may contact the other.
   */
  async existsBetween(a, b) {
    const found = await BlockModel.exists({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    });
    return Boolean(found);
  }
}

export default BlockRepository;
