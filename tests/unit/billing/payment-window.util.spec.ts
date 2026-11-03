import { describe, expect, it } from '@jest/globals';
import {
  attemptExpiresAt,
  decideWindowVerdict,
  GATEWAY_UNREACHABLE_GRACE_MS,
  invoicePaymentExpiresAt,
  isPastPaymentWindow,
  isReadyToExpire,
  PROVIDER_EXPIRY_BUFFER_MS,
} from '../../../src/services/billing/payment-window.util';
import {
  getPaymentWindowMinutes,
  getProviderOrderExpiry,
  toIstIsoString,
} from '../../../src/config/payment-window.config';

const WINDOW_MS = 15 * 60 * 1000;
const OPENED = new Date('2026-10-21T17:00:00.000Z');

describe('payment window config', () => {
  it('defaults to 15 minutes', () => {
    expect(getPaymentWindowMinutes()).toBe(15);
  });

  it('asks the provider to close the order just after the window', () => {
    const expiry = getProviderOrderExpiry(OPENED);
    expect(expiry.getTime() - OPENED.getTime()).toBe(WINDOW_MS + PROVIDER_EXPIRY_BUFFER_MS);
  });

  it('formats the provider expiry in IST', () => {
    expect(toIstIsoString(new Date('2026-10-21T17:16:00.000Z'))).toBe('2026-10-21T22:46:00+05:30');
  });
});

describe('attemptExpiresAt', () => {
  it('uses the stamped window end, else creation time plus the window', () => {
    const stamped = '2026-10-21T17:30:00.000Z';
    expect(
      attemptExpiresAt({ createdAt: OPENED, metadata: { paymentExpiresAt: stamped } }, WINDOW_MS)
    ).toEqual(new Date(stamped));
    expect(attemptExpiresAt({ createdAt: OPENED, metadata: {} }, WINDOW_MS)).toEqual(
      new Date(OPENED.getTime() + WINDOW_MS)
    );
    expect(
      attemptExpiresAt({ createdAt: OPENED, metadata: { paymentExpiresAt: 'nope' } }, WINDOW_MS)
    ).toEqual(new Date(OPENED.getTime() + WINDOW_MS));
  });
});

describe('isPastPaymentWindow / isReadyToExpire', () => {
  const attempt = { createdAt: OPENED, metadata: {} };

  it('is payable until the window ends', () => {
    expect(
      isPastPaymentWindow(attempt, new Date(OPENED.getTime() + WINDOW_MS - 1), WINDOW_MS)
    ).toBe(false);
    expect(isPastPaymentWindow(attempt, new Date(OPENED.getTime() + WINDOW_MS), WINDOW_MS)).toBe(
      true
    );
  });

  it('is expired by the sweep only after the provider buffer too', () => {
    const windowEnd = OPENED.getTime() + WINDOW_MS;
    expect(isReadyToExpire(attempt, new Date(windowEnd + 1000), WINDOW_MS)).toBe(false);
    expect(
      isReadyToExpire(attempt, new Date(windowEnd + PROVIDER_EXPIRY_BUFFER_MS), WINDOW_MS)
    ).toBe(true);
  });
});

describe('decideWindowVerdict', () => {
  const expiresAt = new Date(OPENED.getTime() + WINDOW_MS);
  const now = new Date(expiresAt.getTime() + 2 * 60 * 1000);

  it('leaves a payment the gateway confirmed as paid alone', () => {
    expect(
      decideWindowVerdict({ verifiedStatus: 'COMPLETED', gatewayReachable: true, expiresAt, now })
    ).toBe('settled');
  });

  it('expires a payment the gateway reports unpaid', () => {
    for (const status of ['PENDING', 'FAILED', 'CANCELLED']) {
      expect(
        decideWindowVerdict({ verifiedStatus: status, gatewayReachable: true, expiresAt, now })
      ).toBe('expire');
    }
  });

  it('retries while the gateway cannot be asked, then expires after the grace period', () => {
    expect(
      decideWindowVerdict({ verifiedStatus: 'PENDING', gatewayReachable: false, expiresAt, now })
    ).toBe('retry');
    expect(
      decideWindowVerdict({
        verifiedStatus: 'PENDING',
        gatewayReachable: false,
        expiresAt,
        now: new Date(expiresAt.getTime() + GATEWAY_UNREACHABLE_GRACE_MS),
      })
    ).toBe('expire');
  });
});

describe('invoicePaymentExpiresAt', () => {
  it('is the latest window end among the open attempts, or null', () => {
    const later = '2026-10-21T17:40:00.000Z';
    expect(
      invoicePaymentExpiresAt(
        [
          { status: 'PENDING', createdAt: OPENED, metadata: {} },
          { status: 'PENDING', createdAt: OPENED, metadata: { paymentExpiresAt: later } },
          { status: 'COMPLETED', createdAt: OPENED, metadata: { paymentExpiresAt: '2027-01-01' } },
        ],
        WINDOW_MS
      )
    ).toEqual(new Date(later));
    expect(
      invoicePaymentExpiresAt([{ status: 'EXPIRED', createdAt: OPENED }], WINDOW_MS)
    ).toBeNull();
  });
});
