/**
 * Layer: Auth (verifier seam — DEV impl, AUTH_MODE=dev).
 * Trusts the claimed userId carried in the token WITHOUT any cryptographic verification —
 * mirroring the main site's current "trust the id from the request" posture. This is the ONE
 * deliberately-insecure spot in the codebase; it is isolated here so the JWT swap is a one-line
 * container change. The only validation is that the value is a syntactically valid ObjectId.
 *
 * Identity is spoofable in this mode — see config/index.js boot warning. Do NOT expose to
 * untrusted clients in production.
 */
import mongoose from 'mongoose';
import { IAuthVerifier } from './auth.verifier.interface.js';
import { AppError } from '../../common/errors/AppError.js';

export class DevVerifier extends IAuthVerifier {
  async verify(token) {
    if (!token || typeof token !== 'string' || !mongoose.Types.ObjectId.isValid(token)) {
      throw AppError.unauthenticated('Missing or malformed userId token');
    }
    return { userId: String(token) };
  }
}

export default DevVerifier;
