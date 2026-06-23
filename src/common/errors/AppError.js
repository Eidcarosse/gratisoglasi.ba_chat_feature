/**
 * Layer: Common.
 * AppError — base application error carrying an HTTP statusCode + a stable machine-readable
 * error code, plus the catalog of error codes. Thrown by services/transports; translated to a
 * consistent JSON shape by the centralized Express error handler and to socket ack errors.
 */
