/**
 * Layer: Service.
 * User-block business logic: block/unblock another user, list who the caller has blocked, and the
 * bidirectional isBlockedBetween() consulted by the message-send and conversation-create guards.
 * blockerId always comes from the authenticated identity (req.userId) — never trusted from the
 * client. Resolves main-site display data through gratisService (never .populate across
 * connections). Must NOT touch Mongoose directly — go through blockRepository.
 */
import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError.js';

const oid = (v) => new mongoose.Types.ObjectId(v);

export class BlockService {
  /**
   * @param {object} deps
   * @param {import('./block.repository.js').BlockRepository} deps.blockRepository
   * @param {import('../../integrations/gratis/gratis.service.js').GratisService} deps.gratisService
   */
  constructor({ blockRepository, gratisService }) {
    this.repo = blockRepository;
    this.gratis = gratisService;
  }

  /** Block a user. blockerId = authenticated caller; blockedId = the target. Idempotent. */
  async block(blockerId, blockedId) {
    if (String(blockerId) === String(blockedId)) {
      throw AppError.validation('You cannot block yourself');
    }
    if (!(await this.gratis.userExists(blockedId))) {
      throw AppError.notFound('User not found');
    }
    return this.repo.create(oid(blockerId), oid(blockedId));
  }

  /** Unblock a user. Idempotent — unblocking a user who isn't blocked is not an error. */
  async unblock(blockerId, blockedId) {
    await this.repo.remove(oid(blockerId), oid(blockedId));
    return { ok: true };
  }

  /** List the users the caller has blocked, hydrated with their display name/avatar. */
  async listBlocked(blockerId) {
    const rows = await this.repo.listByBlocker(oid(blockerId));
    const summaries = await this.gratis.getUserSummaries(rows.map((r) => r.blockedId));
    return rows.map((r) => {
      const userId = String(r.blockedId);
      const summary = summaries.get(userId) || { displayName: 'User', avatarUrl: null };
      return {
        userId,
        displayName: summary.displayName,
        avatarUrl: summary.avatarUrl,
        createdAt: r.createdAt,
      };
    });
  }

  /** Bidirectional guard used by the write paths: true if either user blocked the other. */
  async isBlockedBetween(a, b) {
    return this.repo.existsBetween(oid(a), oid(b));
  }
}

export default BlockService;
