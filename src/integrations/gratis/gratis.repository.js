/**
 * Layer: Integration (Gratis main-site — READ-ONLY repository).
 * The ONLY place main-site documents are read. Exposes reads ONLY — there is deliberately no
 * write method on this surface, so read-only safety is structural, not merely a DB-user
 * convention. All queries are `.lean()` (plain objects, no change tracking → no accidental save).
 */
import mongoose from 'mongoose';
import { makeGratisUserModel } from './gratis.user.model.js';
import { makeGratisItemModel } from './gratis.item.model.js';

export class GratisRepository {
  /** @param {import('mongoose').Connection} gratisConn */
  constructor(gratisConn) {
    this.User = makeGratisUserModel(gratisConn);
    this.Item = makeGratisItemModel(gratisConn);
  }

  async getItemById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return this.Item.findById(id).lean();
  }

  async getUserById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return this.User.findById(id).lean();
  }

  async getUsersByIds(ids) {
    const valid = (ids || []).filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (valid.length === 0) return [];
    return this.User.find({ _id: { $in: valid } }).lean();
  }
}

export default GratisRepository;
