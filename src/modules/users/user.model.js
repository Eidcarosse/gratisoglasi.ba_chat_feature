/**
 * Layer: Model (Mongoose schema).
 * users collection (doc §4): { email (unique), passwordHash, displayName, avatarUrl,
 * createdAt, updatedAt }. Index: { email: 1 } unique.
 * Deliberately does NOT store a conversation list (unbounded) — query conversations by
 * participant instead. Schema + indexes + basic field validation only; no cross-entity logic.
 */
