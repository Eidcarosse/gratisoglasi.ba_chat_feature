/**
 * Layer: Repository (IMessageRepository — Mongo impl, TODAY).
 * Backs the message contract with MessageModel:
 *   - append:   findOneAndUpdate upsert on { conversationId, clientMessageId } with $setOnInsert
 *               → safe retries (a flaky-reconnect resend is a no-op, not a duplicate).
 *   - findByConversation: { conversationId, _id < before } sort _id:-1 limit  → KEYSET, not skip.
 *   - findByClientMessageId / getById: lean lookups.
 * Must NOT hold business logic.
 */
import mongoose from 'mongoose';
import { IMessageRepository } from './message.repository.interface.js';
import { MessageModel } from './message.model.js';
import { LIMITS } from '../../config/constants.js';

/** Larger of two optional ObjectId lower-bounds (by hex order == BSON order); null if both absent. */
function maxObjectId(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}

export class MongoMessageRepository extends IMessageRepository {
  /** Idempotent insert. Returns { message, created } — created=false on a dedup hit. */
  async append(message, { session } = {}) {
    const filter = {
      conversationId: message.conversationId,
      clientMessageId: message.clientMessageId,
    };
    const query = MessageModel.findOneAndUpdate(
      filter,
      { $setOnInsert: message },
      { upsert: true, new: true, setDefaultsOnInsert: true, includeResultMetadata: true },
    );
    if (session) query.session(session);
    const res = await query;
    const created = !res.lastErrorObject?.updatedExisting;
    return { message: res.value.toObject(), created };
  }

  async findByConversation(
    conversationId,
    { before, after, clearAfter, limit = LIMITS.DEFAULT_PAGE_SIZE } = {},
  ) {
    const q = { conversationId };
    const id = {};
    if (before) id.$lt = before; // keyset history, NOT skip
    // Lower bound = the greater of the reconnect-sync cursor (`after`) and the per-user "delete for
    // me" watermark (`clearAfter`). Both are `_id > x`; one field can hold only one $gt, so pick the
    // larger. ObjectId hex strings compare in the same order as BSON ObjectIds, so String() works.
    const floor = maxObjectId(after, clearAfter);
    if (floor) id.$gt = floor;
    if (Object.keys(id).length) q._id = id;
    // `after` powers reconnect-sync (oldest-first); otherwise history is newest-first.
    const sort = after ? { _id: 1 } : { _id: -1 };
    return MessageModel.find(q).sort(sort).limit(limit).lean();
  }

  async findByClientMessageId(conversationId, clientMessageId) {
    return MessageModel.findOne({ conversationId, clientMessageId }).lean();
  }

  async getById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return MessageModel.findById(id).lean();
  }

  /** Tombstone for unsend: set deletedAt, clear body + attachments. Keeps the doc (ordering). */
  async softDelete(conversationId, messageId) {
    return MessageModel.findOneAndUpdate(
      { _id: messageId, conversationId },
      { $set: { deletedAt: new Date(), body: '', attachments: [] } },
      { new: true },
    ).lean();
  }

  async deleteByConversation(conversationId, { session } = {}) {
    const query = MessageModel.deleteMany({ conversationId });
    if (session) query.session(session);
    return query;
  }
}

export default MongoMessageRepository;
