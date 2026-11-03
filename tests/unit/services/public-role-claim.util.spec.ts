import { describe, expect, it } from '@jest/globals';
import { unverifiedRoleClaim } from '../../../src/libs/core/interceptors/public-role-claim.util';
import {
  isBillingBlindRole,
  stripBillingFields,
} from '../../../src/libs/core/interceptors/billing-redaction.util';

function token(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

describe('unverifiedRoleClaim (B20)', () => {
  it('reads the role of a bearer token or the access_token cookie', () => {
    expect(
      unverifiedRoleClaim({ headers: { authorization: `Bearer ${token({ role: 'doctor' })}` } })
    ).toBe('DOCTOR');
    expect(
      unverifiedRoleClaim({ headers: {}, cookies: { access_token: token({ role: 'PATIENT' }) } })
    ).toBe('PATIENT');
  });

  it('is undefined for anonymous or malformed credentials', () => {
    expect(unverifiedRoleClaim(undefined)).toBeUndefined();
    expect(unverifiedRoleClaim({ headers: {} })).toBeUndefined();
    expect(unverifiedRoleClaim({ headers: { authorization: 'Bearer not-a-jwt' } })).toBeUndefined();
    expect(unverifiedRoleClaim({ headers: { authorization: 'Bearer a.%%%.c' } })).toBeUndefined();
  });

  it('strips the video consultation fee of the catalog for the doctor roles only', () => {
    const catalog = {
      data: { services: [{ id: 'VIDEO', label: 'Video', videoConsultationFee: 500 }] },
    };
    for (const role of ['DOCTOR', 'ASSISTANT_DOCTOR']) {
      const claim = unverifiedRoleClaim({
        headers: { authorization: `Bearer ${token({ role })}` },
      });
      expect(isBillingBlindRole(claim)).toBe(true);
      expect(stripBillingFields(catalog).data.services[0]).toEqual({ id: 'VIDEO', label: 'Video' });
    }
    expect(isBillingBlindRole(unverifiedRoleClaim({ headers: {} }))).toBe(false);
    expect(
      isBillingBlindRole(
        unverifiedRoleClaim({ headers: { authorization: `Bearer ${token({ role: 'PATIENT' })}` } })
      )
    ).toBe(false);
  });
});
