/**
 * Layer: Auth (verifier seam — JWT impl, AUTH_MODE=jwt, LATER).
 * Verifies a signed JWT issued by the main site using a shared secret, and returns the embedded
 * main-site userId. Slots into the SAME IAuthVerifier interface as DevVerifier, so enabling it
 * is a config-only change (AUTH_MODE=jwt + JWT_SECRET) once the main site adds auth.
 *
 * Expected claim: { sub | userId } = main-site users._id.
 */
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { IAuthVerifier } from './auth.verifier.interface.js';
import { AppError } from '../../common/errors/AppError.js';

export class JwtVerifier extends IAuthVerifier {
  constructor(secret) {
    super();
    if (!secret) throw new Error('JwtVerifier requires a secret');
    this.secret = secret;
  }

  async verify(token) {
    if (!token || typeof token !== 'string') {
      throw AppError.unauthenticated('Missing token');
    }
    let claims;
    try {
      claims = jwt.verify(token, this.secret);
    } catch {
      throw AppError.unauthenticated('Invalid or expired token');
    }
    const userId = claims.userId || claims.sub;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.unauthenticated('Token missing a valid userId claim');
    }
    return { userId: String(userId) };
  }
}

export default JwtVerifier;
