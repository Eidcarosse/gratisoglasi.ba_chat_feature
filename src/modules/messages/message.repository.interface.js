/**
 * Layer: Repository (contract) — THE seam that makes the ScyllaDB migration a non-event.
 * IMessageRepository defines the conversation-partitioned, cursor-based access contract that
 * every message store must satisfy. The shape is chosen on purpose to match exactly what
 * ScyllaDB will need (partition by conversationId, clustering by id/time-bucket).
 *
 * Methods:
 *   append(message)                                   // idempotent on (conversationId, clientMessageId)
 *   findByConversation(conversationId, {before, limit}) // keyset pagination, newest-first
 *   findByClientMessageId(conversationId, clientMessageId) // dedup lookup
 *   getById(id)
 *
 * Today: MongoMessageRepository. Later: ScyllaMessageRepository — SAME interface (doc §5).
 * Implementations must NOT hold business logic.
 */
