/**
 * Layer: Transport (Socket.io gateway — THIN, delegates to services).
 * Owns the connection lifecycle: on connect, join the user room (user:<userId>) and active
 * conversation rooms (conv:<id>), mark presence online, register the message/typing/presence
 * handlers, and clean up on disconnect (presence offline). The obvious first extraction target
 * (doc §10) — keep it thin. Must NOT hold business logic — handlers call services.
 *
 * Gateway is also the injectable emitter: services receive it from the container and call
 * emitToConversation / emitToUser. `io` is attached here at socket-loader time, so a service
 * built before the socket server exists (or in REST-only tests) simply emits to a no-op.
 */
import { convRoom, userRoom } from './rooms.js';
import { EVENTS } from './events.js';
import { logger } from '../common/logger.js';
import { socketConnections } from '../common/metrics.js';
import { registerMessageHandlers } from './handlers/message.handler.js';
import { registerTypingHandlers } from './handlers/typing.handler.js';
import { registerPresenceHandlers } from './handlers/presence.handler.js';

export class Gateway {
  constructor() {
    this.io = null;
  }
  attach(io) {
    this.io = io;
  }
  emitToConversation(conversationId, event, payload) {
    this.io?.to(convRoom(conversationId)).emit(event, payload);
  }
  emitToUser(userId, event, payload) {
    this.io?.to(userRoom(userId)).emit(event, payload);
  }
}

export function registerGateway(io, container) {
  container.gateway.attach(io);
  const { conversationService, presenceService } = container;

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    socketConnections.inc();
    socket.join(userRoom(userId));

    // Join the rooms for the user's active conversations so room-scoped emits reach them.
    let convIds = [];
    try {
      const convos = await conversationService.listInbox(userId);
      convIds = convos.map((c) => String(c._id));
      for (const id of convIds) socket.join(convRoom(id));
    } catch (err) {
      logger.warn({ err, userId }, 'failed to join conversation rooms on connect');
    }

    // Presence: announce online to counterparties in the user's conversations.
    const becameOnline = await presenceService.online(userId, socket.id);
    if (becameOnline) {
      for (const id of convIds) {
        socket.to(convRoom(id)).emit(EVENTS.PRESENCE_UPDATE, { userId, status: 'online' });
      }
    }

    registerMessageHandlers(socket, container);
    registerTypingHandlers(socket, container);
    registerPresenceHandlers(socket, container);

    socket.on('disconnect', async () => {
      socketConnections.dec();
      const becameOffline = await presenceService.offline(userId, socket.id);
      if (becameOffline) {
        const lastSeenAt = await presenceService.getLastSeen(userId);
        for (const id of convIds) {
          socket
            .to(convRoom(id))
            .emit(EVENTS.PRESENCE_UPDATE, { userId, status: 'offline', lastSeenAt });
        }
      }
    });
  });
}

export default registerGateway;
