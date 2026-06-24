/**
 * Layer: Model (Mongoose schema — chat DB).
 * devices collection — push tokens, modeled now / used later (doc §4):
 *   { userId, platform: 'ios'|'android'|'web', token, createdAt, lastSeenAt }.
 * userId is a main-site users._id (unenforced cross-DB ref — same caveat as conversations).
 * Indexes: { userId: 1 }, { token: 1 } unique. Schema + indexes only; no cross-entity logic.
 */
import mongoose from 'mongoose';
import { DEVICE_PLATFORM } from '../../config/constants.js';

const deviceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    platform: { type: String, enum: DEVICE_PLATFORM, required: true },
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

deviceSchema.index({ userId: 1 });
deviceSchema.index({ token: 1 }, { unique: true });

export const DeviceModel = mongoose.model('Device', deviceSchema);
export default DeviceModel;
