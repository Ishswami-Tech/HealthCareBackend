/// <reference types="jest" />
/**
 * Billing HTTP-cache keys: a query value that is an array or an object (`?status=a&status=b`,
 * `?filter[x]=1`) used to map to `none`, the key of the UNFILTERED request, so a filtered
 * response could be replayed to every same-role, same-clinic caller asking for the full list.
 */

import { createHash } from 'node:crypto';
import { buildBillingScopedCacheKey } from '@services/billing/billing-cache-key.util';

type RequestShape = Parameters<typeof buildBillingScopedCacheKey>[1];

function request(query: Record<string, unknown>): NonNullable<RequestShape> {
  return {
    params: {},
    query,
    user: { sub: 'user-a', role: 'CLINIC_ADMIN' },
    clinicContext: { clinicId: 'clinic-1' },
  };
}

const key = (query: Record<string, unknown>): string =>
  buildBillingScopedCacheKey('billing:payments:clinic', request(query), 'getClinicPayments', {
    queryKeys: ['status'],
  });

describe('buildBillingScopedCacheKey with non-scalar query values', () => {
  it('does not give a repeated parameter the key of the unfiltered request', () => {
    expect(key({ status: ['PAID', 'FAILED'] })).not.toBe(key({}));
    expect(key({ status: ['PAID', 'FAILED'] })).not.toContain('status=none');
  });

  it('gives different arrays different keys and the same array the same key', () => {
    expect(key({ status: ['PAID', 'FAILED'] })).not.toBe(key({ status: ['PAID'] }));
    expect(key({ status: ['PAID', 'FAILED'] })).not.toBe(key({ status: ['FAILED', 'PAID'] }));
    expect(key({ status: ['PAID', 'FAILED'] })).toBe(key({ status: ['PAID', 'FAILED'] }));
  });

  it('does not let an array alias the scalar it contains', () => {
    expect(key({ status: ['PAID'] })).not.toBe(key({ status: 'PAID' }));
  });

  it('hashes objects, independent of property order', () => {
    const first = key({ status: { in: ['PAID'], not: 'FAILED' } });
    const reordered = key({ status: { not: 'FAILED', in: ['PAID'] } });

    expect(first).not.toBe(key({}));
    expect(first).toBe(reordered);
    expect(first).not.toBe(key({ status: { in: ['FAILED'], not: 'PAID' } }));
  });

  it('keeps the key segment free of the raw value, so it cannot inject segments', () => {
    const injected = key({ status: ['a:b', 'c&d=e'] });

    expect(injected).toMatch(/query=status=list-[0-9a-f]{32}:/);
    expect(injected).not.toContain('a:b');
  });

  it('keeps the existing behaviour for absent, empty and scalar values', () => {
    expect(key({})).toContain('query=status=none');
    expect(key({ status: '' })).toContain('query=status=none');
    expect(key({ status: 'PAID' })).toContain('query=status=PAID');
    expect(key({ status: 5 })).toContain('query=status=5');
    expect(key({ status: true })).toContain('query=status=true');
  });
});

describe('buildBillingScopedCacheKey exact key format (pinned)', () => {
  const digest = (json: string): string =>
    createHash('sha256').update(json).digest('hex').slice(0, 32);

  it('keeps the byte-exact key layout for scalar and absent values', () => {
    expect(key({ status: 'PAID' })).toBe(
      'billing:payments:clinic:clinic=clinic-1:role=CLINIC_ADMIN:caller=*:params=:query=status=PAID:getClinicPayments'
    );
    expect(key({})).toBe(
      'billing:payments:clinic:clinic=clinic-1:role=CLINIC_ADMIN:caller=*:params=:query=status=none:getClinicPayments'
    );
  });

  it('hashes arrays in order and objects with sorted keys', () => {
    expect(key({ status: ['PAID', 'FAILED'] })).toContain(
      `query=status=list-${digest('["PAID","FAILED"]')}:`
    );
    expect(key({ status: { not: 'PAID', in: [{ b: 1, a: 2 }] } })).toContain(
      `query=status=obj-${digest('{"in":[{"a":2,"b":1}],"not":"PAID"}')}:`
    );
  });
});
