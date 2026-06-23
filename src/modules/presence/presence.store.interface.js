/**
 * Layer: Repository/Store (contract).
 * IPresenceStore — the contract for tracking who is online (ref-counted across multiple
 * devices/sockets) and their lastSeenAt. Methods (approx): online(userId, socketId),
 * offline(userId, socketId), isOnline(userId), touch(userId), getLastSeen(userId).
 * Today: in-process Map impl. Later: Redis-TTL impl — SAME interface (doc §10).
 * Must NOT hold business logic.
 */
