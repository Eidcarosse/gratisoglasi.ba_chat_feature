/**
 * Layer: Integration (Gratis main-site data — READ-ONLY repository).
 * The ONLY place users / ads / bids are read. Exposes reads ONLY — there is deliberately no write method on
 * this surface, so the chat service cannot mutate main-site data by accident. All queries are `.lean()`.
 */
import mongoose from 'mongoose';
import { makeGratisUserModel } from './gratis.user.model.js';
import { makeGratisItemModel, makeGratisBidModel } from './gratis.item.model.js';

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

export class GratisRepository {
  /** @param {import('mongoose').Connection} conn the shared connection */
  constructor(conn) {
    this.User = makeGratisUserModel(conn);
    this.Item = makeGratisItemModel(conn);
    this.Bid = makeGratisBidModel(conn);
  }

  async getItemById(id) {
    if (!validId(id)) return null;
    return this.Item.findById(id).lean();
  }

  async getItemsByIds(ids) {
    const valid = (ids || []).filter(validId);
    if (valid.length === 0) return [];
    return this.Item.find({ _id: { $in: valid } })
      .select({ status: 1, moderation: 1 })
      .lean();
  }

  /** True if `bidderId` has an active offer on ad `itemId` that the seller accepted (and has not since rejected). */
  async hasAcceptedBid(itemId, bidderId) {
    if (!validId(itemId) || !validId(bidderId)) return false;
    const hit = await this.Bid.exists({
      adId: itemId,
      bidderId,
      status: 'active',
      acceptedAt: { $ne: null },
      rejectedAt: null,
    });
    return Boolean(hit);
  }

  async getUserById(id) {
    if (!validId(id)) return null;
    return this.User.findById(id).lean();
  }

  async getUsersByIds(ids) {
    const valid = (ids || []).filter(validId);
    if (valid.length === 0) return [];
    return this.User.find({ _id: { $in: valid } }).lean();
  }
}

export default GratisRepository;
