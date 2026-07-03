/**
 * Layer: Service (adapter) — Expo Push provider.
 * Sends notifications to Expo push tokens (the GratisOglasi app is Expo/React Native, and the
 * main site already pushes via Expo). Keeps the Expo SDK isolated here; notificationService calls
 * send() with ready-built messages. Reports back tokens Expo rejects (DeviceNotRegistered) so the
 * caller can prune dead devices — and, separately, tokens that aren't valid Expo tokens at all so
 * a misconfigured client is visible WITHOUT deleting the device.
 *
 * Note: definitive DeviceNotRegistered detection technically requires polling receipts after a
 * delay; handling ticket-level errors inline is the MVP (receipt polling can move to jobs/ later).
 */
// expo-server-sdk is CJS exporting `{ Expo, default: Expo }`. Node's native ESM and Vite/vitest
// resolve the default import differently, so use a namespace import and resolve Expo defensively.
import * as ExpoNS from 'expo-server-sdk';
import { logger } from '../../common/logger.js';

const Expo = ExpoNS.Expo || ExpoNS.default?.Expo || ExpoNS.default;

export class ExpoPushProvider {
  constructor({ accessToken } = {}) {
    // Expo accepts unauthenticated sends; an access token only raises limits / enables receipts.
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  /** Is `token` a well-formed Expo push token (`ExponentPushToken[...]`)? Used to validate on register. */
  static isValidToken(token) {
    return Expo.isExpoPushToken(token);
  }

  /**
   * @param {Array<{ to: string, title?: string, body?: string, data?: object, sound?: string }>} messages
   * @returns {Promise<{ tickets: object[], unregisteredTokens: string[], unsupportedTokens: string[], errorCount: number }>}
   *   - unregisteredTokens: Expo reported DeviceNotRegistered → safe to PRUNE (the device is gone).
   *   - unsupportedTokens:  not a valid Expo push token → do NOT prune here (surfaced/blocked at
   *                         registration); logged loudly so a misconfigured client is visible.
   */
  async send(messages) {
    const unsupportedTokens = [];
    const valid = [];
    for (const m of messages) {
      if (Expo.isExpoPushToken(m.to)) valid.push(m);
      else unsupportedTokens.push(m.to);
    }
    if (unsupportedTokens.length) {
      logger.warn(
        { count: unsupportedTokens.length },
        'expo push: tokens are not valid Expo push tokens — skipped (not pruned). Client should register ExponentPushToken[...] values',
      );
    }

    const tickets = [];
    const unregisteredTokens = [];
    let errorCount = 0;
    const chunks = this.expo.chunkPushNotifications(valid);
    for (const chunk of chunks) {
      try {
        const receipts = await this.expo.sendPushNotificationsAsync(chunk);
        // Tickets come back in the chunk's message order.
        receipts.forEach((ticket, i) => {
          tickets.push(ticket);
          if (ticket.status === 'error') {
            errorCount += 1;
            const code = ticket.details?.error;
            if (code === 'DeviceNotRegistered') unregisteredTokens.push(chunk[i].to);
            // Surface EVERY ticket error (bad payload, message-too-big, rate limits, etc.) — these
            // used to be invisible, hiding the real reason a push never arrived.
            logger.warn({ code, message: ticket.message }, 'expo push ticket error');
          }
        });
      } catch (err) {
        errorCount += chunk.length;
        logger.warn({ err }, 'expo push chunk failed');
      }
    }

    return { tickets, unregisteredTokens, unsupportedTokens, errorCount };
  }
}

export default ExpoPushProvider;
