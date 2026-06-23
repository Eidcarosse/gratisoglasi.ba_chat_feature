/**
 * Layer: Common.
 * Structured logging via pino — exports the shared logger and the pino-http middleware factory.
 * Every line carries the request/connection id (see requestId middleware). The single logging
 * entry point; no console.log elsewhere.
 */
