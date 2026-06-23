/**
 * Layer: Transport (socket handler — thin).
 * Registers message-related socket events (doc §6/§7):
 *   message:send      → validate payload, authorize via socket.userId, call messageService.send(),
 *                       ack { ok, message } so the client reconciles its optimistic copy.
 *   message:delivered → record delivery, emit receipt:update to the sender.
 *   message:read      → call conversationService read-state update (reset unread), emit receipt:update.
 *   conversation:sync → return messages newer than the client's per-conversation cursor.
 * SECURITY: trust socket.userId ONLY; verify membership before any send/read. Must NOT hold
 * business logic — delegate to services.
 */
