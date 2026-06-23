/**
 * Layer: Transport (route definitions).
 * Declares the /auth routes (POST /register, /login, /refresh, /logout), attaching the
 * validate() middleware (zod schemas) and mapping each to an auth.controller handler.
 * Exported as a factory that receives the controller/services from the container.
 */
