/// <reference types="jest" />
import {
  FINALISATION_GRACE_MS,
  buildFinalisationMarker,
  classifyFinalisationClaim,
  hasSubscriptionRenewalStamp,
  isAmountCovered,
  isDistinctGatewayPayment,
  ownsClaim,
  preserveReservedSubscriptionMetadata,
  readFinalisationMarker,
  sumCompletedPaymentMinorUnits,
  toMinorUnits,
  withSubscriptionRenewalStamp,
  buildSettlementReviewMetadata,
  hasSettlementReview,
  isPersistedAnomaly,
} from '@services/billing/billing-payment-finalisation.util';
import { describePaymentCallbackOutcome } from '../../../src/libs/payment/payment-callback-outcome.util';

const NOW = new Date('2026-10-03T12:00:00.000Z');

function metadataWith(marker: Record<string, unknown> | null): Record<string, unknown> {
  return marker ? { finalisation: marker } : {};
}

describe('finalisation marker classification', () => {
  const young: Record<string, unknown> = {
    ...buildFinalisationMarker('other', new Date(NOW.getTime() - 5_000)),
  };
  const old: Record<string, unknown> = {
    ...buildFinalisationMarker('other', new Date(NOW.getTime() - FINALISATION_GRACE_MS - 1)),
  };

  it('no marker is a legacy payment', () => {
    expect(classifyFinalisationClaim({}, 'me', NOW.getTime())).toBe('legacy');
    expect(classifyFinalisationClaim(null, null, NOW.getTime())).toBe('legacy');
    expect(
      classifyFinalisationClaim({ finalisation: { claimedAt: 'x' } }, 'me', NOW.getTime())
    ).toBe('legacy');
  });

  it('a stored token equal to the delivery token means the delivery IS the winner (lost ack)', () => {
    expect(
      classifyFinalisationClaim(metadataWith({ ...young, claimToken: 'me' }), 'me', NOW.getTime())
    ).toBe('own');
  });

  it('a finished marker is a pure duplicate whoever owns it', () => {
    const applied = { ...old, sideEffectsAppliedAt: NOW.toISOString() };
    expect(classifyFinalisationClaim(metadataWith(applied), 'me', NOW.getTime())).toBe('applied');
    expect(classifyFinalisationClaim(metadataWith(applied), null, NOW.getTime())).toBe('applied');
  });

  it('an unfinished marker is in_progress inside the grace window and stale after it', () => {
    expect(classifyFinalisationClaim(metadataWith(young), 'me', NOW.getTime())).toBe('in_progress');
    expect(classifyFinalisationClaim(metadataWith(old), 'me', NOW.getTime())).toBe('stale');
    expect(
      classifyFinalisationClaim(
        metadataWith({ ...young, claimedAt: 'garbage' }),
        'me',
        NOW.getTime()
      )
    ).toBe('stale');
  });

  it('reads the marker and the audit token', () => {
    expect(readFinalisationMarker(metadataWith(young))?.claimToken).toBe('other');
    expect(readFinalisationMarker({ finalisation: 'nope' })).toBeNull();
    expect(ownsClaim({ callbackAudit: { claimToken: 'me' } }, 'me')).toBe(true);
    expect(ownsClaim(metadataWith(young), 'me')).toBe(false);
  });
});

describe('amounts are compared in paise', () => {
  it('converts rupees to minor units without float drift', () => {
    expect(toMinorUnits(118)).toBe(11800);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits('59.99')).toBe(5999);
    expect(toMinorUnits(undefined)).toBe(0);
    expect(toMinorUnits('abc')).toBe(0);
  });

  it('covered means paid >= required, never less', () => {
    expect(isAmountCovered(11800, 11800)).toBe(true);
    expect(isAmountCovered(11801, 11800)).toBe(true);
    expect(isAmountCovered(11799, 11800)).toBe(false);
  });

  it('only COMPLETED payments count towards an invoice', () => {
    expect(
      sumCompletedPaymentMinorUnits([
        { status: 'COMPLETED', amount: 60 },
        { status: 'completed', amount: 58.5 },
        { status: 'PENDING', amount: 1000 },
        { status: 'FAILED', amount: 1000 },
        { status: 'REFUNDED', amount: 1000 },
      ])
    ).toBe(11850);
  });
});

describe('distinguishing a second gateway payment from a redelivery', () => {
  const stored = {
    storedTransactionId: 'cf-tx-1',
    storedMetadata: {
      orderId: 'order-1',
      callbackAudit: { orderId: 'order-1', verifiedTransactionId: 'cf-tx-1' },
    },
  };

  it('the same order / transaction is a redelivery', () => {
    expect(
      isDistinctGatewayPayment({ ...stored, verifiedTransactionId: 'cf-tx-1', orderId: 'order-1' })
    ).toBe(false);
  });

  it('a different transaction on the SAME order is not called distinct (ids rendered differently)', () => {
    expect(
      isDistinctGatewayPayment({ ...stored, verifiedTransactionId: 'cf-tx-2', orderId: 'order-1' })
    ).toBe(false);
  });

  it('a different transaction on a different order is a second payment', () => {
    expect(
      isDistinctGatewayPayment({ ...stored, verifiedTransactionId: 'cf-tx-2', orderId: 'order-2' })
    ).toBe(true);
  });

  it('never claims "distinct" when nothing is recorded to compare with', () => {
    expect(
      isDistinctGatewayPayment({
        storedTransactionId: null,
        storedMetadata: {},
        verifiedTransactionId: 'cf-tx-2',
        orderId: 'order-2',
      })
    ).toBe(false);
    expect(
      isDistinctGatewayPayment({ ...stored, verifiedTransactionId: '', orderId: 'order-2' })
    ).toBe(false);
  });
});

describe('subscription renewal stamps', () => {
  it('stamps the payment id and recognises it', () => {
    const stamped = withSubscriptionRenewalStamp({ note: 'keep' }, 'pay-1', NOW);

    expect(stamped['note']).toBe('keep');
    expect(stamped['lastRenewedPaymentId']).toBe('pay-1');
    expect(hasSubscriptionRenewalStamp(stamped, 'pay-1')).toBe(true);
    expect(hasSubscriptionRenewalStamp(stamped, 'pay-2')).toBe(false);
    expect(hasSubscriptionRenewalStamp(null, 'pay-1')).toBe(false);
  });

  it('keeps earlier ids (an old payment replayed after a newer one is still a no-op) and caps the list', () => {
    let metadata: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) {
      metadata = withSubscriptionRenewalStamp(metadata, `pay-${index}`, NOW);
    }

    expect((metadata['renewedPaymentIds'] as string[]).length).toBe(25);
    expect(hasSubscriptionRenewalStamp(metadata, 'pay-39')).toBe(true);
    expect(hasSubscriptionRenewalStamp(metadata, 'pay-20')).toBe(true);
    expect(hasSubscriptionRenewalStamp(metadata, 'pay-0')).toBe(false);
  });

  it('a staff metadata edit cannot erase the stamps', () => {
    const existing = withSubscriptionRenewalStamp({}, 'pay-1', NOW);

    const edited = preserveReservedSubscriptionMetadata(existing, {
      note: 'new',
      renewedPaymentIds: [],
    });

    expect(edited['note']).toBe('new');
    expect(hasSubscriptionRenewalStamp(edited, 'pay-1')).toBe(true);
  });
});

describe('settlement review (admin-visible data, never a refund)', () => {
  it('creates a PENDING_REVIEW record once and never overwrites it', () => {
    const first = buildSettlementReviewMetadata(
      { keep: true },
      { reason: 'DUPLICATE_SETTLEMENT', invoiceId: 'inv-1', orderId: 'o1', transactionId: 't1' },
      NOW
    );

    expect(first?.created).toBe(true);
    expect(first?.next['keep']).toBe(true);
    expect(hasSettlementReview(first?.next)).toBe(true);
    expect(first?.next['settlementReview']).toMatchObject({
      reason: 'DUPLICATE_SETTLEMENT',
      status: 'PENDING_REVIEW',
      invoiceId: 'inv-1',
    });

    // The same settlement again: nothing to write.
    expect(
      buildSettlementReviewMetadata(
        first?.next ?? {},
        { reason: 'DUPLICATE_SETTLEMENT', orderId: 'o1', transactionId: 't1' },
        NOW
      )
    ).toBeNull();

    // A DIFFERENT settlement is appended; the original reason / status are untouched.
    const second = buildSettlementReviewMetadata(
      first?.next ?? {},
      { reason: 'UNDERPAYMENT', orderId: 'o2', transactionId: 't2' },
      NOW
    );
    expect(second?.created).toBe(false);
    expect(second?.next['settlementReview']).toMatchObject({
      reason: 'DUPLICATE_SETTLEMENT',
      settlements: [{ transactionId: 't1' }, { transactionId: 't2' }],
    });
  });

  it('late settlements are never persisted (no refunds for visits that never take place)', () => {
    expect(isPersistedAnomaly('LATE_SETTLEMENT')).toBe(false);
    expect(isPersistedAnomaly('DUPLICATE_SETTLEMENT')).toBe(true);
    expect(isPersistedAnomaly('UNDERPAYMENT')).toBe(true);
  });
});

describe('callback outcome codes', () => {
  it('maps every non-completed outcome to a code + retryable flag', () => {
    expect(describePaymentCallbackOutcome({ hasPaymentRecord: false })).toEqual({
      code: 'PAYMENT_NOT_FOUND',
      retryable: true,
    });
    expect(
      describePaymentCallbackOutcome({
        hasPaymentRecord: true,
        status: 'COMPLETED',
        processing: true,
      })
    ).toEqual({ code: 'PAYMENT_PROCESSING', retryable: true });
    expect(describePaymentCallbackOutcome({ hasPaymentRecord: true, status: 'PENDING' })).toEqual({
      code: 'PAYMENT_PENDING',
      retryable: true,
    });
    for (const [status, code] of [
      ['FAILED', 'PAYMENT_FAILED'],
      ['CANCELLED', 'PAYMENT_CANCELLED'],
      ['EXPIRED', 'PAYMENT_EXPIRED'],
      ['REFUNDED', 'PAYMENT_REFUNDED'],
    ] as const) {
      expect(describePaymentCallbackOutcome({ hasPaymentRecord: true, status })).toEqual({
        code,
        retryable: false,
      });
    }
    expect(
      describePaymentCallbackOutcome({ hasPaymentRecord: true, status: 'COMPLETED' })
    ).toBeNull();
  });
});
