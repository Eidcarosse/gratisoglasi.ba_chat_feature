/**
 * Layer: Transport (socket handler — thin).
 * Registers message-related socket events (doc §6/§7):
 *   message:send      → validate, authorize via socket.userId, messageService.send(), ack { ok, message }.
 *   message:delivered → relay receipt:update (deliveredMessageId) to the conversation.
 *   message:read      → conversationService read-state update (reset unread), emit receipt:update.
 *   conversation:sync → return messages newer than the client's per-conversation cursor.
 * SECURITY: trust socket.userId ONLY; the service verifies membership before any send/read.
 * Must NOT hold business logic — delegate to services.
 */
import { EVENTS } from '../events.js';
import { convRoom } from '../rooms.js';
import { validatePayload } from '../../common/middleware/validate.js';
import { ackLatency } from '../../common/metrics.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  z,
  objectIdString,
  objectId,
  sendMessageShape,
  refineSend,
} from '../../common/validation/index.js';

const sendSchema = refineSend(z.object({ conversationId: objectIdString, ...sendMessageShape }));

const deliveredSchema = z.object({ conversationId: objectIdString, messageId: objectIdString });
const readSchema = z.object({ conversationId: objectIdString, upToMessageId: objectId.optional() });
const syncSchema = z.object({ cursors: z.record(objectIdString, objectIdString) });

function ackErr(err) {
  if (err instanceof AppError) return { ok: false, error: err.toJSON() };
  return { ok: false, error: { code: 'INTERNAL', message: 'Internal error' } };
}

export function registerMessageHandlers(socket, container) {
  const { messageService, conversationService, gateway } = container;
  const userId = socket.userId;

  socket.on(EVENTS.MESSAGE_SEND, async (payload, ack) => {
    const end = ackLatency.startTimer();
    try {
      const data = validatePayload(sendSchema, payload);
      const message = await messageService.send({
        conversationId: data.conversationId,
        senderId: userId,
        clientMessageId: data.clientMessageId,
        type: data.type,
        body: data.body,
        attachments: data.attachments,
      });
      // Ensure the sender's socket is in the conv room (e.g. a conversation created this session).
      socket.join(convRoom(data.conversationId));
      if (typeof ack === 'function') ack({ ok: true, message });
    } catch (err) {
      if (typeof ack === 'function') ack(ackErr(err));
    } finally {
      end();
    }
  });

  socket.on(EVENTS.MESSAGE_DELIVERED, async (payload, ack) => {
    try {
      const data = validatePayload(deliveredSchema, payload);
      // Membership check (read path is enough — this only relays a receipt).
      await conversationService.getMemberConversation(data.conversationId, userId);
      gateway.emitToConversation(data.conversationId, EVENTS.RECEIPT_UPDATE, {
        conversationId: data.conversationId,
        userId,
        deliveredMessageId: data.messageId,
      });
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack(ackErr(err));
    }
  });

  socket.on(EVENTS.MESSAGE_READ, async (payload, ack) => {
    try {
      const data = validatePayload(readSchema, payload);
      const updated = await conversationService.markRead(
        data.conversationId,
        userId,
        data.upToMessageId,
      );
      gateway.emitToConversation(data.conversationId, EVENTS.RECEIPT_UPDATE, {
        conversationId: data.conversationId,
        userId,
        lastReadMessageId:
          updated?.readState?.[userId]?.lastReadMessageId ?? data.upToMessageId ?? null,
      });
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack(ackErr(err));
    }
  });

  socket.on(EVENTS.CONVERSATION_SYNC, async (payload, ack) => {
    try {
      const data = validatePayload(syncSchema, payload);
      const missed = [];
      for (const [conversationId, cursor] of Object.entries(data.cursors)) {
        const msgs = await messageService.syncSince(conversationId, userId, cursor);
        missed.push(...msgs);
      }
      if (typeof ack === 'function') ack({ ok: true, missed });
    } catch (err) {
      if (typeof ack === 'function') ack(ackErr(err));
    }
  });
}

export default registerMessageHandlers;
