/**
 * Layer: Model (Mongoose schema).
 * conversations collection — the denormalized inbox row (doc §4):
 *   { listingId, participantIds: [buyerId, sellerId], lastMessage: {body,senderId,type,createdAt},
 *     unreadCounts: { <userId>: int }, readState: { <userId>: {lastReadMessageId,lastReadAt} },
 *     createdAt, updatedAt }
 * Denormalized so inbox loads need no join+sort. NO messages array (unbounded-array anti-pattern).
 * Indexes:
 *   { participantIds: 1, updatedAt: -1 }        → inbox query
 *   { listingId: 1, participantIds: 1 } unique  → find-or-create one convo per (listing, pair)
 * Schema + indexes only; no cross-entity logic.
 */
