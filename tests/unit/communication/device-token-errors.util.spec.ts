import { describe, expect, it } from '@jest/globals';
import {
  isUnknownUserForeignKeyError,
  isUnregisteredFcmTokenError,
} from '@communication/channels/push/device-token-errors.util';

describe('isUnknownUserForeignKeyError', () => {
  it('matches the Prisma FK error on device_tokens.userId', () => {
    expect(
      isUnknownUserForeignKeyError({
        code: 'P2003',
        message: 'Foreign key constraint violated on the constraint: `device_tokens_userId_fkey`',
      })
    ).toBe(true);
    expect(
      isUnknownUserForeignKeyError({
        code: 'P2003',
        meta: { field_name: 'device_tokens_userId_fkey (index)' },
      })
    ).toBe(true);
  });

  it('ignores other errors', () => {
    expect(
      isUnknownUserForeignKeyError({ code: 'P2002', message: 'Unique constraint failed' })
    ).toBe(false);
    expect(isUnknownUserForeignKeyError({ code: 'P2003', message: 'other_fkey' })).toBe(false);
    expect(isUnknownUserForeignKeyError(new Error('timeout'))).toBe(false);
    expect(isUnknownUserForeignKeyError(null)).toBe(false);
  });
});

describe('isUnregisteredFcmTokenError', () => {
  it('matches every shape FCM uses for a dead token', () => {
    expect(isUnregisteredFcmTokenError(new Error('NotRegistered'))).toBe(true); // production 2026-11-24
    expect(isUnregisteredFcmTokenError(new Error('Requested entity was not found.'))).toBe(true);
    expect(
      isUnregisteredFcmTokenError(
        new Error('The registration token is not a valid FCM registration token')
      )
    ).toBe(true);
    expect(
      isUnregisteredFcmTokenError(new Error('messaging/registration-token-not-registered'))
    ).toBe(true);
    const v1 = Object.assign(new Error('Some other wording'), {
      status: 404,
      payload: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
    });
    expect(isUnregisteredFcmTokenError(v1)).toBe(true);
  });

  it('does not retire a token over a credential or outage error', () => {
    expect(
      isUnregisteredFcmTokenError(new Error('error:1E08010C:DECODER routines::unsupported'))
    ).toBe(false);
    expect(isUnregisteredFcmTokenError(new Error('Firebase request failed with status 503'))).toBe(
      false
    );
    expect(isUnregisteredFcmTokenError(new Error('SenderId mismatch'))).toBe(false);
    expect(isUnregisteredFcmTokenError(null)).toBe(false);
  });
});
