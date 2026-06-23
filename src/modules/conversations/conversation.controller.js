/**
 * Layer: Transport (REST controller).
 * Conversation HTTP endpoints (list inbox, find-or-create for a listing, get one): validate
 * input, enforce that req.userId is a participant, call conversationService, shape the response.
 * Must NOT hold business logic or touch the DB.
 */
