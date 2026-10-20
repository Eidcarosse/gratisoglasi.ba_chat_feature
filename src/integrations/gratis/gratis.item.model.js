/**
 * Layer: Integration (Gratis main-site data in the shared DB).
 * A lean read model over the shared `ads` collection (Fastify schema). Only the fields the chat needs are
 * declared; strict false tolerates the rest of the document. autoIndex/autoCreate are off globally.
 *   addedBy = seller · title · priceMinor (NULLABLE, integer fening) · images[] = [{ id, order }]
 *   status ∈ active|hidden|sold|expired|deleted · moderation.state ∈ approved|pending|rejected
 */
import mongoose from 'mongoose';

const gratisAdSchema = new mongoose.Schema(
  {
    addedBy: mongoose.Schema.Types.ObjectId,
    title: String,
    priceMinor: Number,
    images: [{ _id: false, id: String, order: Number }],
    status: String,
    moderation: { state: String },
  },
  { collection: 'ads', strict: false, autoIndex: false, autoCreate: false },
);

const gratisBidSchema = new mongoose.Schema(
  {
    adId: mongoose.Schema.Types.ObjectId,
    bidderId: mongoose.Schema.Types.ObjectId,
    status: String,
    acceptedAt: Date,
    rejectedAt: Date,
  },
  { collection: 'bids', strict: false, autoIndex: false, autoCreate: false },
);

export function makeGratisItemModel(conn = mongoose.connection) {
  return conn.models.GratisAd || conn.model('GratisAd', gratisAdSchema, 'ads');
}

export function makeGratisBidModel(conn = mongoose.connection) {
  return conn.models.GratisBid || conn.model('GratisBid', gratisBidSchema, 'bids');
}

export default makeGratisItemModel;
