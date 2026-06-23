/**
 * Layer: Model (Mongoose schema).
 * devices collection — push tokens, modeled now / used later (doc §4):
 *   { userId, platform: 'ios'|'android'|'web', token, createdAt, lastSeenAt }.
 * Indexes: { userId: 1 }, { token: 1 } unique.
 * Schema + indexes only; no cross-entity logic.
 */
