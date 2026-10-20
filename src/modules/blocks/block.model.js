/**
 * Layer: Model (Mongoose mirror of the Fastify `blocks` collection — shared DB).
 * One row per directed (blocker, blocked) pair; a block in EITHER direction forbids contact both ways.
 * Ids are users._id. No indexes here (Fastify's scripts/indexes.ts owns them).
 */
import mongoose from 'mongoose';

const blockSchema = new mongoose.Schema(
  {
    blockerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    blockedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'blocks', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const BlockModel = mongoose.models.Block || mongoose.model('Block', blockSchema, 'blocks');
export default BlockModel;
