/**
 * Layer: Common (middleware).
 * Security headers via Helmet (doc §8), configured for an API that also serves a Socket.io
 * endpoint. Applied globally in loaders/express.js (TLS terminates at Nginx; CORS allowlist is
 * configured alongside).
 */
import helmet from 'helmet';
import cors from 'cors';
import { config } from '../../config/index.js';

export function securityHeaders() {
  // API + ws endpoint: no HTML is served, so the restrictive CSP/COEP defaults add no value and
  // can interfere with cross-origin ws upgrades. Keep the useful header hardening, drop CSP.
  return helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
}

export function corsMiddleware() {
  const origins = config.CORS_ORIGINS;
  const allowAll = origins.length === 1 && origins[0] === '*';
  return cors({
    origin: allowAll ? true : origins,
    credentials: !allowAll,
  });
}

export default securityHeaders;
