/**
 * Layer: Store (IPresenceStore — in-process Map impl, TODAY).
 * Ref-counted online state in a Map<userId, Set<socketId>> plus lastSeenAt. Correct for a
 * single Node process at MVP. Lost on restart (fine — clients reconnect and re-announce).
 * Must NOT hold business logic.
 *
 * MEMORY: `sockets` is cleaned up when a user's last socket disconnects. `lastSeen` is a bounded
 * recency-ordered LRU — recording moves an entry to the tail, and the oldest entries are evicted
 * past a cap. Without the cap it would grow once per user who ever connected (unbounded), which
 * makes the process slower over time even without more concurrent users.
 */
import { IPresenceStore } from './presence.store.interface.js';
import { presenceLastSeenEntries } from '../../common/metrics.js';

// Retain lastSeen for at most this many recently-active users. The gateway reads getLastSeen()
// immediately after offline(), so the just-recorded entry is always present; only long-idle
// users get evicted.
const MAX_LAST_SEEN = 50_000;

export class MemoryPresenceStore extends IPresenceStore {
  constructor({ maxLastSeen = MAX_LAST_SEEN } = {}) {
    super();
    this.sockets = new Map(); // userId -> Set<socketId>
    this.lastSeen = new Map(); // userId -> Date (recency-ordered; insertion order == recency)
    this.maxLastSeen = maxLastSeen;
  }

  // Record lastSeen and keep it as the most-recent entry: delete+set moves it to the Map tail so
  // insertion order tracks recency, then evict the oldest entries once we exceed the cap.
  noteLastSeen(userId) {
    this.lastSeen.delete(userId);
    this.lastSeen.set(userId, new Date());
    while (this.lastSeen.size > this.maxLastSeen) {
      const oldest = this.lastSeen.keys().next().value;
      this.lastSeen.delete(oldest);
    }
    presenceLastSeenEntries.set(this.lastSeen.size);
  }

  async online(userId, socketId) {
    const set = this.sockets.get(userId) ?? new Set();
    const wasOffline = set.size === 0;
    set.add(socketId);
    this.sockets.set(userId, set);
    this.noteLastSeen(userId);
    return wasOffline;
  }

  async offline(userId, socketId) {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    this.noteLastSeen(userId);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return true;
    }
    return false;
  }

  async isOnline(userId) {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  async touch(userId) {
    this.noteLastSeen(userId);
  }

  async getLastSeen(userId) {
    return this.lastSeen.get(userId) ?? null;
  }
}

export default MemoryPresenceStore;
