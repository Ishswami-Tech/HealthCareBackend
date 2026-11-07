/**
 * Unit tests for ReviewLoginService (app store reviewer login controlled by a super admin)
 */

import {
  REVIEW_LOGIN_SETTING_KEY,
  ReviewLoginService,
} from '@services/auth/core/review-login.service';
import type { DatabaseService } from '@infrastructure/database/database.service';
import type { CredentialEncryptionService } from '@communication/config/credential-encryption.service';
import type { ConfigService } from '@config/config.service';
import type { LoggingService } from '@infrastructure/logging/logging.service';

jest.mock('@infrastructure/database/database.service');
jest.mock('@communication/config/credential-encryption.service');
jest.mock('@infrastructure/logging/logging.service');
jest.mock('@config/config.service');

const DAY_MS = 24 * 60 * 60 * 1000;

function createHarness() {
  let row: string | null = null;
  const database = {
    executeRawQuery: jest.fn(async (sql: string, params: Array<string>) => {
      if (sql.includes('SELECT')) return row === null ? [] : [{ settingValue: row }];
      if (sql.includes('INSERT')) {
        expect(params[0]).toBe(REVIEW_LOGIN_SETTING_KEY);
        row = params[1] ?? null;
        return [];
      }
      if (sql.includes('DELETE')) {
        row = null;
        return [];
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  const encryption = {
    encrypt: jest.fn(async (plain: string) => `enc(${plain.split('').reverse().join('')})`),
    decrypt: jest.fn(async (data: string) =>
      data
        .replace(/^enc\(|\)$/g, '')
        .split('')
        .reverse()
        .join('')
    ),
  };
  const config = { getEnvNumber: jest.fn((_key: string, fallback: number) => fallback) };
  const logging = { log: jest.fn() };

  const service = new ReviewLoginService(
    database as unknown as DatabaseService,
    encryption as unknown as CredentialEncryptionService,
    config as unknown as ConfigService,
    logging as unknown as LoggingService
  );

  return {
    service,
    database,
    encryption,
    logging,
    getRow: () => row,
    setRow: (value: string | null) => {
      row = value;
    },
  };
}

describe('ReviewLoginService', () => {
  it('is off when nothing is stored', async () => {
    const h = createHarness();

    await expect(h.service.getActive()).resolves.toBeNull();
    await expect(h.service.getStatus()).resolves.toMatchObject({ enabled: false, phone: null });
  });

  it('enables for a normalised number, returns a fresh code once and stores it encrypted', async () => {
    const h = createHarness();

    const issued = await h.service.enable('90000 00001', 14, 'admin-1');

    expect(issued.otp).toMatch(/^\d{6}$/);
    expect(issued.status).toMatchObject({
      enabled: true,
      phone: '+919000000001',
      updatedBy: 'admin-1',
    });
    const expiresIn = Date.parse(issued.status.expiresAt as string) - Date.now();
    expect(expiresIn).toBeGreaterThan(14 * DAY_MS - 60_000);
    expect(expiresIn).toBeLessThanOrEqual(14 * DAY_MS);
    expect(h.getRow()).not.toContain(issued.otp);
    expect(h.getRow()).not.toBeNull();
    await expect(h.service.getActive()).resolves.toEqual({
      phone: '+919000000001',
      otp: issued.otp,
    });
  });

  it('never returns the code from the status endpoint', async () => {
    const h = createHarness();
    const issued = await h.service.enable('+919000000001', 7, 'admin-1');

    const status = await h.service.getStatus();

    expect(JSON.stringify(status)).not.toContain(issued.otp);
    expect(status).not.toHaveProperty('otp');
  });

  it.each(['123', 'not-a-phone', 'a@example.com', ''])('rejects the number %p', async phone => {
    const h = createHarness();

    await expect(h.service.enable(phone, 14, 'admin-1')).rejects.toThrow(
      'Enter a valid phone number'
    );
    expect(h.getRow()).toBeNull();
  });

  it('rejects a duration outside 7, 14 or 30 days', async () => {
    const h = createHarness();

    await expect(h.service.enable('+919000000001', 90 as never, 'admin-1')).rejects.toThrow(
      'Duration must be one of 7, 14, 30 days'
    );
    expect(h.getRow()).toBeNull();
  });

  it('regenerates a code for the same number and expiry, replacing the old one', async () => {
    const h = createHarness();
    const first = await h.service.enable('+919000000001', 30, 'admin-1');
    h.encryption.encrypt.mockClear();

    const second = await h.service.regenerate('admin-2');

    expect(h.encryption.encrypt).toHaveBeenCalledWith(second.otp);
    expect(second.status.phone).toBe('+919000000001');
    expect(second.status.expiresAt).toBe(first.status.expiresAt);
    expect(second.status.updatedBy).toBe('admin-2');
    await expect(h.service.getActive()).resolves.toEqual({
      phone: '+919000000001',
      otp: second.otp,
    });
  });

  it('refuses to regenerate while off', async () => {
    const h = createHarness();

    await expect(h.service.regenerate('admin-1')).rejects.toThrow('Review login is off');
  });

  it('switches itself off after the expiry', async () => {
    const h = createHarness();
    h.setRow(
      JSON.stringify({
        phone: '+919000000001',
        otpEncrypted: 'enc(519284)',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        updatedBy: 'admin-1',
        updatedAt: new Date().toISOString(),
      })
    );

    await expect(h.service.getActive()).resolves.toBeNull();
    await expect(h.service.getStatus()).resolves.toMatchObject({ enabled: false });
    await expect(h.service.regenerate('admin-1')).rejects.toThrow('Review login is off');
  });

  it('disables at once', async () => {
    const h = createHarness();
    await h.service.enable('+919000000001', 14, 'admin-1');

    await expect(h.service.disable('admin-1')).resolves.toMatchObject({ enabled: false });

    expect(h.getRow()).toBeNull();
    await expect(h.service.getActive()).resolves.toBeNull();
  });

  it('treats an unreadable stored value as off', async () => {
    const h = createHarness();
    h.setRow('{not json');

    await expect(h.service.getActive()).resolves.toBeNull();
  });

  it('stays off and warns when the stored code cannot be decrypted', async () => {
    const h = createHarness();
    await h.service.enable('+919000000001', 14, 'admin-1');
    h.encryption.decrypt.mockRejectedValue(new Error('bad key'));

    await expect(h.service.getActive()).resolves.toBeNull();
    expect(JSON.stringify(h.logging.log.mock.calls)).toContain('could not be decrypted');
  });

  it('audits every change with the actor and never logs the code', async () => {
    const h = createHarness();

    const issued = await h.service.enable('+919000000001', 14, 'admin-1');
    const rotated = await h.service.regenerate('admin-1');
    await h.service.disable('admin-1');

    const logged = JSON.stringify(h.logging.log.mock.calls);
    expect(logged).toContain('Review login enabled');
    expect(logged).toContain('Review login code regenerated');
    expect(logged).toContain('Review login disabled');
    expect(logged).toContain('admin-1');
    expect(logged).not.toContain(issued.otp);
    expect(logged).not.toContain(rotated.otp);
  });
});
