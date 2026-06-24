/**
 * Layer: Service — the notify() seam.
 * notify(event) is the single entry point for out-of-band delivery (e.g. a message to an offline
 * recipient). At MVP it runs INLINE and is mostly a log/no-op. LATER (doc §10): move the body
 * onto a queue + worker (jobs/) and fan out to push providers via push.provider.js — callers
 * (messageService) never change. Looks up recipient devices via the device model.
 */
import { DeviceModel } from './device.model.js';
import { logger } from '../../common/logger.js';

export class NotificationService {
  /**
   * @param {{ type: string, userId: string, conversationId?: string, message?: object }} event
   */
  async notify(event) {
    // MVP: just record intent. The devices lookup proves the seam; push send lands later.
    const devices = await DeviceModel.find({ userId: event.userId })
      .select('platform token')
      .lean();
    logger.info(
      {
        type: event.type,
        userId: event.userId,
        conversationId: event.conversationId,
        deviceCount: devices.length,
      },
      'notification queued (inline no-op at MVP)',
    );
    // LATER: enqueue → push.provider.send(devices, payload)
    return { delivered: false, deviceCount: devices.length };
  }
}

export default NotificationService;
