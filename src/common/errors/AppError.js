/**
 * Layer: Common.
 * AppError — base application error carrying an HTTP statusCode + a stable machine-readable
 * error code, plus the catalog of error codes. Thrown by services/transports; translated to a
 * consistent JSON shape by the centralized Express error handler and to socket ack errors.
 */

export const ErrorCodes = Object.freeze({
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAVAILABLE: 'UNAVAILABLE',
  INTERNAL: 'INTERNAL',
});

export class AppError extends Error {
  /**
   * @param {string} code   one of ErrorCodes
   * @param {string} message human-readable message
   * @param {number} statusCode HTTP status
   * @param {object} [details] optional structured details (e.g. zod field errors)
   */
  constructor(code, message, statusCode = 500, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
    // Mark as operational so the error handler can distinguish expected vs programmer errors.
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }

  /** Serializable shape used by both the REST error handler and socket ack errors. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static validation(message = 'Invalid request', details) {
    return new AppError(ErrorCodes.VALIDATION, message, 400, details);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError(ErrorCodes.UNAUTHENTICATED, message, 401);
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(ErrorCodes.FORBIDDEN, message, 403);
  }
  static notFound(message = 'Not found') {
    return new AppError(ErrorCodes.NOT_FOUND, message, 404);
  }
  static conflict(message = 'Conflict') {
    return new AppError(ErrorCodes.CONFLICT, message, 409);
  }
  static rateLimited(message = 'Too many requests') {
    return new AppError(ErrorCodes.RATE_LIMITED, message, 429);
  }
  static unavailable(message = 'Service unavailable') {
    return new AppError(ErrorCodes.UNAVAILABLE, message, 503);
  }
}

export default AppError;
