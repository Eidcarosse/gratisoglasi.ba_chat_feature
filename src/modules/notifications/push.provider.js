/**
 * Layer: Service (adapter) — Expo Push provider.
 * Sends notifications to Expo push tokens (the GratisOglasi app is Expo/React Native, and the
 * main site already pushes via Expo). Keeps the Expo SDK isolated here; notificationService calls
 * send() with ready-built messages. Reports back tokens Expo rejects (DeviceNotRegistered /
 * non-Expo) so the caller can prune dead devices.
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

  /**
   * @param {Array<{ to: string, title?: string, body?: string, data?: object, sound?: string }>} messages
   * @returns {Promise<{ tickets: object[], invalidTokens: string[] }>}
   */
  async send(messages) {
    const invalidTokens = [];
    const valid = [];
    for (const m of messages) {
      if (Expo.isExpoPushToken(m.to)) valid.push(m);
      else invalidTokens.push(m.to);
    }

    const tickets = [];
    const chunks = this.expo.chunkPushNotifications(valid);
    for (const chunk of chunks) {
      try {
        const receipts = await this.expo.sendPushNotificationsAsync(chunk);
        // Tickets come back in the chunk's message order.
        receipts.forEach((ticket, i) => {
          tickets.push(ticket);
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(chunk[i].to);
          }
        });
      } catch (err) {
        logger.warn({ err }, 'expo push chunk failed');
      }
    }

    return { tickets, invalidTokens };
  }
}

export default ExpoPushProvider;
