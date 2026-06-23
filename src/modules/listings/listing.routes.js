/**
 * Layer: Transport (route definitions).
 * Declares /listings routes (public reads; writes guarded by requireAuth) with validate()
 * zod schemas, mapping to listing.controller handlers. Factory receiving deps from the container.
 */
