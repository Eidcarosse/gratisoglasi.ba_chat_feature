/**
 * Layer: Transport (route definitions).
 * Declares /conversations/:conversationId/messages routes guarded by requireAuth, with
 * validate() zod schemas (history cursor params, send body), mapping to message.controller
 * handlers. Factory receiving deps from the container.
 */
