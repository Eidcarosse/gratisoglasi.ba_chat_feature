/**
 * Layer: Model (minimal mirror of the Fastify `outbox` collection — shared DB).
 * A sent message writes a `message.sent` event in the same transaction as the message (Fastify Decision 40).
 * This service pushes on its own with the legacy payloads old apps navigate on, so the event carries
 * `pushRequested: false` and the Fastify worker must not push a second time.
 */
import mongoose from 'mongoose';

const outboxSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    aggregateId: { type: mongoose.Schema.Types.ObjectId, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true, default: () => ({}) },
    status: { type: String, enum: ['pending', 'done', 'failed'], required: true, default: 'pending' },
    attempts: { type: Number, required: true, default: 0 },
    runAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastError: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { collection: 'outbox', timestamps: false, versionKey: false },
);

export const OutboxModel = mongoose.models.Outbox || mongoose.model('Outbox', outboxSchema, 'outbox');
export default OutboxModel;
