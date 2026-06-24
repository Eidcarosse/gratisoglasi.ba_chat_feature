/**
 * Layer: Common (middleware).
 * Per-user / per-connection rate limiting (doc §8): caps on messages/sec, NEW-conversation
 * creation (marketplaces attract scam mass-DMing — throttle this specifically), and connection
 * attempts. In-memory counters TODAY; swap the backing store to Redis LATER (doc §10) without
 * changing call sites.
 *
 * NOTE: under AUTH_MODE=dev the keying identity (req.userId) is spoofable, so these limits are
 * best-effort until JWT lands. They still blunt naive abuse.
 */
import { AppError } from '../errors/AppError.js';

/**
 * A fixed-window counter store. Designed so the whole module can be swapped for a Redis-backed
 * implementation later without touching call sites.
 */
class MemoryWindowStore {
  constructor() {
    this.buckets = new Map(); // key -> { count, resetAt }
  }

  hit(key, windowMs, max) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: max - 1 };
    }
    bucket.count += 1;
    return { allowed: bucket.count <= max, remaining: Math.max(0, max - bucket.count) };
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
