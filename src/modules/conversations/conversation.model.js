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
 *   lastMessage     -> inbox preview { body, senderId, type, createdAt }
 *   unreadCounts    -> { <userId>: int } for O(1) badges
 *   readState       -> { <userId>: { lastReadMessageId, lastReadAt } }
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
    body: String,
    senderId: { type: mongoose.Schema.Types.ObjectId },
    type: { type: String, enum: MESSAGE_TYPES },
    createdAt: Date,
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
  },
  { timestamps: true, minimize: false },
);

conversationSchema.index({ participantIds: 1, updatedAt: -1 });
conversationSchema.index({ itemId: 1, pairKey: 1 }, { unique: true });

export const ConversationModel = mongoose.model('Conversation', conversationSchema);
export default ConversationModel;
