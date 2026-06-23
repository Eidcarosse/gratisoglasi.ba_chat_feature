/**
 * Layer: Repository (IMessageRepository — Mongo impl, TODAY).
 * Backs the message contract with MessageModel:
 *   - append:   findOneAndUpdate upsert on { conversationId, clientMessageId } with $setOnInsert
 *               → safe retries (a flaky-reconnect resend is a no-op, not a duplicate).
 *   - findByConversation: { conversationId, _id < before } sort _id:-1 limit  → KEYSET, not skip.
 *   - findByClientMessageId / getById: lean lookups.
 * Must NOT hold business logic.
 */
