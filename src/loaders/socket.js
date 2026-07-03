/**
 * Layer: Loader.
 * Creates the Socket.io server bound to the HTTP server with transports: ['websocket']
 * (single TCP connection — no sticky sessions needed before going multi-node). Installs the
 * socketAuth handshake middleware (verifier-backed, attaches socket.userId), and hands the io
 * instance to realtime/gateway.js to register connection handlers.
 * LATER (§10): attach @socket.io/redis-adapter here for cross-node pub/sub — the only change
 * needed to run multi-process. Must NOT hold business logic.
 */
import { Server } from 'socket.io';
import { config } from '../config/index.js';
import { SOCKET_TRANSPORTS } from '../config/constants.js';
import { registerGateway } from '../realtime/gateway.js';

export function attachSocket(httpServer, container) {
  const allowAll = config.CORS_ORIGINS.length === 1 && config.CORS_ORIGINS[0] === '*';
  const io = new Server(httpServer, {
    transports: [...SOCKET_TRANSPORTS],
    cors: { origin: allowAll ? true : config.CORS_ORIGINS, credentials: !allowAll },
    // Defense-in-depth cap on inbound event payload size. Events are small JSON (image BYTES go
    // straight to Cloudflare, never through here), so 100 KB is generous and mirrors the
    // express.json({ limit: '256kb' }) on the REST side — a malformed/oversized frame can't pin
    // memory. Default is 1 MB.
    maxHttpBufferSize: 1e5,
  });

  // Handshake auth — verifies once and stamps socket.userId. Downstream handlers trust ONLY
  // socket.userId, never a userId in an event payload.
  io.use(container.socketAuth);

  registerGateway(io, container);
  return io;
}

export default attachSocket;
