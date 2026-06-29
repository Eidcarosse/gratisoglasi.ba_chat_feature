/**
 * Layer: Service — the notify() seam + device registration.
 * notify(event) is the single entry point for out-of-band delivery (a message to an offline,
 * non-muted recipient). It looks up the recipient's devices and sends via the push provider
 * (Expo), pruning any tokens Expo rejects. It MUST NEVER throw — it runs inside messageService's
 * send side-effect, so a failure here must not fail the message send/ack.
 * Also owns device register/unregister (delegating to the device repository).
 */
import { logger } from '../../common/logger.js';

const MAX_BODY = 120;

function preview(message) {
  if (!message) return 'New message';
  if (message.type === 'text') {
    const b = (message.body || '').trim();
    if (!b) return 'New message';
    return b.length > MAX_BODY ? `${b.slice(0, MAX_BODY - 1)}…` : b;
  }
  if (message.type === 'image') return '📷 Photo';
  if (message.type === 'file') return '📎 File';
  return 'New message';
}

export class NotificationService {
  /**
   * @param {{ deviceRepository: import('./device.repository.js').DeviceRepository, pushProvider: { send: Function } }} deps
   */
  constructor({ deviceRepository, pushProvider }) {
    this.devices = deviceRepository;
    this.push = pushProvider;
  }

  /**
   * @param {{ type: string, userId: string, conversationId?: string, message?: object,
   *           senderName?: string, itemTitle?: string }} event
   */
  async notify(event) {
    try {
      const devices = await this.devices.findByUserId(event.userId);
      if (!devices.length) return { delivered: false, deviceCount: 0 };

      const title = event.senderName || 'New message';
      const body = preview(event.message);
      const data = {
        type: event.type,
        conversationId: String(event.conversationId ?? ''),
        ...(event.message?._id ? { messageId: String(event.message._id) } : {}),
        ...(event.itemTitle ? { itemTitle: event.itemTitle } : {}),
      };
      const messages = devices.map((d) => ({ to: d.token, title, body, data, sound: 'default' }));

      const { tickets, invalidTokens } = await this.push.send(messages);
      if (invalidTokens.length) await this.devices.deleteByTokens(invalidTokens);

      return { delivered: true, deviceCount: devices.length, ticketCount: tickets.length };
    } catch (err) {
      logger.warn({ err, userId: event?.userId }, 'notification send failed (swallowed)');
      return { delivered: false, error: true };
    }
  }

  /** Register/refresh a push token for a user (called by the device routes). */
  async registerDevice(userId, { token, platform }) {
    return this.devices.upsert({ userId, token, platform });
  }

  /** Remove a push token on logout. */
  async unregisterDevice(userId, token) {
    return this.devices.removeByToken(userId, token);
  }
}

export default NotificationService;
