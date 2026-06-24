/**
 * Layer: Auth (verifier seam — the contract).
 * IAuthVerifier defines the single operation the auth guards depend on:
 *   verify(token) -> { userId }   // throws AppError.unauthenticated on invalid input
 * `userId` is always the main-site users._id (an ObjectId string). The container injects a
 * concrete impl chosen by AUTH_MODE: DevVerifier today (trusts the claimed id, no crypto),
 * JwtVerifier later (verifies a signed JWT). Swapping is config-only — call sites never change.
 */

export class IAuthVerifier {
  // eslint-disable-next-line no-unused-vars
  async verify(token) {
    throw new Error('IAuthVerifier.verify not implemented');
  }
}

export default IAuthVerifier;
