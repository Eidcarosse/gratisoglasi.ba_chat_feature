/**
 * Layer: Service — the single write path for messages.
 * Business logic for messaging (doc §7):
 *   - send(): authorize (sender ∈ conversation.participantIds), validate + sanitize body,
 *     messageRepository.append() (idempotent), then update the conversation inbox snapshot
 *     (lastMessage, bump updatedAt, $inc recipient unreadCounts) via conversationService,
 *     emit message:new through the gateway, and call notificationService.notify() on the
 *     offline path. Idempotent append + client dedup = feels exactly-once.
 *   - history(): keyset pagination via findByConversation.
 *   - receipts: record delivered/read on conversation.readState.
 * Depends on IMessageRepository (NOT a concrete store), conversationService, gateway,
 * notificationService — all injected by the container. Must NOT touch any DB driver directly.
 * NOTE: this is the one place to add a search-index hook later (doc §10).
 */
