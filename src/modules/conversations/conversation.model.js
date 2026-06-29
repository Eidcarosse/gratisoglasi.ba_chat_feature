/**
 * Layer: Model (Mongoose schema — chat DB).
 * conversations collection — the denormalized inbox row. Scoped to one main-site item and a
 * buyer-seller pair. Snapshots let the inbox render with ZERO cross-DB joins (item + users live
 * in the read-only Gratis DB; .populate() cannot cross connections).
 *
 *   itemId          -> main-site items._id (ObjectId, UNENFORCED cross-DB ref)
 *   participantIds  -> [buyerId, sellerId] (main-site users._id; sellerId = item.addedBy).
 *                      Deterministic order so the unique index dedups one convo per (item, pair).
 *   item            -> snapshot { title, thumbnailUrl, price (nullable), status, sellerId }
 *   participants    -> snapshot map { <userId>: { displayName, avatarUrl } }
 *   lastMessage     -> inbox preview { messageId, body, senderId, type, createdAt, deletedAt }
 *   unreadCounts    -> { <userId>: int } for O(1) badges
 *   readState       -> { <userId>: { lastReadMessageId, lastReadAt } }
 *   deletedFor      -> [userId] who "deleted for me" (hidden from their inbox; cleared on new msg)
 *   mutedBy         -> [userId] who muted push for this convo (unread still increments)
 *   expiresAt       -> createdAt + CHAT_TTL_DAYS; TTL index auto-deletes the convo (+messages)
 *
 * NO messages array (unbounded-array anti-pattern) — messages are their own collection.
 *
 * Dedup key: a UNIQUE index on the array `participantIds` would be MULTIKEY (enforced per
 * element), which wrongly blocks a second buyer from messaging the same seller about the same
 * item — they'd collide on (item, seller). So we dedup on a scalar `pairKey` = `${buyerId}:${sellerId}`
 * instead, and keep the array only for the (non-unique) inbox query.
 * Indexes:
 *   { participantIds: 1, updatedAt: -1 }   -> inbox query (multikey, non-unique)
 *   { itemId: 1, pairKey: 1 } unique        -> one convo per (item, buyer-seller pair)
 * Schema + indexes only; no cross-entity logic.
 */
import mongoose from 'mongoose';
import { MESSAGE_TYPES } from '../../config/constants.js';

const lastMessageSchema = new mongoose.Schema(
  {
    // messageId lets a delete/unsend detect whether the removed message IS the inbox preview,
    // so the preview can be recomputed (the messages collection has no back-pointer here).
    messageId: { type: mongoose.Schema.Types.ObjectId },
    body: String,
    senderId: { type: mongoose.Schema.Types.ObjectId },
    type: { type: String, enum: MESSAGE_TYPES },
    createdAt: Date,
    deletedAt: { type: Date, default: null }, // set when the previewed message was unsent
  },
  { _id: false },
);

const itemSnapshotSchema = new mongoose.Schema(
  {
    title: String,
    thumbnailUrl: { type: String, default: null },
    price: { type: Number, default: null }, // nullable — main-site price may be null
    status: { type: String, default: null },
    sellerId: { type: mongoose.Schema.Types.ObjectId },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Scalar dedup key — `${buyerId}:${sellerId}` (deterministic order). See header.
    pairKey: { type: String, required: true },
    participantIds: {
      type: [mongoose.Schema.Types.ObjectId],
      required: true,
      validate: [(v) => v.length === 2, 'participantIds must hold exactly 2 ids at MVP'],
    },
    item: { type: itemSnapshotSchema, required: true },
    // Snapshot map keyed by userId. Mixed because keys are dynamic ObjectId strings.
    participants: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastMessage: { type: lastMessageSchema, default: null },
    unreadCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    readState: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Per-participant "delete for me": userIds here have hidden the convo from their inbox. A new
    // message clears this (resurfaces the thread). Stored as ObjectIds (matches participantIds).
    deletedFor: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // Per-participant mute: userIds here receive no PUSH for new messages (unread still counts).
    mutedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // TTL: set once at creation = createdAt + CHAT_TTL_DAYS. Messages carry the same instant so
    // the whole thread expires together. Mongo's TTL monitor sweeps ~every 60s.
    expiresAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);

conversationSchema.index({ participantIds: 1, updatedAt: -1 });
conversationSchema.index({ itemId: 1, pairKey: 1 }, { unique: true });
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ConversationModel = mongoose.model('Conversation', conversationSchema);
export default ConversationModel;
