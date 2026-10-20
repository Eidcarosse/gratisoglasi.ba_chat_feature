/**
 * Layer: Repository (IConversationRepository — shared `chat_rooms`).
 * The only place chat rooms are read/written. It keeps the contract the services were written against —
 * legacy conversation objects in, legacy conversation objects out — and translates to the shared Fastify
 * schema underneath (explicit buyer / seller fields, tuple read watermarks, a monotonic preview).
 * Writes are the same targeted operations Fastify performs (repairRoomAfterMessage, markRead, deleteForMe),
 * so a chat sent from either service leaves the room in the same state. Must NOT hold business logic.
 */
import mongoose from 'mongoose';
import { ConversationModel } from './conversation.model.js';
import { MessageModel } from '../messages/message.model.js';
import { toLegacyConversation } from './conversation.mapper.js';
import { unescapeBody } from '../messages/message.mapper.js';

const MIN_OID = new mongoose.Types.ObjectId('000000000000000000000000');
const PREVIEW_MAX = 200;

/** Legacy preview ({ body, type, deletedAt }) -> the shared room preview { text, type }. */
function sharedPreview(last) {
  if (last.deletedAt) return { text: '', type: 'system' };
  if (last.type === 'text') return { text: unescapeBody(last.body).slice(0, PREVIEW_MAX), type: 'text' };
  return { text: '', type: last.type };
}

export class ConversationRepository {
  /**
   * @param {object} deps
   * @param {(ids: string[]) => Promise<Map<string, {displayName: string, avatarUrl: string|null}>>} deps.getUserSummaries
   * @param {(adIds: string[]) => Promise<Map<string, string|null>>} deps.getItemStatuses  legacy moderation labels
   */
  constructor({ getUserSummaries, getItemStatuses }) {
    this.getUserSummaries = getUserSummaries;
    this.getItemStatuses = getItemStatuses;
  }

  /** Map rooms to legacy conversations, resolving participants and ad status in two batched queries. */
  async #present(rooms, { status } = {}) {
    if (rooms.length === 0) return [];
    const userIds = [...new Set(rooms.flatMap((r) => [String(r.buyerId), String(r.sellerId)]))];
    const summaries = await this.getUserSummaries(userIds);
    const statuses = status === undefined ? await this.getItemStatuses([...new Set(rooms.map((r) => String(r.adId)))]) : null;
    return rooms.map((room) => toLegacyConversation(room, { summaries, status: status !== undefined ? status : statuses.get(String(room.adId)) ?? null }));
  }

  /**
   * Atomic find-or-create keyed by the unique { adId, buyerId } index (a room is per ad and buyer). The ad
   * snapshot is only written on insert, so an existing room keeps its original title / image / price.
   * `lastMessageAt` is seeded so the new room is visible in both inboxes (Fastify's inbox index needs a date).
   */
  async findOrCreate({ itemId, participantIds, item, expiresAt }) {
    const [buyerId, sellerId] = participantIds;
    const room = await ConversationModel.findOneAndUpdate(
      { adId: itemId, buyerId },
      {
        $setOnInsert: {
          adId: itemId,
          buyerId,
          sellerId,
          adTitle: item.title ?? '',
          adImageId: item.imageId ?? null,
          adPriceMinor: item.priceMinor ?? null,
          lastMessage: null,
          lastMessageAt: new Date(),
          buyerLastRead: null,
          sellerLastRead: null,
          buyerUnreadCount: 0,
          sellerUnreadCount: 0,
          buyerArchivedAt: null,
          sellerArchivedAt: null,
          buyerMutedAt: null,
          sellerMutedAt: null,
          buyerClearedTo: null,
          sellerClearedTo: null,
          expiresAt: expiresAt ?? null,
          schemaVersion: 1,
        },
      },
      { upsert: true, new: true },
    ).lean();
    return (await this.#present([room], { status: item.status ?? null }))[0];
  }

  async getById(id, { session } = {}) {
    const query = ConversationModel.findById(id).lean();
    if (session) query.session(session);
    const room = await query;
    return room ? (await this.#present([room]))[0] : null;
  }

  /** Raw room (no presentation) — for the write paths that need the buyer / seller sides. */
  async #room(id, session) {
    const query = ConversationModel.findById(id).lean();
    if (session) query.session(session);
    return query;
  }

  /**
   * Inbox: every room the user has not archived, newest activity first (empty rooms included, like before).
   * Each branch repeats the `lastMessageAt` date predicate so both partial indexes on chat_rooms apply.
   */
  async listByParticipant(userId, { limit = 50 } = {}) {
    const dateOnly = { $type: 'date' };
    const rooms = await ConversationModel.find({
      $or: [
        { buyerId: userId, buyerArchivedAt: null, lastMessageAt: dateOnly },
        { sellerId: userId, sellerArchivedAt: null, lastMessageAt: dateOnly },
      ],
    })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    return this.#present(rooms);
  }

  /**
   * On a new message: Fastify's repairRoomAfterMessage in one atomic pipeline write — monotonic preview
   * (an out-of-order completion can never resurrect an older preview), +1 unread for the recipient, both
   * sides' archive cleared (a new message resurfaces the thread), and the room's expiry moved to the newest
   * message's ($max never moves it back).
   */
  async applyNewMessage({ conversationId, lastMessage, expiresAt, session }) {
    const preview = {
      messageId: lastMessage.messageId,
      text: sharedPreview(lastMessage).text,
      type: lastMessage.type,
      senderId: lastMessage.senderId,
      at: lastMessage.createdAt,
    };
    const isNewer = {
      $gt: [
        [lastMessage.createdAt, lastMessage.messageId],
        [{ $ifNull: ['$lastMessageAt', new Date(0)] }, { $ifNull: ['$lastMessage.messageId', MIN_OID] }],
      ],
    };
    const senderIsBuyer = { $eq: ['$buyerId', lastMessage.senderId] };
    const bump = (field, mine) => ({
      $cond: { if: mine, then: { $ifNull: [`$${field}`, 0] }, else: { $add: [{ $ifNull: [`$${field}`, 0] }, 1] } },
    });
    const query = ConversationModel.findOneAndUpdate(
      { _id: conversationId },
      [
        {
          $set: {
            // $literal: a text starting with `$` must not be read as a field path
            lastMessage: { $cond: { if: isNewer, then: { $literal: preview }, else: '$lastMessage' } },
            lastMessageAt: { $cond: { if: isNewer, then: lastMessage.createdAt, else: '$lastMessageAt' } },
            buyerArchivedAt: null,
            sellerArchivedAt: null,
            buyerUnreadCount: bump('buyerUnreadCount', senderIsBuyer),
            sellerUnreadCount: bump('sellerUnreadCount', { $not: [senderIsBuyer] }),
            expiresAt: { $max: ['$expiresAt', expiresAt ?? null] },
            updatedAt: '$$NOW',
          },
        },
      ],
      { new: true },
    ).lean();
    if (session) query.session(session);
    const room = await query;
    return room ? (await this.#present([room]))[0] : null;
  }

  /**
   * Replace ONLY the inbox preview (used when an unsent message was the last one). No `updatedAt` bump so a
   * deletion never reorders the inbox.
   */
  async setLastMessage(conversationId, lastMessage) {
    const message = await MessageModel.findById(lastMessage.messageId).select({ createdAt: 1 }).lean();
    const { text, type } = sharedPreview(lastMessage);
    const room = await ConversationModel.findByIdAndUpdate(
      conversationId,
      {
        $set: {
          lastMessage: { messageId: lastMessage.messageId, text, type, senderId: lastMessage.senderId, at: lastMessage.createdAt },
          lastMessageAt: message?.createdAt ?? lastMessage.createdAt,
        },
      },
      { new: true, timestamps: false },
    ).lean();
    return room ? (await this.#present([room]))[0] : null;
  }

  /**
   * "Delete for me": hide the room from this user's inbox, zero their unread and floor their history at the
   * given message (`clearedMessageId` may be null on an empty thread). Nothing is ever deleted — chat is
   * retained until its TTL; a new message resurfaces the thread, the floor stays.
   */
  async hideForUser(conversationId, userId, clearedMessageId = null, { session } = {}) {
    const room = await this.#room(conversationId, session);
    if (!room) return null;
    const side = String(room.buyerId) === String(userId) ? 'buyer' : 'seller';
    const set = { [`${side}ArchivedAt`]: new Date(), [`${side}UnreadCount`]: 0 };
    if (clearedMessageId) {
      const query = MessageModel.findById(clearedMessageId).select({ createdAt: 1 }).lean();
      if (session) query.session(session);
      const message = await query;
      if (message) set[`${side}ClearedTo`] = { at: message.createdAt, messageId: clearedMessageId };
    }
    const query = ConversationModel.findByIdAndUpdate(conversationId, { $set: set }, { new: true }).lean();
    if (session) query.session(session);
    const updated = await query;
    return updated ? (await this.#present([updated]))[0] : null;
  }

  /** Mute/unmute push for this user on this conversation (does not affect unread counts). */
  async setMute(conversationId, userId, muted) {
    const room = await this.#room(conversationId);
    if (!room) return null;
    const side = String(room.buyerId) === String(userId) ? 'buyer' : 'seller';
    const updated = await ConversationModel.findByIdAndUpdate(
      conversationId,
      { $set: { [`${side}MutedAt`]: muted ? new Date() : null } },
      { new: true },
    ).lean();
    return updated ? (await this.#present([updated]))[0] : null;
  }

  /**
   * On read: record the caller's watermark (the message's own createdAt + id, so it matches history ordering
   * exactly) and reset their unread counter. With no message id only the counter is reset.
   */
  async applyRead({ conversationId, userId, lastReadMessageId, lastReadAt }) {
    const room = await this.#room(conversationId);
    if (!room) return null;
    const side = String(room.buyerId) === String(userId) ? 'buyer' : 'seller';
    const set = { [`${side}UnreadCount`]: 0 };
    if (lastReadMessageId) {
      const message = await MessageModel.findById(lastReadMessageId).select({ createdAt: 1 }).lean();
      set[`${side}LastRead`] = { at: message?.createdAt ?? lastReadAt, messageId: lastReadMessageId };
    }
    const updated = await ConversationModel.findByIdAndUpdate(conversationId, { $set: set }, { new: true }).lean();
    return updated ? (await this.#present([updated]))[0] : null;
  }
}

export default ConversationRepository;
