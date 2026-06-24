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

export class MongoMessageRepository extends IMessageRepository {
  /** Idempotent insert. Returns { message, created } — created=false on a dedup hit. */
  async append(message) {
    const filter = {
      conversationId: message.conversationId,
      clientMessageId: message.clientMessageId,
    };
    const res = await MessageModel.findOneAndUpdate(
      filter,
      { $setOnInsert: message },
      { upsert: true, new: true, setDefaultsOnInsert: true, includeResultMetadata: true },
    );
    const created = !res.lastErrorObject?.updatedExisting;
    return { message: res.value.toObject(), created };
  }

  async findByConversation(
    conversationId,
    { before, after, limit = LIMITS.DEFAULT_PAGE_SIZE } = {},
  ) {
    const q = { conversationId };
    if (before) q._id = { $lt: before }; // keyset history, NOT skip
    // `after` powers reconnect-sync: messages newer than the client's last-held id (oldest-first).
    if (after) {
      q._id = { ...(q._id || {}), $gt: after };
      return MessageModel.find(q).sort({ _id: 1 }).limit(limit).lean();
    }
    return MessageModel.find(q).sort({ _id: -1 }).limit(limit).lean();
  }

  async findByClientMessageId(conversationId, clientMessageId) {
    return MessageModel.findOne({ conversationId, clientMessageId }).lean();
  }

  async getById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return MessageModel.findById(id).lean();
  }
}

export default MongoMessageRepository;
