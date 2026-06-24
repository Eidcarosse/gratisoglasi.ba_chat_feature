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

const oid = (v) => new mongoose.Types.ObjectId(v);
const isMember = (convo, userId) => convo.participantIds.some((p) => String(p) === String(userId));

export class ConversationService {
  /**
   * @param {object} deps
   * @param {import('./conversation.repository.js').ConversationRepository} deps.conversationRepository
   * @param {import('../../integrations/gratis/gratis.service.js').GratisService} deps.gratisService
   */
  constructor({ conversationRepository, gratisService }) {
    this.repo = conversationRepository;
    this.gratis = gratisService;
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
    });
  }

  /** Inbox — uses the stored snapshot only (zero cross-DB joins). */
  async listInbox(userId) {
    return this.repo.listByParticipant(oid(userId));
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
    }
    return convo;
  }

  /** Used by messageService to authorize a sender and read participant ids. Throws if not a member. */
  async getMemberConversation(conversationId, userId) {
    return this.#getMemberConvo(conversationId, userId);
  }

  /** Update the inbox snapshot after a message is persisted (called by messageService). */
  async recordMessage(convo, message) {
    const recipientIds = convo.participantIds
      .map(String)
      .filter((id) => id !== String(message.senderId));
    return this.repo.applyNewMessage({
      conversationId: convo._id,
      lastMessage: {
        body: message.type === 'text' ? message.body : `[${message.type}]`,
        senderId: message.senderId,
        type: message.type,
        createdAt: message.createdAt,
      },
      recipientIds,
    });
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

  async #getMemberConvo(conversationId, userId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId))
      throw AppError.notFound('Conversation not found');
    const convo = await this.repo.getById(conversationId);
    if (!convo) throw AppError.notFound('Conversation not found');
    if (!isMember(convo, userId))
      throw AppError.forbidden('Not a participant of this conversation');
    return convo;
  }
}

export default ConversationService;
