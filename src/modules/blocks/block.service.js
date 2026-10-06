/**
 * Layer: Service.
 * User-block business logic: block/unblock another user, list both of the caller's block
 * directions (who they blocked, and who blocked them), and the bidirectional isBlockedBetween()
 * consulted by the message-send and conversation-create guards.
 * blockerId always comes from the authenticated identity (req.userId) — never trusted from the
 * client. Resolves main-site display data through gratisService (never .populate across
 * connections). Must NOT touch Mongoose directly — go through blockRepository.
 */
import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError.js';
import { EVENTS } from '../../realtime/events.js';

const oid = (v) => new mongoose.Types.ObjectId(v);

export class BlockService {
  /**
   * @param {object} deps
   * @param {import('./block.repository.js').BlockRepository} deps.blockRepository
   * @param {import('../../integrations/gratis/gratis.service.js').GratisService} deps.gratisService
   * @param {import('../../realtime/gateway.js').Gateway} deps.gateway
   */
  constructor({ blockRepository, gratisService, gateway }) {
    this.repo = blockRepository;
    this.gratis = gratisService;
    this.gateway = gateway;
  }

  /** Block a user. blockerId = authenticated caller; blockedId = the target. Idempotent. */
  async block(blockerId, blockedId) {
    if (String(blockerId) === String(blockedId)) {
      throw AppError.validation('You cannot block yourself');
    }
    if (!(await this.gratis.userExists(blockedId))) {
      throw AppError.notFound('User not found');
    }
    await this.repo.create(oid(blockerId), oid(blockedId));
    return this.#afterChange(blockerId, blockedId);
  }

  /** Unblock a user. Idempotent — unblocking a user who isn't blocked is not an error. */
  async unblock(blockerId, blockedId) {
    await this.repo.remove(oid(blockerId), oid(blockedId));
    return this.#afterChange(blockerId, blockedId);
  }

  /**
   * Both block directions for the caller, in one query.
   *
   * `blocks`    — users the caller blocked, hydrated with display name/avatar (this drives the
   *               Block/Unblock toggle, so it needs something to render).
   * `blockedBy` — bare ids of users who blocked the caller. Ids only, deliberately: the FE uses
   *               this to gate composers and hide content, which needs no display data, and
   *               hydrating it would hand every user a named roster of everyone avoiding them.
   *
   * Neither list is stored — both are projections of the same `blocks` rows, so they are
   * consistent by construction and there is nothing to keep in sync. Live updates ride on the
   * `block:update` socket event emitted to both users by #afterChange.
   *
   * @returns {Promise<{blocks: object[], blockedBy: string[]}>}
   */
  async listForUser(userId) {
    const { outgoing, incoming } = await this.repo.listBothDirections(oid(userId));
    const summaries = await this.gratis.getUserSummaries(outgoing.map((r) => r.blockedId));

    const blocks = outgoing.map((r) => {
      const blockedId = String(r.blockedId);
      const summary = summaries.get(blockedId) || { displayName: 'User', avatarUrl: null };
      return {
        userId: blockedId,
        displayName: summary.displayName,
        avatarUrl: summary.avatarUrl,
        createdAt: r.createdAt,
      };
    });

    return { blocks, blockedBy: incoming.map((r) => String(r.blockerId)) };
  }

  /** Bidirectional guard used by the write paths: true if either user blocked the other. */
  async isBlockedBetween(a, b) {
    return this.repo.existsBetween(oid(a), oid(b));
  }

  /**
   * Directed block status for a pair, framed from `me`'s perspective. This is what the FE binds its
   * composer to: blockedByMe -> offer "Unblock"; blockedByThem -> "This user blocked you";
   * canMessage -> neither side blocked.
   * @returns {Promise<{blockedByMe: boolean, blockedByThem: boolean, canMessage: boolean}>}
   */
  async statusBetween(me, other) {
    const { aBlockedB, bBlockedA } = await this.repo.directionsBetween(oid(me), oid(other));
    return {
      blockedByMe: aBlockedB,
      blockedByThem: bBlockedA,
      canMessage: !(aBlockedB || bBlockedA),
    };
  }

  /**
   * Batch statusBetween for one caller against many others (inbox annotation, one query).
   * @returns {Promise<Map<string, {blockedByMe: boolean, blockedByThem: boolean, canMessage: boolean}>>}
   */
  async statusMap(me, otherIds) {
    const pairs = await this.repo.blockedPairsFor(
      oid(me),
      otherIds.map((id) => oid(id)),
    );
    const out = new Map();
    for (const id of otherIds) {
      const { blockedByMe = false, blockedByThem = false } = pairs.get(String(id)) || {};
      out.set(String(id), {
        blockedByMe,
        blockedByThem,
        canMessage: !(blockedByMe || blockedByThem),
      });
    }
    return out;
  }

  /**
   * After a block/unblock write: recompute the pair's directed state once and emit block:update to
   * BOTH users, each framed from their own perspective (the blocked user sees the mirror image).
   * Returns the caller's own BlockStatus so the controller can echo it in the HTTP response.
   * @private
   */
  async #afterChange(blockerId, blockedId) {
    const { aBlockedB, bBlockedA } = await this.repo.directionsBetween(
      oid(blockerId),
      oid(blockedId),
    );
    const canMessage = !(aBlockedB || bBlockedA);

    // Blocker's perspective: "me" = blockerId, "other" = blockedId.
    const blockerStatus = { blockedByMe: aBlockedB, blockedByThem: bBlockedA, canMessage };
    // Blocked user's perspective: booleans mirror (their "blockedByMe" is aBlockedB flipped side).
    const blockedStatus = { blockedByMe: bBlockedA, blockedByThem: aBlockedB, canMessage };

    this.gateway?.emitToUser(String(blockerId), EVENTS.BLOCK_UPDATE, {
      userId: String(blockedId),
      ...blockerStatus,
    });
    this.gateway?.emitToUser(String(blockedId), EVENTS.BLOCK_UPDATE, {
      userId: String(blockerId),
      ...blockedStatus,
    });

    return blockerStatus;
  }
}

export default BlockService;
