/**
 * Layer: Common (middleware).
 * Assigns a unique request/connection id (generate or honor an inbound header) and attaches it
 * to the request and the logger context, so every log line is correlatable end-to-end.
 */
import { randomUUID } from 'node:crypto';

export function requestId() {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  };
}

export default requestId;
