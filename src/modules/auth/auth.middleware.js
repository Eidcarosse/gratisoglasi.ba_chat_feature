/**
 * Layer: Transport (auth guards).
 * Two guards backed by the injected IAuthVerifier:
 *   - requireAuth (REST): reads the Bearer token, verifies it, attaches req.userId, else 401.
 *   - socketAuth (ws):    reads socket.handshake.auth.token, verifies it, attaches socket.userId,
 *                         else rejects the handshake.
 * SECURITY RULE: downstream code trusts req.userId / socket.userId ONLY — never a userId taken
 * from a request body or socket event payload. The token is read from the Authorization header
 * (REST) / handshake.auth (ws) only — both verifier impls read the same place, so the dev→jwt
 * swap needs no call-site changes.
 */
import { AppError } from '../../common/errors/AppError.js';

function extractBearer(req) {
  const header = req.headers?.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

/**
 * Factory — given a verifier, returns { requireAuth, socketAuth }.
 * @param {import('./auth.verifier.interface.js').IAuthVerifier} verifier
 */
export function createAuthMiddleware(verifier) {
  async function requireAuth(req, _res, next) {
    try {
      const token = extractBearer(req);
      if (!token) throw AppError.unauthenticated('Missing Bearer token');
      const { userId } = await verifier.verify(token);
      req.userId = userId;
      next();
    } catch (err) {
      next(err instanceof AppError ? err : AppError.unauthenticated());
    }
  }

  // Socket.io middleware signature: (socket, next). next(err) rejects the handshake.
  async function socketAuth(socket, next) {
    try {
      const token = socket.handshake?.auth?.token;
      const { userId } = await verifier.verify(token);
      socket.userId = userId;
      next();
    } catch (err) {
      next(err instanceof AppError ? err : AppError.unauthenticated());
    }
  }

  return { requireAuth, socketAuth };
}

export default createAuthMiddleware;
