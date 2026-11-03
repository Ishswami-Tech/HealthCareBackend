import { describe, expect, it } from '@jest/globals';
import {
  idempotencyCacheKey,
  parseIdempotencyKey,
  readStoredResponse,
} from '../../../src/services/billing/idempotency-key.util';

describe('Idempotency-Key helpers', () => {
  it('parses the header', () => {
    expect(parseIdempotencyKey(undefined)).toEqual({ kind: 'absent' });
    expect(parseIdempotencyKey('  ')).toEqual({ kind: 'absent' });
    expect(parseIdempotencyKey('a1b2-c3:d4_e5.f6')).toEqual({
      kind: 'valid',
      key: 'a1b2-c3:d4_e5.f6',
    });
    expect(parseIdempotencyKey(['first', 'second'])).toEqual({ kind: 'valid', key: 'first' });
    expect(parseIdempotencyKey('has space')).toEqual({ kind: 'invalid' });
    expect(parseIdempotencyKey('x'.repeat(129))).toEqual({ kind: 'invalid' });
  });

  it('scopes the stored response per user, route, resource and key (hashed)', () => {
    const base = {
      userId: 'u1',
      route: 'appointments/process-payment',
      resourceId: 'a1',
      key: 'k',
    };
    const key = idempotencyCacheKey(base);
    expect(key).toMatch(/^idem:payment-intent:[0-9a-f]{64}$/);
    expect(key).not.toContain('k|');
    expect(idempotencyCacheKey(base)).toBe(key);
    expect(idempotencyCacheKey({ ...base, userId: 'u2' })).not.toBe(key);
    expect(idempotencyCacheKey({ ...base, resourceId: 'a2' })).not.toBe(key);
    expect(idempotencyCacheKey({ ...base, route: 'invoices/process-payment' })).not.toBe(key);
  });

  it('reads a stored response back from a JSON string or an object', () => {
    expect(readStoredResponse<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(readStoredResponse<{ ok: boolean }>({ ok: true })).toEqual({ ok: true });
    expect(readStoredResponse('not json')).toBeNull();
    expect(readStoredResponse(null)).toBeNull();
  });
});
