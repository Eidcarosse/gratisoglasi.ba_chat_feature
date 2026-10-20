/**
 * Layer: Model (Mongoose mirror of the Fastify `devices` collection — shared DB).
 * Push tokens for every service: { userId, platform, token, createdAt, lastSeenAt }. The unique token index
 * lives in Fastify's scripts/indexes.ts.
 */
import mongoose from 'mongoose';
import { DEVICE_PLATFORM } from '../../config/constants.js';

const deviceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: DEVICE_PLATFORM, required: true },
    token: { type: String, required: true },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'devices', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const DeviceModel = mongoose.models.Device || mongoose.model('Device', deviceSchema, 'devices');
export default DeviceModel;
