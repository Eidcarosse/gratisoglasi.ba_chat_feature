/**
 * Layer: Repository (IMessageRepository — shared `messages` collection).
 * Backs the message contract with the Fastify-schema `messages` collection and keeps the legacy message
 * shape on the way out (message.mapper.js):
 *   - append:  one transaction inserts the message AND its `message.sent` outbox event (Fastify Decision 40).
 *              Idempotent on { roomId, clientMessageId }: a flaky-reconnect resend returns the stored copy.
 *   - findByConversation: keyset on `_id` (before / after / the caller's "delete for me" floor), ordered by
 *              (createdAt, _id) so the {roomId, createdAt, _id} history index serves it.
 *   - softDelete: the unsend tombstone (type 'system', no text, no attachments, deletedAt).
 * Must NOT hold business logic.
 */
import mongoose from 'mongoose';
import { IMessageRepository } from './message.repository.interface.js';
import { MessageModel } from './message.model.js';
import { OutboxModel } from './outbox.model.js';
import { ConversationModel } from '../conversations/conversation.model.js';
import { toLegacyMessage, toSharedAttachments } from './message.mapper.js';
import { LIMITS } from '../../config/constants.js';

/** Larger of two optional ObjectId lower-bounds (hex order == BSON order); null if both absent. */
function maxObjectId(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}

export class MongoMessageRepository extends IMessageRepository {
  /** Idempotent insert. Returns { message, created } — created=false on a dedup hit. */
  async append(message, { session } = {}) {
    const roomId = message.conversationId;
    const lookup = MessageModel.findOne({ roomId, clientMessageId: message.clientMessageId }).lean();
    if (session) lookup.session(session);
    const existing = await lookup;
    if (existing) return { message: toLegacyMessage(existing), created: false };

    const roomQuery = ConversationModel.findById(roomId).select({ buyerId: 1, sellerId: 1 }).lean();
    if (session) roomQuery.session(session);
    const room = await roomQuery;
    const recipientId = room && String(room.buyerId) === String(message.senderId) ? room.sellerId : room?.buyerId;

    const [created] = await MessageModel.create(
      [
        {
          roomId,
          senderId: message.senderId,
          type: message.type,
          text: message.type === 'text' ? message.body : null,
          attachments: toSharedAttachments(message.attachments),
          clientMessageId: message.clientMessageId,
          deletedAt: null,
          schemaVersion: 2,
          createdAt: message.createdAt,
          expiresAt: message.expiresAt ?? null,
        },
      ],
      { session },
    );
    // This service sends its own push with the legacy payloads old apps navigate on, so the Fastify worker
    // must not push the same message a second time (pushRequested: false).
    await OutboxModel.create(
      [
        {
          type: 'message.sent',
          aggregateId: created._id,
          payload: {
            roomId,
            senderId: message.senderId,
            recipientId: recipientId ?? null,
            clientMessageId: message.clientMessageId,
            pushRequested: false,
          },
          runAt: new Date(),
        },
      ],
      { session },
    );
    return { message: toLegacyMessage(created.toObject()), created: true };
  }

  async findByConversation(
    conversationId,
    { before, after, clearAfter, limit = LIMITS.DEFAULT_PAGE_SIZE } = {},
  ) {
    const q = { roomId: conversationId };
    const id = {};
    if (before) id.$lt = before; // keyset history, NOT skip
    // Lower bound = the greater of the reconnect-sync cursor (`after`) and the per-user "delete for me"
    // floor (`clearAfter`): both are `_id > x` and one field can hold only one $gt.
    const floor = maxObjectId(after, clearAfter);
    if (floor) id.$gt = floor;
    if (Object.keys(id).length) q._id = id;
    // `after` powers reconnect-sync (oldest-first); otherwise history is newest-first.
    const sort = after ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };
    const rows = await MessageModel.find(q).sort(sort).limit(limit).lean();
    return rows.map(toLegacyMessage);
  }

  async findByClientMessageId(conversationId, clientMessageId) {
    const row = await MessageModel.findOne({ roomId: conversationId, clientMessageId }).lean();
    return row ? toLegacyMessage(row) : null;
  }

  async getById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const row = await MessageModel.findById(id).lean();
    return row ? toLegacyMessage(row) : null;
  }

  /** Tombstone for unsend (Fastify §6.8): keeps the row so ordering and read watermarks stay coherent. */
  async softDelete(conversationId, messageId) {
    const row = await MessageModel.findOneAndUpdate(
      { _id: messageId, roomId: conversationId },
      { $set: { type: 'system', text: null, attachments: [], deletedAt: new Date() } },
      { new: true },
    ).lean();
    return row ? toLegacyMessage(row) : null;
  }
}

export default MongoMessageRepository;
