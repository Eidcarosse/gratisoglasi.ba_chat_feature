/**
 * Layer: Loader.
 * Builds the Express app: global middleware (requestId, securityHeaders/helmet, cors,
 * json body parsing, pino-http logging, rate limiting), mounts each module's routes,
 * exposes /healthz (liveness) and /readyz (Mongo reachable), and registers the centralized
 * error handler LAST. Receives the container so route factories get their services injected.
 * Must NOT hold business logic.
 */
