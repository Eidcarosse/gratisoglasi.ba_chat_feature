/**
 * Layer: Transport (socket handler — thin).
 * Wires presence into the connection lifecycle (doc §7). Connect/disconnect transitions are
 * handled in gateway.js (which knows the user's conversation rooms); this registers the
 * heartbeat that refreshes lastSeenAt so presence stays warm on long-lived sockets.
 * Must NOT hold business logic — delegate to presenceService.
 */
export function registerPresenceHandlers(socket, container) {
  const { presenceService } = container;
  const userId = socket.userId;

  socket.on('presence:heartbeat', async () => {
    try {
      await presenceService.touch(userId);
    } catch {
      // best-effort
    }
  });
}

export default registerPresenceHandlers;
