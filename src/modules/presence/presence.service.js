/**
 * Layer: Service.
 * Presence business logic (doc §7): on connect mark online (ref-counted), on heartbeat refresh
 * lastSeenAt, on disconnect decrement and mark offline when no sockets remain. The gateway
 * (which knows a user's conversation rooms) is responsible for emitting presence:update only to
 * counterparties — never a global broadcast. Depends on IPresenceStore (injected) — works
 * identically over the memory or Redis impl. Must NOT touch any store driver directly.
 */
export class PresenceService {
  /** @param {import('./presence.store.interface.js').IPresenceStore} presenceStore */
  constructor({ presenceStore }) {
    this.store = presenceStore;
  }

  /** @returns {Promise<boolean>} true if the user transitioned offline → online */
  online(userId, socketId) {
    return this.store.online(userId, socketId);
  }

  /** @returns {Promise<boolean>} true if the user transitioned online → offline */
  offline(userId, socketId) {
    return this.store.offline(userId, socketId);
  }

  isOnline(userId) {
    return this.store.isOnline(userId);
  }

  touch(userId) {
    return this.store.touch(userId);
  }

  getLastSeen(userId) {
    return this.store.getLastSeen(userId);
  }
}

export default PresenceService;
