/**
 * Layer: Common (middleware).
 * Security headers via Helmet (doc §8), configured for an API that also serves a Socket.io
 * endpoint. Applied globally in loaders/express.js (TLS terminates at Nginx; CORS allowlist is
 * configured alongside).
 */
