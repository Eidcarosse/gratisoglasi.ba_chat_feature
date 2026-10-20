/**
 * Layer: Model (Mongoose mirror of the Fastify `chat_rooms` collection — shared DB).
 * The chat service no longer owns a conversations collection: one chat room per (ad, buyer) is shared with
 * the Fastify BE, with explicit buyer / seller fields instead of per-user maps. Same schema, same collection
 * name, no indexes here (scripts/indexes.ts in the Fastify repo owns them). The legacy conversation shape the
 * clients see is built from this by conversation.mapper.js.
 */
import mongoose from 'mongoose';

const lastMessageSchema = new mongoose.Schema(
  {
    messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
    text: { type: String, required: true },
    type: { type: String, enum: ['text', 'image', 'system'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const watermarkSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const chatRoomSchema = new mongoose.Schema(
  {
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    adTitle: { type: String, required: true },
    adImageId: { type: String, default: null },
    adPriceMinor: { type: Number, default: null },

    lastMessage: { type: lastMessageSchema, default: null },
    lastMessageAt: { type: Date, default: null },

    buyerLastRead: { type: watermarkSchema, default: null },
    sellerLastRead: { type: watermarkSchema, default: null },

    buyerUnreadCount: { type: Number, default: 0 },
    sellerUnreadCount: { type: Number, default: 0 },

    buyerArchivedAt: { type: Date, default: null },
    sellerArchivedAt: { type: Date, default: null },

    buyerMutedAt: { type: Date, default: null },
    sellerMutedAt: { type: Date, default: null },

    buyerClearedTo: { type: watermarkSchema, default: null },
    sellerClearedTo: { type: watermarkSchema, default: null },

    expiresAt: { type: Date, default: null },

    schemaVersion: { type: Number, default: 1 },
  },
  { collection: 'chat_rooms', timestamps: true, versionKey: false },
);

export const ConversationModel =
  mongoose.models.ChatRoom || mongoose.model('ChatRoom', chatRoomSchema, 'chat_rooms');
export default ConversationModel;
