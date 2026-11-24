/// <reference types="jest" />
/**
 * FCM failure handling (production, 2026-11-24):
 * - the API's FIREBASE_PRIVATE_KEY was unusable, so every push failed with OpenSSL's
 *   "DECODER routines::unsupported", found only at send time;
 * - a dead token ("NotRegistered") was not recognised, so it was never deactivated;
 * - every FCM failure went on to the SNS backup, which production does not configure, and logged
 *   "Both FCM and SNS failed".
 */
jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class {} }));
jest.mock('@communication/channels/push/sns-backup.service', () => ({
  SNSBackupService: class {},
}));
jest.mock('@communication/channels/push/device-token.service', () => ({
  DeviceTokenService: class {},
}));

import { generateKeyPairSync } from 'crypto';
import { PushNotificationService } from '@communication/channels/push/push.service';
import type { ConfigService } from '@config/config.service';
import type { LoggingService } from '@infrastructure/logging/logging.service';
import type { SNSBackupService } from '@communication/channels/push/sns-backup.service';
import type { DeviceTokenService } from '@communication/channels/push/device-token.service';

const FCM_TOKEN = 'fcm-token-'.padEnd(150, 'x');
const NOTIFICATION = { title: 'Reminder', body: 'Your appointment is soon' };

interface Harness {
  readonly service: PushNotificationService;
  readonly log: jest.Mock;
  readonly deactivate: jest.Mock;
  readonly snsSend: jest.Mock;
  readonly sendFcm: jest.Mock;
}

function harness(options: { privateKey?: string; snsHealthy?: boolean } = {}): Harness {
  const env: Record<string, string | undefined> = {
    FIREBASE_PROJECT_ID: 'demo-project',
    FIREBASE_CLIENT_EMAIL: 'push@demo-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: options.privateKey,
  };
  const config = { getEnv: (key: string): string | undefined => env[key] };
  const log = jest.fn(async () => undefined);
  const deactivate = jest.fn(async () => undefined);
  const snsSend = jest.fn(async () => ({ success: true, messageId: 'sns-1' }));
  const service = new PushNotificationService(
    config as unknown as ConfigService,
    { log } as unknown as LoggingService,
    {
      isHealthy: () => options.snsHealthy ?? false,
      sendPushNotification: snsSend,
    } as unknown as SNSBackupService,
    {
      deactivateDeviceToken: deactivate,
      findToken: jest.fn(async () => null),
    } as unknown as DeviceTokenService
  );
  service.onModuleInit();
  const sendFcm = jest.fn();
  const internals = service as unknown as {
    firebaseClient: { sendFcmMessage: jest.Mock } | null;
  };
  if (internals.firebaseClient) {
    internals.firebaseClient = { sendFcmMessage: sendFcm };
  }
  return { service, log, deactivate, snsSend, sendFcm };
}

const VALID_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .replace(/\n/g, '\\n');

function messages(log: jest.Mock, level?: string): string[] {
  return log.mock.calls
    .filter(call => level === undefined || call[1] === level)
    .map(call => String(call[2]));
}

describe('PushNotificationService FCM failures', () => {
  it('reports an unusable FIREBASE_PRIVATE_KEY once at startup and disables FCM', () => {
    const { service, log } = harness({ privateKey: '***' });

    expect(service.isHealthy()).toBe(false);
    const errors = messages(log, 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/FIREBASE_PRIVATE_KEY is set but unusable/);
    expect(errors[0]).not.toContain('***');
  });

  it('starts FCM with an escaped key, as .env files store it', () => {
    const { service, log } = harness({ privateKey: VALID_KEY });

    expect(service.isHealthy()).toBe(true);
    expect(messages(log, 'ERROR')).toEqual([]);
  });

  it('retires a token FCM calls NotRegistered, without an SNS attempt or an error', async () => {
    const { service, log, deactivate, snsSend, sendFcm } = harness({
      privateKey: VALID_KEY,
      snsHealthy: true,
    });
    sendFcm.mockImplementation(async () => {
      throw new Error('NotRegistered');
    });

    const result = await service.sendToDevice(FCM_TOKEN, NOTIFICATION, 'user-1');

    expect(result).toMatchObject({ success: false, tokenUnregistered: true, usedFallback: false });
    expect(deactivate).toHaveBeenCalledWith(FCM_TOKEN, 'user-1');
    expect(snsSend).not.toHaveBeenCalled();
    expect(messages(log, 'ERROR')).toEqual([]);
  });

  it('does not claim an SNS attempt when SNS is not configured', async () => {
    const { service, log, snsSend, sendFcm } = harness({ privateKey: VALID_KEY });
    sendFcm.mockImplementation(async () => {
      throw new Error('Firebase request failed with status 503');
    });

    const result = await service.sendToDevice(FCM_TOKEN, NOTIFICATION, 'user-1');

    expect(result).toMatchObject({ success: false, provider: 'fcm', usedFallback: false });
    expect(snsSend).not.toHaveBeenCalled();
    const all = messages(log);
    expect(all).toContain('Failed to send push notification via FCM');
    expect(all.some(text => /SNS/.test(text))).toBe(false);
  });

  it('still falls back to SNS when it is configured', async () => {
    const { service, snsSend, sendFcm } = harness({ privateKey: VALID_KEY, snsHealthy: true });
    sendFcm.mockImplementation(async () => {
      throw new Error('Firebase request failed with status 503');
    });

    const result = await service.sendToDevice(FCM_TOKEN, NOTIFICATION, 'user-1');

    expect(snsSend).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, provider: 'sns', usedFallback: true });
  });
});
