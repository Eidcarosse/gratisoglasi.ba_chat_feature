/**
 * Layer: Repository (IMessageRepository — ScyllaDB impl). LATER — placeholder (doc §5/§10).
 * NOT built at MVP. When high message volume hits (~1-year mark), implement the SAME
 * IMessageRepository contract against ScyllaDB:
 *   - PARTITION KEY = conversationId, CLUSTERING KEY = (time_bucket, message_id) so no
 *     partition grows unbounded — bucketing is an INTERNAL detail of this file only.
 *   - append stays idempotent on (conversationId, clientMessageId).
 * Migration path: implement here → dual-write (Mongo + Scylla) behind the container →
 * backfill history → validate → set MESSAGE_STORE=scylla → retire Mongo writes.
 * Services, handlers, controllers: UNTOUCHED. Must NOT hold business logic.
 */
