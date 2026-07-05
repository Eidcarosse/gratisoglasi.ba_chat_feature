/**
 * Unit tests for the real ExpoPushProvider + NotificationService token handling (no app boot, no
 * DB). Previously the real provider was never exercised — every other test monkey-patches `push`.
 * These lock in the fix for "chat push not sent": format-invalid tokens are surfaced but NOT
 * deleted, only Expo's DeviceNotRegistered is pruned, and bad tokens are rejected at registration.
 */
import { describe, it, expect, vi } from 'vitest';
import { ExpoPushProvider } from '../src/modules/notifications/push.provider.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';

// Build a provider with a stubbed Expo SDK: one chunk == all messages, custom send behavior.
function providerWith(sendImpl, receiptsImpl) {
  const p = new ExpoPushProvider();
  p.expo = {
    chunkPushNotifications: (msgs) => (msgs.length ? [msgs] : []),
    sendPushNotificationsAsync: sendImpl,
    chunkPushNotificationReceiptIds: (ids) => (ids.length ? [ids] : []),
    getPushNotificationReceiptsAsync: receiptsImpl,
  };
  return p;
}
const msg = (to) => ({ to, title: 't', body: 'b', data: {}, sound: 'default' });

describe('ExpoPushProvider.isValidToken', () => {
  it('accepts Expo push tokens and rejects raw/native tokens', () => {
    expect(ExpoPushProvider.isValidToken('ExponentPushToken[abc123]')).toBe(true);
    expect(ExpoPushProvider.isValidToken('ExpoPushToken[abc123]')).toBe(true);
    expect(ExpoPushProvider.isValidToken('fcm-raw-device-token')).toBe(false);
    expect(ExpoPushProvider.isValidToken('')).toBe(false);
    expect(ExpoPushProvider.isValidToken(null)).toBe(false);
  });
});

describe('ExpoPushProvider.send', () => {
  it('sends valid tokens and returns their tickets', async () => {
    const send = vi.fn().mockResolvedValue([{ status: 'ok' }]);
    const { tickets, unregisteredTokens, unsupportedTokens, errorCount } = await providerWith(
      send,
    ).send([msg('ExponentPushToken[a]')]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(tickets).toHaveLength(1);
    expect(unregisteredTokens).toEqual([]);
    expect(unsupportedTokens).toEqual([]);
    expect(errorCount).toBe(0);
  });

  it('maps accepted ticket ids back to their token for a later receipt check', async () => {
    const send = vi.fn().mockResolvedValue([{ status: 'ok', id: 'rcpt-1' }]);
    const res = await providerWith(send).send([msg('ExponentPushToken[a]')]);
    expect(res.receiptIdTokens).toEqual({ 'rcpt-1': 'ExponentPushToken[a]' });
  });

  it('reports format-invalid tokens as unsupported and does NOT send or prune them', async () => {
    const send = vi.fn();
    const res = await providerWith(send).send([msg('not-an-expo-token')]);
    expect(send).not.toHaveBeenCalled(); // nothing valid to send
    expect(res.unsupportedTokens).toEqual(['not-an-expo-token']);
    expect(res.unregisteredTokens).toEqual([]); // NOT pruned — client config issue, not a dead device
  });

  it('flags Expo DeviceNotRegistered tokens for pruning and counts the error', async () => {
    const send = vi
      .fn()
      .mockResolvedValue([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);
    const res = await providerWith(send).send([msg('ExponentPushToken[dead]')]);
    expect(res.unregisteredTokens).toEqual(['ExponentPushToken[dead]']);
    expect(res.errorCount).toBe(1);
  });

  it('swallows a send failure (best-effort) without throwing', async () => {
    const send = vi.fn().mockRejectedValue(new Error('expo down'));
    const res = await providerWith(send).send([msg('ExponentPushToken[a]')]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.tickets).toEqual([]);
    expect(res.errorCount).toBe(1);
    expect(res.unregisteredTokens).toEqual([]);
  });
});

describe('ExpoPushProvider.getReceipts', () => {
  it('returns receipts keyed by id and counts errors', async () => {
    const receipts = vi.fn().mockResolvedValue({
      'r-ok': { status: 'ok' },
      'r-bad': { status: 'error', details: { error: 'DeviceNotRegistered' }, message: 'gone' },
    });
    const res = await providerWith(vi.fn(), receipts).getReceipts(['r-ok', 'r-bad']);
    expect(res.receipts['r-ok'].status).toBe('ok');
    expect(res.receipts['r-bad'].details.error).toBe('DeviceNotRegistered');
    expect(res.errorCount).toBe(1);
  });

  it('is a no-op for an empty id list (no SDK call)', async () => {
    const receipts = vi.fn();
    const res = await providerWith(vi.fn(), receipts).getReceipts([]);
    expect(receipts).not.toHaveBeenCalled();
    expect(res).toEqual({ receipts: {}, errorCount: 0 });
  });

  it('swallows a receipt-fetch failure without throwing', async () => {
    const receipts = vi.fn().mockRejectedValue(new Error('expo down'));
    const res = await providerWith(vi.fn(), receipts).getReceipts(['r-1']);
    expect(res).toEqual({ receipts: {}, errorCount: 0 });
  });
});

describe('NotificationService token handling', () => {
  const svcWith = (push, upsert = vi.fn(), deleteByTokens = vi.fn()) =>
    new NotificationService({
      deviceRepository: { upsert, deleteByTokens, findByUserId: vi.fn() },
      pushProvider: push,
    });

  it('rejects a non-Expo token at registration (fail fast, 400)', async () => {
    const upsert = vi.fn();
    const svc = svcWith({}, upsert);
    await expect(
      svc.registerDevice('u1', { token: 'fcm-raw', platform: 'android' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accepts a valid Expo token at registration', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const svc = svcWith({}, upsert);
    await svc.registerDevice('u1', { token: 'ExponentPushToken[ok]', platform: 'ios' });
    expect(upsert).toHaveBeenCalledWith({
      userId: 'u1',
      token: 'ExponentPushToken[ok]',
      platform: 'ios',
    });
  });

  it('notify prunes ONLY DeviceNotRegistered tokens, never format-unsupported ones', async () => {
    const deleteByTokens = vi.fn().mockResolvedValue({ deletedCount: 1 });
    const push = {
      send: async () => ({
        tickets: [{ status: 'ok' }],
        unregisteredTokens: ['ExponentPushToken[dead]'],
        unsupportedTokens: ['raw-token'],
        errorCount: 1,
      }),
    };
    const svc = svcWith(push, vi.fn(), deleteByTokens);
    svc.devices.findByUserId = vi
      .fn()
      .mockResolvedValue([{ token: 'ExponentPushToken[a]', platform: 'ios' }]);

    const res = await svc.notify({ type: 'message', userId: 'u1', message: { body: 'hi' } });
    expect(deleteByTokens).toHaveBeenCalledWith(['ExponentPushToken[dead]']); // ONLY the dead one
    expect(res.delivered).toBe(true);
  });

  it('schedules a receipt check that prunes tokens the receipt reports DeviceNotRegistered', async () => {
    vi.useFakeTimers();
    try {
      const deleteByTokens = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const push = {
        send: async () => ({
          tickets: [{ status: 'ok' }],
          receiptIdTokens: { 'r-1': 'ExponentPushToken[dead]' },
          unregisteredTokens: [],
          unsupportedTokens: [],
          errorCount: 0,
        }),
        getReceipts: async () => ({
          receipts: { 'r-1': { status: 'error', details: { error: 'DeviceNotRegistered' } } },
          errorCount: 1,
        }),
      };
      const svc = svcWith(push, vi.fn(), deleteByTokens);
      svc.devices.findByUserId = vi
        .fn()
        .mockResolvedValue([{ token: 'ExponentPushToken[dead]', platform: 'android' }]);

      await svc.notify({ type: 'message', userId: 'u1', message: { body: 'hi' } });
      await vi.runOnlyPendingTimersAsync(); // fire the deferred receipt check
      expect(deleteByTokens).toHaveBeenCalledWith(['ExponentPushToken[dead]']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notify reports no-device cleanly when the recipient has no registered device', async () => {
    const svc = svcWith({ send: vi.fn() });
    svc.devices.findByUserId = vi.fn().mockResolvedValue([]);
    const res = await svc.notify({ type: 'message', userId: 'u1', message: { body: 'hi' } });
    expect(res).toEqual({ delivered: false, deviceCount: 0 });
  });
});
