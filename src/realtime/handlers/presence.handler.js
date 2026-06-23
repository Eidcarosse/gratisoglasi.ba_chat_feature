/**
 * Layer: Transport (socket handler — thin).
 * Wires presence into the connection lifecycle (doc §7): on connect/heartbeat/disconnect call
 * presenceService, which emits presence:update only to counterparties in active conversations.
 * Must NOT hold business logic — delegate to presenceService.
 */
