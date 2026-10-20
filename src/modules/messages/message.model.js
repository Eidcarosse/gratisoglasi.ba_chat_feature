/**
 * Layer: Model (Mongoose mirror of the Fastify `messages` collection — shared DB).
 * One document per message, shared with the Fastify BE: `roomId` (the chat room), `text` (stored RAW — this
 * service HTML-escapes angle brackets on output, see message.mapper.js), `attachments` as Cloudflare image ids.
 * 'system' is the content tombstone of an unsent message. `expiresAt` is the TTL deadline. No indexes here
 * (Fastify's scripts/indexes.ts owns them: history, {roomId, clientMessageId} unique, TTL).
 */
import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['text', 'image', 'system'], required: true },
    text: { type: String, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    clientMessageId: { type: String, required: true },
    deletedAt: { type: Date, default: null },
    schemaVersion: { type: Number, default: 2 },
    expiresAt: { type: Date, default: null },
  },
  { collection: 'messages', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const MessageModel = mongoose.models.Message || mongoose.model('Message', messageSchema, 'messages');
export default MessageModel;
