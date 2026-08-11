/**
 * Layer: Service.
 * Conversation business logic: find-or-create one conversation per (item, buyer-seller pair),
 * load a user's inbox, refresh on open, compute/reset unread counts, apply read-state updates.
 * Enforces participant membership (authorization) on EVERY operation regardless of auth mode
 * (SEAM 4) — identity is spoofable under dev-trust, so membership is the real guard. Resolves
 * all main-site data through gratisService (never .populate across connections — SEAM 1).
 * Must NOT touch Mongoose directly — go through conversationRepository.
 */
import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError.js';
import { LIMITS } from '../../config/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(v);
const isMember = (convo, userId) => convo.participantIds.some((p) => String(p) === String(userId));
const CHAT_TTL_MS = LIMITS.CHAT_TTL_DAYS * 24 * 60 * 60 * 1000;

export class ConversationService {
  /**
   * @param {object} deps
   * @param {import('./conversation.repository.js').ConversationRepository} deps.conversationRepository
   * @param {import('../messages/message.repository.interface.js').IMessageRepository} deps.messageRepository
   * @param {import('../../integrations/gratis/gratis.service.js').GratisService} deps.gratisService
   * @param {import('../blocks/block.service.js').BlockService} deps.blockService
   * @param {import('../../common/mongo.transaction.js').MongoTransactionRunner} deps.transactionRunner
   */
  constructor({
    conversationRepository,
    messageRepository,
    gratisService,
    blockService,
    transactionRunner,
  }) {
    this.repo = conversationRepository;
    this.messages = messageRepository;
    this.gratis = gratisService;
    this.blocks = blockService;
    this.transactions = transactionRunner;
  }

  /**
   * The "Contact seller" flow. buyerId comes from the authenticated identity; sellerId is
   * derived from the item, never trusted from the client.
   */
  async findOrCreate(itemId, buyerId) {
    const snapshot = await this.gratis.getItemSnapshot(itemId);
    if (!snapshot) throw AppError.notFound('Item not found');
    if (snapshot.hidden) throw AppError.forbidden('Item is not available');
    if (!snapshot.sellerId) throw AppError.validation('Item has no seller');

    const sellerId = snapshot.sellerId;
    if (String(buyerId) === String(sellerId)) {
      throw AppError.validation('You cannot start a conversation with yourself');
    }

    // A block in either direction bars starting a conversation between the two users.
    if (await this.blocks.isBlockedBetween(buyerId, sellerId)) {
      throw AppError.forbidden('You cannot start a conversation with this user');
    }

    const summaries = await this.gratis.getUserSummaries([buyerId, sellerId]);
    const participants = {};
    for (const [id, summary] of summaries) participants[id] = summary;

    return this.repo.findOrCreate({
      itemId: oid(itemId),
      pairKey: `${String(buyerId)}:${String(sellerId)}`, // deterministic scalar dedup key
      participantIds: [oid(buyerId), oid(sellerId)], // deterministic order: [buyer, seller]
      item: {
        title: snapshot.title,
        thumbnailUrl: snapshot.thumbnailUrl,
        price: snapshot.price,
        status: snapshot.status,
        sellerId: oid(sellerId),
      },
      participants,
      // An empty conversation gets one retention window; each new message moves this deadline.
      expiresAt: new Date(Date.now() + CHAT_TTL_MS),
    });
  }

  /** Inbox — uses the stored snapshot only (zero cross-DB joins), annotated with block state. */
  async listInbox(userId) {
    const convos = await this.repo.listByParticipant(oid(userId));
    // Batch the per-conversation block lookup into ONE query (no N+1).
    const otherIds = convos.map((c) => this.#otherParticipant(c, userId)).filter(Boolean);
    const statuses = await this.blocks.statusMap(userId, otherIds);
    for (const convo of convos) {
      const otherId = this.#otherParticipant(convo, userId);
      convo.blockStatus = otherId ? statuses.get(String(otherId)) : null;
    }
    return convos;
  }

  /**
   * Open a conversation: assert membership, then overlay the LIVE item price/status for the
   * caller (does NOT write back — SEAM 2). Inbox keeps showing the snapshot.
   */
  async open(conversationId, userId) {
    const convo = await this.#getMemberConvo(conversationId, userId);
    const live = await this.gratis.getItemSnapshot(String(convo.itemId));
    if (live) {
      convo.item = {
        ...convo.item,
        price: live.price,
        status: live.status,
        thumbnailUrl: live.thumbnailUrl,
      };
      convo.itemLive = { price: live.price, status: live.status, hidden: live.hidden };
      convo.itemAvailable = !live.hidden;
      convo.itemDeleted = false;
    } else {
      // The item is gone from the main site (hard delete). Keep the stored snapshot so the client
      // can still label the thread, but say so explicitly — an absent itemLive used to be
      // indistinguishable from "this endpoint doesn't return it".
      convo.itemLive = null;
      convo.itemDeleted = true;
      convo.itemAvailable = false;
    }
    // Directed block state (from the caller's perspective) so the client can gate its composer.
    const otherId = this.#otherParticipant(convo, userId);
    convo.blockStatus = otherId ? await this.blocks.statusBetween(userId, otherId) : null;
    return convo;
  }

  /** Used by messageService to authorize a sender and read participant ids. Throws if not a member. */
  async getMemberConversation(conversationId, userId, { session } = {}) {
    return this.#getMemberConvo(conversationId, userId, { session });
  }

  /** Update the inbox snapshot after a message is persisted (called by messageService). */
  async recordMessage(convo, message, { session } = {}) {
    const recipientIds = convo.participantIds
      .map(String)
      .filter((id) => id !== String(message.senderId));
    const updated = await this.repo.applyNewMessage({
      conversationId: convo._id,
      lastMessage: {
        messageId: message._id,
        body: message.type === 'text' ? message.body : `[${message.type}]`,
        senderId: message.senderId,
        type: message.type,
        createdAt: message.createdAt,
        deletedAt: null,
      },
      expiresAt: message.expiresAt,
      recipientIds,
      // Any new message resurfaces the (2-party) thread for whoever hid it. ObjectIds, not strings.
      resurfaceFor: convo.participantIds,
      session,
    });
    // A concurrent final delete may remove the conversation after the transaction's initial read.
    // Abort the surrounding transaction so the inserted message cannot become an orphan.
    if (!updated) throw AppError.notFound('Conversation not found');
    return updated;
  }

  /** Replace ONLY the inbox preview (used after an unsend recompute). Caller already authorized. */
  async replaceLastMessage(conversationId, lastMessage) {
    return this.repo.setLastMessage(oid(conversationId), lastMessage);
  }

  /**
   * "Delete for me": hide the conversation from the caller's inbox AND clear their message history
   * up to the current newest message (membership-guarded). The watermark is the current
   * `lastMessage.messageId` (null on an empty thread); the caller's reads then return only messages
   * after it, so pre-delete messages stay hidden even after the thread resurfaces on a new message.
   */
  async hideForUser(conversationId, userId) {
    return this.transactions.run(async (session) => {
      const convo = await this.#getMemberConvo(conversationId, userId, { session });
      const clearedMessageId = convo.lastMessage?.messageId ?? null;
      const updated = await this.repo.hideForUser(
        oid(conversationId),
        oid(userId),
        clearedMessageId,
        { session },
      );

      if (!updated) throw AppError.notFound('Conversation not found');

      // Once both participants have cleared a message-bearing thread, nobody can see its messages
      // anymore. Keep the conversation and its message partition in the same transaction so a
      // failure or a concurrent send cannot leave either half of the deleted thread behind. Empty
      // conversations are intentionally retained so they can be reused if either participant
      // starts messaging later.
      if (
        updated.lastMessage?.messageId &&
        updated.deletedFor.length === updated.participantIds.length
      ) {
        const removed = await this.repo.deleteIfHiddenForAll(
          oid(conversationId),
          updated.participantIds,
          { session },
        );
        if (removed) await this.messages.deleteByConversation(oid(conversationId), { session });
      }

      return updated;
    });
  }

  /** Mute/unmute push for the caller on this conversation (membership-guarded). */
  async setMute(conversationId, userId, muted) {
    await this.#getMemberConvo(conversationId, userId);
    return this.repo.setMute(oid(conversationId), oid(userId), muted);
  }

  /** Mark messages read up to a point: reset the caller's unread counter, record readState. */
  async markRead(conversationId, userId, lastReadMessageId) {
    await this.#getMemberConvo(conversationId, userId);
    return this.repo.applyRead({
      conversationId: oid(conversationId),
      userId: String(userId),
      lastReadMessageId: lastReadMessageId ? oid(lastReadMessageId) : null,
      lastReadAt: new Date(),
    });
  }

  /** The 2-party thread's other participant id (string), or null. */
  #otherParticipant(convo, userId) {
    const other = convo.participantIds.map(String).find((id) => id !== String(userId));
    return other || null;
  }

  async #getMemberConvo(conversationId, userId, { session } = {}) {
    if (!mongoose.Types.ObjectId.isValid(conversationId))
      throw AppError.notFound('Conversation not found');
    const convo = await this.repo.getById(conversationId, { session });
    if (!convo) throw AppError.notFound('Conversation not found');
    if (!isMember(convo, userId))
      throw AppError.forbidden('Not a participant of this conversation');
    return convo;
  }
}

export default ConversationService;
