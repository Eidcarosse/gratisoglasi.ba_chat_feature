/**
 * Layer: Transport (socket handler — thin).
 * Registers typing:start / typing:stop (doc §7). Ephemeral, NEVER persisted: verify the sender
 * is a participant, then relay a `typing` event to the OTHER participant only (conv room minus
 * sender). Client throttles emits (~2–3s) and auto-expires if a stop is lost.
 * Must NOT hold business logic.
 */
import { EVENTS } from '../events.js';
import { convRoom } from '../rooms.js';
import { validatePayload } from '../../common/middleware/validate.js';
import { z, objectIdString } from '../../common/validation/index.js';

const typingSchema = z.object({ conversationId: objectIdString });

export function registerTypingHandlers(socket, container) {
  const { conversationService } = container;
  const userId = socket.userId;

  const relay = (isTyping) => async (payload) => {
    try {
      const { conversationId } = validatePayload(typingSchema, payload);
      // Membership guard — never relay typing into a conversation the sender isn't part of.
      await conversationService.getMemberConversation(conversationId, userId);
      socket.to(convRoom(conversationId)).emit(EVENTS.TYPING, { conversationId, userId, isTyping });
    } catch {
      // Typing is best-effort; swallow errors (no ack on this event).
    }
  };

  socket.on(EVENTS.TYPING_START, relay(true));
  socket.on(EVENTS.TYPING_STOP, relay(false));
}

export default registerTypingHandlers;
