/**
 * Layer: Model (Mongoose schema — chat DB).
 * messages collection — ONE document per message, Scylla-ready access pattern (doc §4):
 *   { _id (ObjectId, time-sortable — doubles as ordering/seq key), conversationId (= future
 *     Scylla PARTITION KEY), senderId, clientMessageId (client UUID for idempotent dedup),
 *     type: 'text'|'image'|'file', body, attachments: [{key,url,mime,size,width,height}],
 *     status: 'sent', deletedAt (unsend tombstone), createdAt, expiresAt (TTL) }
 * delivered/read are tracked on conversation.readState, NOT per message doc.
 * Indexes:
 *   { conversationId: 1, _id: -1 }                    → history (keyset pagination)
 *   { conversationId: 1, clientMessageId: 1 } unique  → dedup / idempotency
 */
import mongoose from 'mongoose';
import { MESSAGE_TYPES, MESSAGE_STATUS } from '../../config/constants.js';

// `key` is the Cloudflare image id (also returned to the client by the direct-upload flow). It is
// what makes an attached image a first-class, addressable record: unsend cleanup deletes by it, and
// a FUTURE async moderation worker can approve/serve/delete an image by it. MODERATION SEAM: gating
// an image's visibility on moderation later is an ADDITIVE change here — add an optional
// `status: 'pending'|'approved'|'rejected'` field (Mongo needs no migration) and have the send path
// consult it. Nothing in the current schema precludes that; see upload.service.js TODO(moderation).
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
    // Unsend tombstone: set when a message is "deleted for everyone". The doc stays (preserves
    // ordering/history); body+attachments are cleared so the client renders "message deleted".
    deletedAt: { type: Date, default: null },
    // createdAt is set explicitly (not via timestamps) so it aligns with the _id ordering key.
    createdAt: { type: Date, default: Date.now },
    // TTL: aligned to the conversation's createdAt + CHAT_TTL_DAYS so the whole thread expires
    // together (Mongo TTL can't cascade across collections).
    expiresAt: { type: Date },
  },
  { versionKey: false },
);

messageSchema.index({ conversationId: 1, _id: -1 });
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MessageModel = mongoose.model('Message', messageSchema);
export default MessageModel;
