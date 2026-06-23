/**
 * Layer: Repository (IConversationRepository — Mongo impl).
 * Data access for conversations: findOrCreate (atomic upsert on the unique
 * listingId+participantIds index), listByParticipant (inbox, sorted by updatedAt), getById,
 * and atomic inbox-snapshot updates (set lastMessage, bump updatedAt, $inc/reset unreadCounts,
 * set readState). The only place conversation documents are read/written.
 * Must NOT hold business logic.
 */
