/**
 * Layer: Transport (Socket.io gateway — THIN, delegates to services).
 * Owns the connection lifecycle: on connect, join the user room (user:<userId>) and active
 * conversation rooms (conv:<id>), mark presence online, register the message/typing/presence
 * handlers, and clean up on disconnect (presence offline). Receives io + the container's
 * services. This is the obvious first extraction target (doc §10) — keep it thin.
 * Must NOT hold business logic — handlers call services.
 */
