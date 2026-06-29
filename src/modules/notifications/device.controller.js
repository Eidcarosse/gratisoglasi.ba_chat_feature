/**
 * Layer: Transport (REST controller).
 * Device-token endpoints (register on login / app start; unregister on logout): identity comes
 * from req.userId only. Must NOT hold business logic or touch the DB.
 */
import { asyncHandler } from '../../common/errors/asyncHandler.js';

export function createDeviceController({ notificationService }) {
  return {
    // POST /devices { token, platform } — register/refresh this device's push token.
    register: asyncHandler(async (req, res) => {
      await notificationService.registerDevice(req.userId, {
        token: req.body.token,
        platform: req.body.platform,
      });
      res.status(201).json({ ok: true });
    }),

    // DELETE /devices { token } — drop this device's push token (logout).
    unregister: asyncHandler(async (req, res) => {
      await notificationService.unregisterDevice(req.userId, req.body.token);
      res.json({ ok: true });
    }),
  };
}

export default createDeviceController;
