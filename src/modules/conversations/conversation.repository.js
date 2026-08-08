/**
 * Layer: Repository (IConversationRepository — Mongo impl).
 * Data access for conversations: findOrCreate (atomic upsert on the unique itemId+participantIds
 * index), listByParticipant (inbox, sorted by updatedAt), getById, and atomic inbox-snapshot
 * updates. The only place conversation documents are read/written. Must NOT hold business logic.
 *
 * SEAM 2: the inbox-update methods use TARGETED $set/$inc/$max on lastMessage / unreadCounts /
 * expiresAt / readState / updatedAt only — they must never clobber the item/participants snapshot
 * fields.
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
          expiresAt, // empty conversations expire after the retention window
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  async getById(id, { session } = {}) {
    const query = ConversationModel.findById(id);
    if (session) query.session(session);
    return query.lean();
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
  async applyNewMessage({
    conversationId,
    lastMessage,
    expiresAt,
    recipientIds,
    resurfaceFor = [],
    session,
  }) {
    const inc = {};
    for (const rid of recipientIds) inc[`unreadCounts.${rid}`] = 1;
    // Keep the conversation until its newest message expires. Since every older message expires
    // no later than this instant, the conversation TTL cannot remove a thread with an unexpired
    // message. $max is important here: concurrent out-of-order writes must never move the
    // conversation deadline backward.
    const update = { $set: { lastMessage }, $max: { expiresAt } };
    if (Object.keys(inc).length) update.$inc = inc;
    if (resurfaceFor.length) update.$pull = { deletedFor: { $in: resurfaceFor } };
    const query = ConversationModel.findByIdAndUpdate(conversationId, update, {
      new: true,
      timestamps: true,
    }).lean();
    if (session) query.session(session);
    return query;
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

  /**
   * "Delete for me": hide the convo from this user's inbox, clear their unread badge, and stamp a
   * history watermark (`clearedAt.<userId>` = newest message id at delete time) so their message
   * reads return only messages AFTER it. `clearedMessageId` may be null (empty thread → nothing to
   * hide). The watermark lives outside `deletedFor`, so the resurface `$pull` never clears it.
   */
  async hideForUser(conversationId, userId, clearedMessageId = null, { session } = {}) {
    const query = ConversationModel.findByIdAndUpdate(
      conversationId,
      {
        $addToSet: { deletedFor: userId },
        $set: {
          [`unreadCounts.${String(userId)}`]: 0,
          [`clearedAt.${String(userId)}`]: clearedMessageId,
        },
      },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean();
  }

  /** Permanently remove a thread, but only after every participant has hidden it. */
  async deleteIfHiddenForAll(conversationId, participantIds, { session } = {}) {
    const query = ConversationModel.findOneAndDelete({
      _id: conversationId,
      deletedFor: { $all: participantIds, $size: participantIds.length },
    });
    if (session) query.session(session);
    return query.lean();
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
