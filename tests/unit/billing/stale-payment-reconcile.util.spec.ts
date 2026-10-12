import { describe, expect, it } from '@jest/globals';
import {
  STALE_PENDING_MAX_AGE_MS,
  STALE_PENDING_MIN_AGE_MS,
  isAwaitingPayment,
  staleWindow,
} from '../../../src/services/billing/stale-payment-reconcile.util';

describe('isAwaitingPayment', () => {
  it('accepts a booking still waiting for payment', () => {
    expect(isAwaitingPayment('PENDING')).toBe(true);
    expect(isAwaitingPayment('SCHEDULED')).toBe(true);
  });

  it('leaves expired, cancelled, confirmed and finished bookings alone', () => {
    for (const status of [
      'EXPIRED',
      'CANCELLED',
      'CONFIRMED',
      'COMPLETED',
      'IN_PROGRESS',
      'NO_SHOW',
    ]) {
      expect(isAwaitingPayment(status)).toBe(false);
    }
  });

  it('rejects anything that is not a status string', () => {
    expect(isAwaitingPayment(undefined)).toBe(false);
    expect(isAwaitingPayment(null)).toBe(false);
    expect(isAwaitingPayment(42)).toBe(false);
  });
});

describe('staleWindow', () => {
  it('spans from three minutes to one day before now', () => {
    const now = new Date('2026-10-12T10:00:00.000Z');
    const { olderThan, newerThan } = staleWindow(now);
    expect(now.getTime() - olderThan.getTime()).toBe(STALE_PENDING_MIN_AGE_MS);
    expect(now.getTime() - newerThan.getTime()).toBe(STALE_PENDING_MAX_AGE_MS);
    expect(newerThan.getTime()).toBeLessThan(olderThan.getTime());
  });
});
