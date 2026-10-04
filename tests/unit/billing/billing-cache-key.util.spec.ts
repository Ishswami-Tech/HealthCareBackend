/// <reference types="jest" />
/**
 * Billing HTTP-cache keys must carry the requester scope. The global cache interceptor runs
 * after the guards and before the handler, so whatever it caches is replayed to the next caller
 * with the same key; the key therefore has to separate callers, roles and clinics.
 */
import {
  billingScopedCacheKey,
  buildBillingScopedCacheKey,
} from '@services/billing/billing-cache-key.util';

type RequestShape = Parameters<typeof buildBillingScopedCacheKey>[1];

function request(overrides: Partial<NonNullable<RequestShape>> = {}): NonNullable<RequestShape> {
  return {
    params: { id: 'sub-1' },
    query: {},
    user: { sub: 'user-a', role: 'PATIENT' },
    clinicContext: { clinicId: 'clinic-1' },
    ...overrides,
  };
}

describe('buildBillingScopedCacheKey', () => {
  it('separates callers when the entry is per-caller', () => {
    const a = buildBillingScopedCacheKey('billing:subscription', request(), 'getSubscription', {
      perCaller: true,
    });
    const b = buildBillingScopedCacheKey(
      'billing:subscription',
      request({ user: { sub: 'user-b', role: 'PATIENT' } }),
      'getSubscription',
      { perCaller: true }
    );
    expect(a).not.toBe(b);
  });

  it('separates clinics, so a clinic list is never shared across tenants', () => {
    const clinic1 = buildBillingScopedCacheKey('billing:invoices:clinic', request(), 'h');
    const clinic2 = buildBillingScopedCacheKey(
      'billing:invoices:clinic',
      request({ clinicContext: { clinicId: 'clinic-2' } }),
      'h'
    );
    expect(clinic1).not.toBe(clinic2);
  });

  it('separates roles that see different data from the same route', () => {
    const patient = buildBillingScopedCacheKey('billing:plans', request(), 'h');
    const admin = buildBillingScopedCacheKey(
      'billing:plans',
      request({ user: { sub: 'user-a', role: 'CLINIC_ADMIN' } }),
      'h'
    );
    expect(patient).not.toBe(admin);
  });

  it('separates route resources and the declared query filters', () => {
    const base = buildBillingScopedCacheKey('p', request(), 'h', { queryKeys: ['status'] });
    expect(
      buildBillingScopedCacheKey('p', request({ params: { id: 'sub-2' } }), 'h', {
        queryKeys: ['status'],
      })
    ).not.toBe(base);
    expect(
      buildBillingScopedCacheKey('p', request({ query: { status: 'PAID' } }), 'h', {
        queryKeys: ['status'],
      })
    ).not.toBe(base);
    // Undeclared query params do not fragment the cache.
    expect(
      buildBillingScopedCacheKey('p', request({ query: { noise: '1' } }), 'h', {
        queryKeys: ['status'],
      })
    ).toBe(base);
  });

  it('shares a clinic-wide entry between callers of the same role in the same clinic', () => {
    const a = buildBillingScopedCacheKey('p', request(), 'h');
    const b = buildBillingScopedCacheKey(
      'p',
      request({ user: { sub: 'user-b', role: 'PATIENT' } }),
      'h'
    );
    expect(a).toBe(b);
  });

  it('degrades to a stable "none" scope when there is no clinic or user', () => {
    const key = buildBillingScopedCacheKey('p', { params: {}, query: {} }, 'h');
    expect(key).toContain('clinic=none');
    expect(key).toContain('role=none');
  });
});

describe('billingScopedCacheKey', () => {
  it('builds the key from the HTTP request and handler name of an execution context', () => {
    const generator = billingScopedCacheKey('billing:subscription', { perCaller: true });
    const context = {
      switchToHttp: () => ({ getRequest: () => request() }),
      getHandler: () => ({ name: 'getSubscription' }),
    };

    const key = generator(context);

    expect(key).toContain('billing:subscription');
    expect(key).toContain('caller=user-a');
    expect(key).toContain('clinic=clinic-1');
    expect(key.endsWith(':getSubscription')).toBe(true);
  });
});
