/**
 * Layer: Service — the single write path for messages.
 * send(): authorize (sender ∈ conversation.participantIds via conversationService), sanitize body,
 * transactionally append the message and update the conversation inbox snapshot, then — only on a
 * committed genuinely new message — emit message:new through the gateway and push-notify all
 * non-muted recipients. Idempotent append + client dedup = feels exactly-once.
 * history(): keyset pagination. syncSince(): messages newer than a client cursor.
 * Depends on IMessageRepository (NOT a concrete store), conversationService, gateway,
 * notificationService, presenceService — all injected. Must NOT touch any DB driver directly.
 */
import mongoose from 'mongoose';
import { EVENTS } from '../../realtime/events.js';
import { messagesSent, pushRecipientOnline } from '../../common/metrics.js';
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
    blockService,
    transactionRunner,
  }) {
    this.repo = messageRepository;
    this.conversations = conversationService;
    this.gateway = gateway;
    this.notifications = notificationService;
    this.presence = presenceService;
    this.uploads = uploadService;
    this.blocks = blockService;
    this.transactions = transactionRunner;
  }

  async send({ conversationId, senderId, clientMessageId, type, body, attachments = [] }) {
    const result = await this.transactions.run(async (session) => {
      // Authorize: membership is the real guard (identity is spoofable under dev-trust). Read the
      // conversation in this same transaction as the append/update so a concurrent final delete
      // cannot invalidate the send between authorization and persistence.
      const convo = await this.conversations.getMemberConversation(conversationId, senderId, {
        session,
      });

      // A block in either direction bars messaging between the two participants (covers both the
      // REST controller and the message:send socket handler, which share this single write path).
      const recipientId = convo.participantIds.map(String).find((id) => id !== String(senderId));
      if (recipientId && (await this.blocks.isBlockedBetween(senderId, recipientId))) {
        throw AppError.forbidden('You cannot message this user');
      }

      const createdAt = new Date();
      const doc = {
        conversationId: oid(conversationId),
        senderId: oid(senderId),
        clientMessageId,
        type,
        body: type === 'text' ? sanitizeBody(body) : (body ?? ''),
        attachments,
        createdAt,
        // Messages age out independently, 30 days after they were actually sent.
        expiresAt: new Date(createdAt.getTime() + CHAT_TTL_MS),
      };

      const { message, created } = await this.repo.append(doc, { session });

      // Idempotent: a resend (same clientMessageId) returns the canonical copy without re-emitting
      // or re-incrementing unread counts.
      if (created) await this.conversations.recordMessage(convo, message, { session });

      return { convo, message, created };
    });

    // External side effects happen only after the transaction commits. This keeps transaction
    // retries from duplicating realtime events or push notifications.
    if (result.created) {
      this.gateway.emitToConversation(conversationId, EVENTS.MESSAGE_NEW, {
        message: result.message,
      });
      this.gateway.emitToUser(senderId, EVENTS.MESSAGE_NEW, { message: result.message });

      // A backgrounded app keeps its socket alive, so presence can't tell whether the app is
      // visible — push every non-muted recipient and let the client's foreground handler suppress
      // in-app banners.
      this.dispatchMessagePush({
        convo: result.convo,
        conversationId,
        message: result.message,
        senderId,
      });
      messagesSent.inc();
    }

    return result.message;
  }

  /**
   * Fire-and-forget push fan-out for a new message. Never awaited — notify() must not block acks.
   * @private
   */
  dispatchMessagePush({ convo, conversationId, message, senderId }) {
    const senderName = convo.participants?.[String(senderId)]?.displayName || 'New message';
    const itemTitle = convo.item?.title;
    const mutedSet = new Set((convo.mutedBy || []).map(String));
    const recipientIds = convo.participantIds.map(String).filter((id) => id !== String(senderId));
    const jobs = recipientIds
      .filter((rid) => !mutedSet.has(rid))
      .map((rid) => {
        if (this.presence) {
          void this.presence.isOnline(rid).then((online) => {
            if (online) pushRecipientOnline.inc();
          });
        }
        return this.notifications.notify({
          type: 'message',
          userId: rid,
          conversationId,
          message,
          senderName,
          itemTitle,
        });
      });
    if (!jobs.length) return;
    void Promise.allSettled(jobs);
  }

  async history(conversationId, userId, { before, limit } = {}) {
    const convo = await this.conversations.getMemberConversation(conversationId, userId);
    // Honor the caller's "delete for me" watermark: never return messages at/before it.
    const clearAfter = convo.clearedAt?.[String(userId)] ?? undefined;
    return this.repo.findByConversation(oid(conversationId), { before, limit, clearAfter });
  }

  /** Reconnect-sync: messages newer than the client's last-held id (oldest-first). */
  async syncSince(conversationId, userId, afterId, { limit } = {}) {
    const convo = await this.conversations.getMemberConversation(conversationId, userId);
    const clearAfter = convo.clearedAt?.[String(userId)] ?? undefined;
    return this.repo.findByConversation(oid(conversationId), { after: afterId, limit, clearAfter });
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
