import { describe, expect, it } from '@jest/globals';
import {
  NO_REGISTERED_DEVICE,
  isNoDeviceResult,
  resolvePushTargets,
  summarizePushResults,
} from '../../../src/libs/communication/channels/push/push-targets.util';

describe('resolvePushTargets', () => {
  it('keeps only active tokens, trimmed, without repeats or blanks', () => {
    expect(
      resolvePushTargets([
        { token: 'fcm-a', isActive: true },
        { token: ' fcm-a ', isActive: true },
        { token: 'fcm-old', isActive: false },
        { token: '  ', isActive: true },
        { token: 'ExponentPushToken[x]', isActive: true },
      ])
    ).toEqual(['fcm-a', 'ExponentPushToken[x]']);
  });

  it('returns nothing for a user with no devices', () => {
    expect(resolvePushTargets([])).toEqual([]);
  });
});

describe('summarizePushResults', () => {
  it('reports no registered device when there was nothing to send to', () => {
    const result = summarizePushResults([]);
    expect(result).toMatchObject({ success: false, error: NO_REGISTERED_DEVICE });
    expect(isNoDeviceResult(result)).toBe(true);
  });

  it('is delivered when any device accepted it', () => {
    const result = summarizePushResults([
      { success: false, error: 'UNREGISTERED', provider: 'sns', usedFallback: true },
      { success: true, messageId: 'projects/p/messages/1', provider: 'fcm' },
    ]);
    expect(result).toMatchObject({
      success: true,
      successCount: 1,
      failureCount: 1,
      messageId: 'projects/p/messages/1',
      provider: 'sns,fcm',
      usedFallback: true,
    });
    expect(result.error).toBeUndefined();
    expect(isNoDeviceResult(result)).toBe(false);
  });

  it('is a failure (not a skip) when every device failed', () => {
    const result = summarizePushResults([{ success: false, error: 'FCM service not initialized' }]);
    expect(result).toMatchObject({
      success: false,
      error: 'FCM service not initialized',
      failureCount: 1,
    });
    expect(isNoDeviceResult(result)).toBe(false);
  });
});
