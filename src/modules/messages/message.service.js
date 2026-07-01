/**
 * Layer: Service — the single write path for messages.
 * send(): authorize (sender ∈ conversation.participantIds via conversationService), sanitize body,
 * messageRepository.append() (idempotent), then — only on a genuinely new message — update the
 * conversation inbox snapshot via conversationService, emit message:new through the gateway, and
 * notify offline recipients. Idempotent append + client dedup = feels exactly-once.
 * history(): keyset pagination. syncSince(): messages newer than a client cursor.
 * Depends on IMessageRepository (NOT a concrete store), conversationService, gateway,
 * notificationService, presenceService — all injected. Must NOT touch any DB driver directly.
 */
import mongoose from 'mongoose';
import { EVENTS } from '../../realtime/events.js';
import { messagesSent } from '../../common/metrics.js';
import { LIMITS } from '../../config/constants.js';
import { AppError } from '../../common/errors/AppError.js';

const oid = (v) => new mongoose.Types.ObjectId(v);
const CHAT_TTL_MS = LIMITS.CHAT_TTL_DAYS * 24 * 60 * 60 * 1000;

// Minimal stored-XSS guard for text bodies: neutralize angle brackets. The client renders text,
// never HTML, but defense-in-depth is cheap.
function sanitizeBody(body) {
  return typeof body === 'string' ? body.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

export class MessageService {
  constructor({
    messageRepository,
    conversationService,
    gateway,
    notificationService,
    presenceService,
    uploadService,
  }) {
    this.repo = messageRepository;
    this.conversations = conversationService;
    this.gateway = gateway;
    this.notifications = notificationService;
    this.presence = presenceService;
    this.uploads = uploadService;
  }

  async send({ conversationId, senderId, clientMessageId, type, body, attachments = [] }) {
    // Authorize: membership is the real guard (identity is spoofable under dev-trust).
    const convo = await this.conversations.getMemberConversation(conversationId, senderId);

    const doc = {
      conversationId: oid(conversationId),
      senderId: oid(senderId),
      clientMessageId,
      type,
      body: type === 'text' ? sanitizeBody(body) : (body ?? ''),
      attachments,
      createdAt: new Date(),
      // Align expiry to the conversation's creation so the whole thread TTL-expires together.
      expiresAt: new Date(new Date(convo.createdAt).getTime() + CHAT_TTL_MS),
    };

    const { message, created } = await this.repo.append(doc);

    // Idempotent: a resend (same clientMessageId) returns the canonical copy without re-emitting
    // or re-incrementing unread counts.
    if (created) {
      await this.conversations.recordMessage(convo, message);
      messagesSent.inc();

      // Deliver to everyone in the conversation room, plus the sender's other devices.
      this.gateway.emitToConversation(conversationId, EVENTS.MESSAGE_NEW, { message });
      this.gateway.emitToUser(senderId, EVENTS.MESSAGE_NEW, { message });

      // Offline path: push to recipients with no active socket — unless they muted this convo.
      const senderName = convo.participants?.[String(senderId)]?.displayName || 'New message';
      const itemTitle = convo.item?.title;
      const mutedSet = new Set((convo.mutedBy || []).map(String));
      const recipientIds = convo.participantIds.map(String).filter((id) => id !== String(senderId));
      for (const rid of recipientIds) {
        if (mutedSet.has(rid)) continue; // muted → no push (unread still incremented above)
        const online = this.presence ? await this.presence.isOnline(rid) : false;
        if (!online)
          await this.notifications.notify({
            type: 'message',
            userId: rid,
            conversationId,
            message,
            senderName,
            itemTitle,
          });
      }
    }

    return message;
  }

  async history(conversationId, userId, { before, limit } = {}) {
    await this.conversations.getMemberConversation(conversationId, userId);
    return this.repo.findByConversation(oid(conversationId), { before, limit });
  }

  /** Reconnect-sync: messages newer than the client's last-held id (oldest-first). */
  async syncSince(conversationId, userId, afterId, { limit } = {}) {
    await this.conversations.getMemberConversation(conversationId, userId);
    return this.repo.findByConversation(oid(conversationId), { after: afterId, limit });
  }

  /**
   * Unsend for everyone: tombstone a message (sender-only), recompute the inbox preview if it was
   * the last one, and broadcast message:deleted so both clients update live. Idempotent.
   */
  async deleteMessage({ conversationId, messageId, userId }) {
    const convo = await this.conversations.getMemberConversation(conversationId, userId);

    const msg = await this.repo.getById(messageId);
    if (!msg || String(msg.conversationId) !== String(conversationId)) {
      throw AppError.notFound('Message not found');
    }
    if (String(msg.senderId) !== String(userId)) {
      throw AppError.forbidden('Only the sender can delete this message');
    }
    if (msg.deletedAt) return msg; // already unsent — idempotent, no re-emit

    // Capture attachments BEFORE softDelete clears them, so we can clean up their Cloudflare images.
    const doomedAttachments = msg.attachments || [];

    const updated = await this.repo.softDelete(oid(conversationId), oid(messageId));

    // If the unsent message was the inbox preview, recompute it from the newest message.
    const last = convo.lastMessage;
    const wasPreview = !last?.messageId || String(last.messageId) === String(messageId);
    if (wasPreview) {
      const [latest] = await this.repo.findByConversation(oid(conversationId), { limit: 1 });
      if (latest) {
        await this.conversations.replaceLastMessage(conversationId, {
          messageId: latest._id,
          body: latest.deletedAt ? '' : latest.type === 'text' ? latest.body : `[${latest.type}]`,
          senderId: latest.senderId,
          type: latest.type,
          createdAt: latest.createdAt,
          deletedAt: latest.deletedAt ?? null,
        });
      }
    }

    this.gateway.emitToConversation(conversationId, EVENTS.MESSAGE_DELETED, {
      conversationId,
      messageId: String(messageId),
    });

    // Best-effort remote cleanup: delete the message's images from Cloudflare. Fire-and-forget so
    // unsend latency is unaffected; deleteImages swallows all errors internally (never throws).
    void this.uploads?.deleteImages(doomedAttachments);

    return updated;
  }
}

export default MessageService;
