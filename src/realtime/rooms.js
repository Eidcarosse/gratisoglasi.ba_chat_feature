/**
 * Layer: Transport (helper).
 * Room-name builders — the shared convention so emits target rooms, never io.emit globally
 * (room-scoped emits "just work" across nodes once the Redis adapter is added).
 * No logic beyond string construction.
 */
export const convRoom = (conversationId) => `conv:${conversationId}`;
export const userRoom = (userId) => `user:${userId}`;
