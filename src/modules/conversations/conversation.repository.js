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
  async findOrCreate({ itemId, pairKey, participantIds, item, participants, expiresAt }) {
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
          expiresAt, // fixed TTL window, set only at creation
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  async getById(id) {
    return ConversationModel.findById(id).lean();
  }

  async listByParticipant(userId, { limit = 50 } = {}) {
    // Exclude conversations this user "deleted for me" (hidden from their inbox).
    return ConversationModel.find({ participantIds: userId, deletedFor: { $ne: userId } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * On a new message: set lastMessage, bump updatedAt (timestamps), $inc unread for every
   * recipient (everyone except the sender), and resurface the thread for anyone who had hidden it
   * (`$pull` from deletedFor). `resurfaceFor` MUST be ObjectIds (deletedFor stores ObjectIds);
   * `recipientIds` are strings (unread map keys). Never touches item/participants.
   */
  async applyNewMessage({ conversationId, lastMessage, recipientIds, resurfaceFor = [] }) {
    const inc = {};
    for (const rid of recipientIds) inc[`unreadCounts.${rid}`] = 1;
    const update = { $set: { lastMessage } };
    if (Object.keys(inc).length) update.$inc = inc;
    if (resurfaceFor.length) update.$pull = { deletedFor: { $in: resurfaceFor } };
    return ConversationModel.findByIdAndUpdate(conversationId, update, {
      new: true,
      timestamps: true,
    }).lean();
  }

  /**
   * Replace ONLY the inbox preview (used when an unsent message was the last one). Targeted $set
   * with timestamps:false so a deletion never reorders the inbox to the top.
   */
  async setLastMessage(conversationId, lastMessage) {
    return ConversationModel.findByIdAndUpdate(
      conversationId,
      { $set: { lastMessage } },
      { new: true, timestamps: false },
    ).lean();
  }

  /** "Delete for me": hide the convo from this user's inbox and clear their unread badge. */
  async hideForUser(conversationId, userId) {
    return ConversationModel.findByIdAndUpdate(
      conversationId,
      { $addToSet: { deletedFor: userId }, $set: { [`unreadCounts.${String(userId)}`]: 0 } },
      { new: true },
    ).lean();
  }

  /** Mute/unmute push for this user on this conversation (does not affect unread counts). */
  async setMute(conversationId, userId, muted) {
    const update = muted ? { $addToSet: { mutedBy: userId } } : { $pull: { mutedBy: userId } };
    return ConversationModel.findByIdAndUpdate(conversationId, update, { new: true }).lean();
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
