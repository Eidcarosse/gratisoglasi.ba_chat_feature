/**
 * Layer: Repository (devices — Mongo impl).
 * The only place the `devices` collection is read/written. Push tokens are keyed by `token`
 * (unique index), so registering a token re-assigns it to whoever last logged in on that device.
 * Reads/writes only — no business logic.
 */
import { DeviceModel } from './device.model.js';

export class DeviceRepository {
  /**
   * Upsert a device by its (unique) token. Re-registering an existing token reassigns its userId
   * — correct: a push token belongs to whoever last authenticated on that device. Avoids the
   * 11000 the unique `token` index would otherwise raise on a plain insert.
   */
  async upsert({ userId, token, platform }) {
    return DeviceModel.findOneAndUpdate(
      { token },
      {
        $set: { userId, platform, lastSeenAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    ).lean();
  }

  /** Remove a device on logout. Scoped by userId so a caller can't deregister another's token. */
  async removeByToken(userId, token) {
    return DeviceModel.deleteOne({ token, userId });
  }

  /** All devices for a user (token + platform only) — the push fan-out target. */
  async findByUserId(userId) {
    return DeviceModel.find({ userId }).select('platform token').lean();
  }

  /** Dead-token cleanup after Expo reports DeviceNotRegistered / invalid tokens. */
  async deleteByTokens(tokens) {
    if (!tokens?.length) return { deletedCount: 0 };
    return DeviceModel.deleteMany({ token: { $in: tokens } });
  }
}

export default DeviceRepository;
