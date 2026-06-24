/**
 * Layer: Repository (IConversationRepository — Mongo impl).
 * Data access for conversations: findOrCreate (atomic upsert on the unique itemId+participantIds
 * index), listByParticipant (inbox, sorted by updatedAt), getById, and atomic inbox-snapshot
 * updates. The only place conversation documents are read/written. Must NOT hold business logic.
 *
 * SEAM 2: the inbox-update methods use TARGETED $set/$inc on lastMessage / unreadCounts /
 * readState / updatedAt only — they must never clobber the item/participants snapshot fields.
 */
import { ConversationModel } from './conversation.model.js';

export class ConversationRepository {
  /**
   * Atomic find-or-create keyed by the unique { itemId, pairKey } index. The snapshot fields are
   * only written on insert ($setOnInsert) so an existing conversation keeps its original snapshot.
   */
  async findOrCreate({ itemId, pairKey, participantIds, item, participants }) {
    return ConversationModel.findOneAndUpdate(
      { itemId, pairKey },
      {
        $setOnInsert: {
          itemId,
          pairKey,
          participantIds,
          item,
          participants,
          unreadCounts: {},
          readState: {},
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  async getById(id) {
    return ConversationModel.findById(id).lean();
  }

  async listByParticipant(userId, { limit = 50 } = {}) {
    return ConversationModel.find({ participantIds: userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * On a new message: set lastMessage, bump updatedAt (timestamps), and $inc unread for every
   * recipient (everyone except the sender). Never touches item/participants.
   */
  async applyNewMessage({ conversationId, lastMessage, recipientIds }) {
    const inc = {};
    for (const rid of recipientIds) inc[`unreadCounts.${rid}`] = 1;
    return ConversationModel.findByIdAndUpdate(
      conversationId,
      { $set: { lastMessage }, ...(Object.keys(inc).length ? { $inc: inc } : {}) },
      { new: true, timestamps: true },
    ).lean();
  }

  /**
   * On read: record readState for the user and reset their unread counter to 0. Targeted writes
   * only — snapshot untouched.
   */
  async applyRead({ conversationId, userId, lastReadMessageId, lastReadAt }) {
    return ConversationModel.findByIdAndUpdate(
      conversationId,
      {
        $set: {
          [`readState.${userId}`]: { lastReadMessageId, lastReadAt },
          [`unreadCounts.${userId}`]: 0,
        },
      },
      { new: true },
    ).lean();
  }
}

export default ConversationRepository;
