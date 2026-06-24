/**
 * Layer: Repository/Store (contract).
 * IPresenceStore — the contract for tracking who is online (ref-counted across multiple
 * devices/sockets) and their lastSeenAt. Today: in-process Map impl. Later: Redis-TTL impl —
 * SAME interface (doc §10). Must NOT hold business logic.
 */
/* eslint-disable no-unused-vars */
export class IPresenceStore {
  // Returns true if this brought the user from offline → online.
  async online(userId, socketId) {
    throw new Error('not implemented');
  }
  // Returns true if this removed the user's last socket (online → offline).
  async offline(userId, socketId) {
    throw new Error('not implemented');
  }
  async isOnline(userId) {
    throw new Error('not implemented');
  }
  async touch(userId) {
    throw new Error('not implemented');
  }
  async getLastSeen(userId) {
    throw new Error('not implemented');
  }
}

export default IPresenceStore;
