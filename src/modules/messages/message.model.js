/**
 * Layer: Model (Mongoose schema — chat DB).
 * messages collection — ONE document per message, Scylla-ready access pattern (doc §4):
 *   { _id (ObjectId, time-sortable — doubles as ordering/seq key), conversationId (= future
 *     Scylla PARTITION KEY), senderId, clientMessageId (client UUID for idempotent dedup),
 *     type: 'text'|'image'|'file', body, attachments: [{key,url,mime,size,width,height}],
 *     status: 'sent', createdAt }
 * delivered/read are tracked on conversation.readState, NOT per message doc.
 * Indexes:
 *   { conversationId: 1, _id: -1 }                    → history (keyset pagination)
 *   { conversationId: 1, clientMessageId: 1 } unique  → dedup / idempotency
 */
import mongoose from 'mongoose';
import { MESSAGE_TYPES, MESSAGE_STATUS } from '../../config/constants.js';

const attachmentSchema = new mongoose.Schema(
  {
    key: String,
    url: String,
    mime: String,
    size: Number,
    width: Number,
    height: Number,
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    clientMessageId: { type: String, required: true },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    body: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    status: { type: String, default: MESSAGE_STATUS.SENT },
    // createdAt is set explicitly (not via timestamps) so it aligns with the _id ordering key.
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

messageSchema.index({ conversationId: 1, _id: -1 });
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });

export const MessageModel = mongoose.model('Message', messageSchema);
export default MessageModel;
