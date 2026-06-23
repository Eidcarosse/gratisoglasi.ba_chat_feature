/**
 * Layer: Service.
 * Conversation business logic: find-or-create one conversation per (listing, buyer-seller pair),
 * load a user's inbox, compute/reset unread counts, and apply read-state updates. Enforces
 * participant membership (authorization) on every operation. Called by messageService (to update
 * the inbox snapshot on send) and by the conversation controller / realtime handlers.
 * Must NOT touch Mongoose directly — go through conversationRepository.
 */
