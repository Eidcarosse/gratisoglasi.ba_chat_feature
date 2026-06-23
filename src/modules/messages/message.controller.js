/**
 * Layer: Transport (REST controller).
 * Message HTTP endpoints (primarily history fetch with keyset pagination; REST send fallback
 * for non-socket clients): validate input, enforce participant membership, call messageService,
 * shape the response. The realtime path lives in realtime/handlers/message.handler.js.
 * Must NOT hold business logic or touch the DB.
 */
