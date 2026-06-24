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

const oid = (v) => new mongoose.Types.ObjectId(v);

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
  }) {
    this.repo = messageRepository;
    this.conversations = conversationService;
    this.gateway = gateway;
    this.notifications = notificationService;
    this.presence = presenceService;
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

      // Offline path: notify recipients with no active socket.
      const recipientIds = convo.participantIds.map(String).filter((id) => id !== String(senderId));
      for (const rid of recipientIds) {
        const online = this.presence ? await this.presence.isOnline(rid) : false;
        if (!online)
          await this.notifications.notify({
            type: 'message',
            userId: rid,
            conversationId,
            message,
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
}

export default MessageService;
