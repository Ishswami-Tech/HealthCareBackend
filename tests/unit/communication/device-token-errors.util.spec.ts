import { describe, expect, it } from '@jest/globals';
import { isUnknownUserForeignKeyError } from '@communication/channels/push/device-token-errors.util';

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
