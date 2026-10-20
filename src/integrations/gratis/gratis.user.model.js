/**
 * Layer: Integration (Gratis main-site data in the shared DB).
 * A lean read model over the shared `users` collection (Fastify schema). `profilePicture` is a Cloudflare
 * image id (null = the default avatar); `privacy.showEmail` replaces the old flat `showEmail`.
 */
import mongoose from 'mongoose';

const gratisUserSchema = new mongoose.Schema(
  {
    firstname: String,
    lastname: String,
    email: String,
    profilePicture: String,
    privacy: { showEmail: Boolean },
  },
  { collection: 'users', strict: false, autoIndex: false, autoCreate: false },
);

export function makeGratisUserModel(conn = mongoose.connection) {
  return conn.models.GratisUser || conn.model('GratisUser', gratisUserSchema, 'users');
}

export default makeGratisUserModel;
