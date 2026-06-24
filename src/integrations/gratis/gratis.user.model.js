/**
 * Layer: Integration (Gratis main-site — READ-ONLY).
 * A lean Mongoose model over the main-site `users` collection, bound to the read-only `gratis`
 * connection (NOT the default registry — binding to the wrong connection would hit the chat DB).
 * Only the fields the chat needs are declared. autoIndex/autoCreate are off — we never run DDL
 * against the main DB. `strict:false` tolerates the many other fields on real user docs.
 *
 * Note: main-site `firstname`/`lastname` use a `require` typo so they may be absent — the gratis
 * service derives displayName defensively.
 */
import mongoose from 'mongoose';

const gratisUserSchema = new mongoose.Schema(
  {
    firstname: String,
    lastname: String,
    email: String,
    profilePicture: String,
    showEmail: Boolean,
  },
  { collection: 'users', strict: false, autoIndex: false, autoCreate: false },
);

/** @param {import('mongoose').Connection} gratisConn */
export function makeGratisUserModel(gratisConn) {
  return gratisConn.models.GratisUser || gratisConn.model('GratisUser', gratisUserSchema, 'users');
}

export default makeGratisUserModel;
