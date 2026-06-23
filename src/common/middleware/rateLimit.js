/**
 * Layer: Common (middleware).
 * Per-user / per-connection rate limiting (doc §8): caps on messages/sec, NEW-conversation
 * creation (marketplaces attract scam mass-DMing — throttle this specifically), and connection
 * attempts. In-memory counters TODAY; swap the backing store to Redis LATER (doc §10) without
 * changing call sites.
 */
