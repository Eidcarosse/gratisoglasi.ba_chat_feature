/**
 * Layer: Common.
 * asyncHandler(fn) — wraps an async Express route/controller so rejected promises are forwarded
 * to next() and caught by the centralized error handler, avoiding try/catch in every handler.
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export default asyncHandler;
