/**
 * Layer: Service — the notify() seam + device registration.
 * notify(event) is the single entry point for out-of-band delivery (a message to a non-muted
 * recipient). It looks up the recipient's devices and sends via the push provider
 * (Expo), pruning any tokens Expo rejects. It MUST NEVER throw — it runs inside messageService's
 * send side-effect, so a failure here must not fail the message send/ack.
 * Also owns device register/unregister (delegating to the device repository).
 */
import { logger } from '../../common/logger.js';
import { AppError } from '../../common/errors/AppError.js';
import { ExpoPushProvider } from './push.provider.js';
import { pushSent, pushFailed, pushNoDevice } from '../../common/metrics.js';

const MAX_BODY = 120;
const DEFAULT_ANDROID_CHANNEL_ID = 'default';
// High-priority Android pushes still need a non-zero TTL so FCM can wake doze-mode devices.
const ANDROID_TTL_SEC = 3600;

// Delay before a best-effort receipt check. Receipts confirm FCM/APNs actually delivered (vs. the
// ticket, which only confirms Expo accepted). ~20s is enough for most; a durable delayed job
// (survives restart) belongs in a future jobs/ module — this in-process timer is best-effort only.
const RECEIPT_CHECK_DELAY_MS = 20_000;

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
   * @param {{ deviceRepository: import('./device.repository.js').DeviceRepository,
   *           pushProvider: { send: Function },
   *           androidChannelId?: string }} deps
   */
  constructor({ deviceRepository, pushProvider, androidChannelId = DEFAULT_ANDROID_CHANNEL_ID }) {
    this.devices = deviceRepository;
    this.push = pushProvider;
    this.androidChannelId = androidChannelId;
  }

  /**
   * @param {{ type: string, userId: string, conversationId?: string, message?: object,
   *           senderName?: string, itemTitle?: string }} event
   */
  async notify(event) {
    try {
      const devices = await this.devices.findByUserId(event.userId);
      if (!devices.length) {
        pushNoDevice.inc();
        logger.info({ userId: event.userId }, 'push skipped: recipient has no registered device');
        return { delivered: false, deviceCount: 0 };
      }

      const title = event.senderName || 'New message';
      const body = preview(event.message);
      // Expo requires every data value to be a string — non-strings can silently fail on Android.
      const data = {
        type: String(event.type ?? ''),
        conversationId: String(event.conversationId ?? ''),
        ...(event.message?._id ? { messageId: String(event.message._id) } : {}),
        ...(event.itemTitle ? { itemTitle: String(event.itemTitle) } : {}),
      };
      // priority:'high' → FCM high priority / APNs priority 10, so backgrounded/doze-mode Android
      // devices (esp. battery-optimizing OEMs) actually wake and display it. channelId + ttl target
      // the client's high-importance Android channel and give FCM time to wake sleeping devices.
      const messages = devices.map((d) => {
        const base = {
          to: d.token,
          title,
          body,
          data,
          sound: 'default',
          priority: 'high',
        };
        if (d.platform === 'android') {
          return {
            ...base,
            channelId: this.androidChannelId,
            ttl: ANDROID_TTL_SEC,
          };
        }
        return base;
      });

      const {
        tickets = [],
        receiptIdTokens = {},
        unregisteredTokens = [],
        unsupportedTokens = [],
        errorCount = 0,
      } = await this.push.send(messages);
      // Prune ONLY tokens Expo confirmed as DeviceNotRegistered — never format-unsupported ones
      // (those are a client config issue, not a dead device; deleting them hid the real problem).
      if (unregisteredTokens.length) await this.devices.deleteByTokens(unregisteredTokens);

      // Best-effort delivery check: a ticket 'ok' only means Expo accepted the push; the receipt is
      // where FCM/APNs credential failures + rate limits surface (the "sent ok but never arrives"
      // case). Fire-and-forget on an unref'd timer so it never blocks the message ack or crashes the
      // process. Lost on restart — good enough for diagnostics; move to a durable job when needed.
      this.scheduleReceiptCheck(receiptIdTokens);

      const okCount = tickets.filter((t) => t.status === 'ok').length;
      pushSent.inc(okCount);
      if (errorCount) pushFailed.inc(errorCount);
      logger.info(
        {
          userId: event.userId,
          deviceCount: devices.length,
          sent: okCount,
          errors: errorCount,
          unregistered: unregisteredTokens.length,
          unsupported: unsupportedTokens.length,
        },
        'push dispatched',
      );

      return { delivered: okCount > 0, deviceCount: devices.length, sent: okCount };
    } catch (err) {
      pushFailed.inc();
      logger.error({ err, userId: event?.userId }, 'notification send failed');
      return { delivered: false, error: true };
    }
  }

  /**
   * Best-effort, fire-and-forget delivery-receipt check. Waits RECEIPT_CHECK_DELAY_MS, then asks
   * Expo for the receipts of the accepted tickets. Logs any receipt error (the real reason a push
   * silently failed) and prunes tokens reported DeviceNotRegistered. Never throws and never blocks:
   * the timer is unref'd so it can't hold the process open, and the provider swallows its own errors.
   * @param {Record<string, string>} receiptIdTokens  ticket id → token
   */
  scheduleReceiptCheck(receiptIdTokens) {
    const ids = Object.keys(receiptIdTokens || {});
    if (!ids.length || typeof this.push.getReceipts !== 'function') return;
    const timer = setTimeout(async () => {
      try {
        const { receipts, errorCount } = await this.push.getReceipts(ids);
        const dead = [];
        for (const [id, receipt] of Object.entries(receipts)) {
          if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
            const token = receiptIdTokens[id];
            if (token) dead.push(token);
          }
        }
        if (dead.length) await this.devices.deleteByTokens(dead);
        if (errorCount || dead.length) {
          logger.warn({ errorCount, pruned: dead.length }, 'push receipt check found delivery errors');
        }
      } catch (err) {
        logger.error({ err }, 'push receipt check failed');
      }
    }, RECEIPT_CHECK_DELAY_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /**
   * Register/refresh a push token for a user (called by the device routes). Rejects a token that
   * isn't a valid Expo push token so a misconfigured client fails LOUDLY at registration instead of
   * the server silently never delivering (Expo can only push to `ExponentPushToken[...]` values).
   */
  async registerDevice(userId, { token, platform }) {
    if (!ExpoPushProvider.isValidToken(token)) {
      throw AppError.validation('Not a valid Expo push token (expected ExponentPushToken[...])');
    }
    return this.devices.upsert({ userId, token, platform });
  }

  /** Remove a push token on logout. */
  async unregisterDevice(userId, token) {
    return this.devices.removeByToken(userId, token);
  }
}

export default NotificationService;
