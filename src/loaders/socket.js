/**
 * Layer: Loader.
 * Creates the Socket.io server bound to the HTTP server with transports: ['websocket']
 * (single TCP connection — no sticky sessions needed before going multi-node). Installs the
 * socketAuth handshake middleware (validates JWT, attaches socket.userId), and hands the io
 * instance to realtime/gateway.js to register connection handlers.
 * LATER (§10): attach @socket.io/redis-adapter here for cross-node pub/sub — the only change
 * needed to run multi-process. Must NOT hold business logic.
 */
