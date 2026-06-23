/**
 * Layer: Store (IPresenceStore — Redis-TTL impl). LATER — placeholder (doc §10).
 * NOT built at MVP. When going multi-process/multi-node, implement the SAME IPresenceStore
 * contract on Redis (e.g. SET presence:<userId> EX 60, refreshed by heartbeat) so presence is
 * shared across the fleet. Flip the container to inject this instead of the memory impl —
 * presenceService and everything above it stay untouched. Must NOT hold business logic.
 */
