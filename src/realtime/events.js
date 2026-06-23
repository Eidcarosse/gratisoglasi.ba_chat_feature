/**
 * Layer: Transport (shared contract).
 * Socket.io event-name constants — the single source of truth shared by server handlers and
 * clients (doc §6). e.g.:
 *   C→S: message:send, message:delivered, message:read, typing:start, typing:stop, conversation:sync
 *   S→C: message:new, receipt:update, typing, presence:update
 * Constants only — no logic.
 */
