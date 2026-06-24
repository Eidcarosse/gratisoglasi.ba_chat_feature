/**
 * Layer: Store (IPresenceStore — in-process Map impl, TODAY).
 * Ref-counted online state in a Map<userId, Set<socketId>> plus lastSeenAt. Correct for a
 * single Node process at MVP. Lost on restart (fine — clients reconnect and re-announce).
 * Must NOT hold business logic.
 */
import { IPresenceStore } from './presence.store.interface.js';

export class MemoryPresenceStore extends IPresenceStore {
  constructor() {
    super();
    this.sockets = new Map(); // userId -> Set<socketId>
    this.lastSeen = new Map(); // userId -> Date
  }

  async online(userId, socketId) {
    const set = this.sockets.get(userId) ?? new Set();
    const wasOffline = set.size === 0;
    set.add(socketId);
    this.sockets.set(userId, set);
    this.lastSeen.set(userId, new Date());
    return wasOffline;
  }

  async offline(userId, socketId) {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    this.lastSeen.set(userId, new Date());
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
    this.lastSeen.set(userId, new Date());
  }

  async getLastSeen(userId) {
    return this.lastSeen.get(userId) ?? null;
  }
}

export default MemoryPresenceStore;
