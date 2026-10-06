/**
 * Layer: Repository (BlockRepository — Mongo impl).
 * Data access for user blocks: idempotent create (upsert), remove, listBothDirections (the
 * caller's outgoing and incoming blocks), and the bidirectional existsBetween used by the
 * write-path guards. The only place BlockModel is read/written. Reads use .lean(). Must NOT
 * hold business logic.
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

  /**
   * Both of a user's block directions in ONE query: the rows where they are the blocker
   * (outgoing) and the rows where they are the blocked (incoming). These are two projections
   * of the SAME rows — a row { blockerId: A, blockedId: B } is simultaneously an outgoing block
   * for A and an incoming block for B — so the two lists cannot drift apart. Nothing is stored
   * per-direction and nothing needs syncing.
   *
   * Both existing indexes serve this: { blockerId, blockedId } on its prefix for the outgoing
   * side, { blockedId } for the incoming side.
   *
   * @returns {Promise<{outgoing: object[], incoming: object[]}>} both newest-first
   */
  async listBothDirections(userId) {
    const rows = await BlockModel.find({
      $or: [{ blockerId: userId }, { blockedId: userId }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const outgoing = [];
    const incoming = [];
    for (const row of rows) {
      if (String(row.blockerId) === String(userId)) outgoing.push(row);
      else incoming.push(row);
    }
    return { outgoing, incoming };
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

  /**
   * Directed block state for a single pair, in ONE query. Returns { aBlockedB, bBlockedA } — the
   * primitive the status endpoint/conversation overlay use to expose "blockedByMe" vs
   * "blockedByThem" (existsBetween collapses both into one boolean and can't tell them apart).
   */
  async directionsBetween(a, b) {
    const rows = await BlockModel.find({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    }).lean();
    let aBlockedB = false;
    let bBlockedA = false;
    for (const r of rows) {
      if (String(r.blockerId) === String(a)) aBlockedB = true;
      else bBlockedA = true;
    }
    return { aBlockedB, bBlockedA };
  }

  /**
   * Batch directed block state between one caller and many others, in ONE query — used to annotate
   * the inbox without an N+1. Returns Map<otherId, { blockedByMe, blockedByThem }>; ids absent from
   * the map have no block in either direction. Keys are stringified other-user ids.
   */
  async blockedPairsFor(callerId, otherIds) {
    const map = new Map();
    if (!otherIds.length) return map;
    const rows = await BlockModel.find({
      $or: [
        { blockerId: callerId, blockedId: { $in: otherIds } },
        { blockedId: callerId, blockerId: { $in: otherIds } },
      ],
    }).lean();
    const entry = (id) => {
      const key = String(id);
      let e = map.get(key);
      if (!e) {
        e = { blockedByMe: false, blockedByThem: false };
        map.set(key, e);
      }
      return e;
    };
    for (const r of rows) {
      if (String(r.blockerId) === String(callerId)) entry(r.blockedId).blockedByMe = true;
      else entry(r.blockerId).blockedByThem = true;
    }
    return map;
  }
}

export default BlockRepository;
