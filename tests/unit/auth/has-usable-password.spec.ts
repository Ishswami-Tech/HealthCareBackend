import { describe, expect, it } from '@jest/globals';
import { hasUsablePassword } from '@services/auth/core/has-password.util';

const HASH = '$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234';

describe('hasUsablePassword', () => {
  it('is false without a stored hash', () => {
    expect(hasUsablePassword({ password: null, role: 'PATIENT' })).toBe(false);
    expect(hasUsablePassword({ password: '', role: 'DOCTOR' })).toBe(false);
  });

  it('hides the random hash of a desk-registered / Google patient (never chosen)', () => {
    expect(hasUsablePassword({ password: HASH, passwordChangedAt: null, role: 'PATIENT' })).toBe(
      false
    );
    expect(hasUsablePassword({ password: HASH, role: 'patient' })).toBe(false);
  });

  it('counts a patient password once the holder set it', () => {
    expect(
      hasUsablePassword({ password: HASH, passwordChangedAt: new Date(), role: 'PATIENT' })
    ).toBe(true);
  });

  it('keeps the stored-hash rule for staff', () => {
    expect(
      hasUsablePassword({ password: HASH, passwordChangedAt: null, role: 'RECEPTIONIST' })
    ).toBe(true);
  });
});
