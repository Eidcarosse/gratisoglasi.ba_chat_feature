/**
 * Layer: Transport (shared contract).
 * Socket.io event-name constants — the single source of truth shared by server handlers and
 * clients (doc §6). Constants only — no logic.
 */
export const EVENTS = Object.freeze({
  // Client → Server
  MESSAGE_SEND: 'message:send',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  CONVERSATION_SYNC: 'conversation:sync',

  // Server → Client
  MESSAGE_NEW: 'message:new',
  MESSAGE_DELETED: 'message:deleted',
  RECEIPT_UPDATE: 'receipt:update',
  TYPING: 'typing',
  PRESENCE_UPDATE: 'presence:update',
  // Fires when a block between two users changes (either created or removed). Emitted to BOTH
  // parties, each with the payload framed from their own perspective (see BlockService). Lets an
  // already-open chat enable/disable its composer live and syncs the blocker's other devices.
  BLOCK_UPDATE: 'block:update',
});

export default EVENTS;
