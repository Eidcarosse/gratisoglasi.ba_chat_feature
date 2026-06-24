/**
 * Layer: Integration (Gratis main-site — READ-ONLY).
 * A lean Mongoose model over the main-site `items` collection, bound to the read-only `gratis`
 * connection. Only the fields the chat needs are declared. autoIndex/autoCreate off; strict
 * false to tolerate the rest of the real item document.
 *   addedBy = seller (users._id) · title · price (NULLABLE) · images[] (thumbnail = images[0])
 *   hidden (soft-delete) · status ∈ Pending|Review|Approved
 */
import mongoose from 'mongoose';

const gratisItemSchema = new mongoose.Schema(
  {
    addedBy: mongoose.Schema.Types.ObjectId,
    title: String,
    price: Number,
    images: [String],
    hidden: Boolean,
    status: String,
  },
  { collection: 'items', strict: false, autoIndex: false, autoCreate: false },
);

/** @param {import('mongoose').Connection} gratisConn */
export function makeGratisItemModel(gratisConn) {
  return gratisConn.models.GratisItem || gratisConn.model('GratisItem', gratisItemSchema, 'items');
}

export default makeGratisItemModel;
