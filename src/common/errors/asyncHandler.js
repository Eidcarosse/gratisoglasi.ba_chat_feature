/**
 * Layer: Common.
 * asyncHandler(fn) — wraps an async Express route/controller so rejected promises are forwarded
 * to next() and caught by the centralized error handler, avoiding try/catch in every handler.
 */
