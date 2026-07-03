/**
 * Layer: Common (middleware).
 * Per-user / per-connection rate limiting (doc §8): caps on messages/sec, NEW-conversation
 * creation (marketplaces attract scam mass-DMing — throttle this specifically), and connection
 * attempts. In-memory counters TODAY; swap the backing store to Redis LATER (doc §10) without
 * changing call sites.
 *
 * MEMORY: the bucket Map is self-bounding — a fixed-window entry is created once per distinct
 * (prefix × user/IP) key, expires, and is reclaimed by a periodic unref'd sweep plus a hard
 * size cap. Without this, the Map grows once per key ever seen and the process gets slower over
 * time (rising RSS → GC pressure → restart) even without more concurrent users.
 *
 * NOTE: under AUTH_MODE=dev the keying identity (req.userId) is spoofable, so these limits are
 * best-effort until JWT lands. They still blunt naive abuse.
 */
import { AppError } from '../errors/AppError.js';
import { rateLimitBuckets } from '../metrics.js';

// Sweep expired buckets this often; hard cap on distinct live keys as a backstop between sweeps.
const SWEEP_INTERVAL_MS = 30_000;
const MAX_BUCKETS = 50_000;

/**
 * A fixed-window counter store. Designed so the whole module can be swapped for a Redis-backed
 * implementation later without touching call sites.
 */
class MemoryWindowStore {
  constructor({ sweepIntervalMs = SWEEP_INTERVAL_MS, maxBuckets = MAX_BUCKETS } = {}) {
    this.buckets = new Map(); // key -> { count, resetAt }
    this.maxBuckets = maxBuckets;
    // Periodic eviction of expired buckets. unref() so this housekeeping timer never keeps the
    // event loop / process alive and never blocks graceful shutdown.
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  hit(key, windowMs, max) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      // New window. Enforce the hard cap so a burst of distinct keys between sweeps can't grow the
      // Map without bound: sweep expired first, and if still full drop the oldest-inserted entry.
      if (!bucket && this.buckets.size >= this.maxBuckets) this.sweep();
      if (!bucket && this.buckets.size >= this.maxBuckets) this.evictOldest(1);
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      rateLimitBuckets.set(this.buckets.size);
      return { allowed: true, remaining: max - 1 };
    }
    bucket.count += 1;
    return { allowed: bucket.count <= max, remaining: Math.max(0, max - bucket.count) };
  }

  /** Remove every expired bucket. O(n) over a Map the cap keeps bounded. */
  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
    rateLimitBuckets.set(this.buckets.size);
  }

  /** Backstop eviction: drop the oldest-inserted entries (Map preserves insertion order). */
  evictOldest(n) {
    let removed = 0;
    for (const key of this.buckets.keys()) {
      if (removed >= n) break;
      this.buckets.delete(key);
      removed += 1;
    }
  }
}

const store = new MemoryWindowStore();

/**
 * rateLimit({ windowMs, max, keyPrefix }) — limits by req.userId when present, else by client IP.
 */
export function rateLimit({ windowMs, max, keyPrefix = 'rl' }) {
  return (req, res, next) => {
    const identity = req.userId ? `u:${req.userId}` : `ip:${req.ip}`;
    const key = `${keyPrefix}:${identity}`;
    const { allowed, remaining } = store.hit(key, windowMs, max);
    res.setHeader('x-ratelimit-remaining', String(remaining));
    if (!allowed) {
      next(AppError.rateLimited());
      return;
    }
    next();
  };
}

export default rateLimit;
