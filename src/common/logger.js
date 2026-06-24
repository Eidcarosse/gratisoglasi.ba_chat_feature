/**
 * Layer: Common.
 * Structured logging via pino + the pino-http middleware factory. Every line carries a
 * request/connection id (see requestId middleware). This is the single logging entry point —
 * no console.log elsewhere.
 *
 * Deliberately free of any `config` import so that config/index.js can import the logger
 * (for its boot-time warnings) without a circular dependency. Reads LOG_LEVEL / NODE_ENV
 * straight from process.env.
 */
import pino from 'pino';
import pinoHttp from 'pino-http';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = pino({
  level,
  base: { service: 'marketplace-chat' },
  redact: {
    // Never log auth material or PII that may ride along on requests.
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password'],
    remove: true,
  },
});

/**
 * Express request-logging middleware. Reuses the request id assigned by the requestId
 * middleware (req.id) as the correlation id so every log line for a request is joinable.
 * Health/metrics endpoints are silenced — they fire constantly and carry no signal.
 */
export function httpLogger() {
  return pinoHttp({
    logger,
    genReqId: (req) => req.id,
    autoLogging: {
      ignore: (req) => req.url === '/healthz' || req.url === '/readyz' || req.url === '/metrics',
    },
  });
}

export default logger;
