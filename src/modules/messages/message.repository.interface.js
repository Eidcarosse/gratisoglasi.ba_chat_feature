/**
 * Layer: Repository (contract) — THE seam that makes the ScyllaDB migration a non-event.
 * IMessageRepository defines the conversation-partitioned, cursor-based access contract that
 * every message store must satisfy. The shape is chosen on purpose to match exactly what
 * ScyllaDB will need (partition by conversationId, clustering by id/time-bucket).
 *
 * Today: MongoMessageRepository. Later: ScyllaMessageRepository — SAME interface (doc §5).
 * Implementations must NOT hold business logic.
 */
/* eslint-disable no-unused-vars */
export class IMessageRepository {
  // Idempotent on (conversationId, clientMessageId). Returns { message, created }.
  async append(message) {
    throw new Error('not implemented');
  }
  // Keyset pagination, newest-first.
  async findByConversation(conversationId, { before, limit } = {}) {
    throw new Error('not implemented');
  }
  async findByClientMessageId(conversationId, clientMessageId) {
    throw new Error('not implemented');
  }
  async getById(id) {
    throw new Error('not implemented');
  }
  // Unsend for everyone: tombstone the message (set deletedAt, clear body+attachments). Returns
  // the updated doc, or null if not found. Idempotency/authorization live in the service.
  async softDelete(conversationId, messageId) {
    throw new Error('not implemented');
  }
}

export default IMessageRepository;
