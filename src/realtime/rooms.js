/**
 * Layer: Transport (helper).
 * Room-name builders — the shared convention so emits target rooms, never io.emit globally
 * (room-scoped emits "just work" across nodes once the Redis adapter is added):
 *   convRoom(conversationId) → `conv:<id>`   (both participants)
 *   userRoom(userId)         → `user:<id>`   (all of a user's sockets/devices — cross-device sync)
 * No logic beyond string construction.
 */
