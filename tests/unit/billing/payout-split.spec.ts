import { describe, expect, it } from '@jest/globals';
import {
  applyRefundToSplit,
  computePayoutSplit,
} from '../../../src/services/billing/payout-split.util';

describe('computePayoutSplit', () => {
  it('gives the doctor the fixed fee and the rest to the platform', () => {
    const split = computePayoutSplit({
      grossAmount: 1251,
      fixedDoctorFee: 1000,
      fallbackFeePercent: 20,
    });
    expect(split).toMatchObject({
      doctorShareAmount: 1000,
      platformFeeAmount: 251,
      feeSource: 'FIXED',
    });
  });

  it('keeps the fixed fee when the price rises', () => {
    const split = computePayoutSplit({
      grossAmount: 1350,
      fixedDoctorFee: 1000,
      fallbackFeePercent: 20,
    });
    expect(split.doctorShareAmount).toBe(1000);
    expect(split.platformFeeAmount).toBe(350);
  });

  it('never pays the doctor more than the patient paid', () => {
    const split = computePayoutSplit({
      grossAmount: 800,
      fixedDoctorFee: 1000,
      fallbackFeePercent: 20,
    });
    expect(split.doctorShareAmount).toBe(800);
    expect(split.platformFeeAmount).toBe(0);
  });

  it('treats a zero fixed fee as configured (the doctor earns nothing)', () => {
    const split = computePayoutSplit({
      grossAmount: 500,
      fixedDoctorFee: 0,
      fallbackFeePercent: 20,
    });
    expect(split).toMatchObject({
      doctorShareAmount: 0,
      platformFeeAmount: 500,
      feeSource: 'FIXED',
    });
  });

  it('falls back to the percentage when no fixed fee is configured', () => {
    const split = computePayoutSplit({
      grossAmount: 1251,
      fixedDoctorFee: null,
      fallbackFeePercent: 20,
    });
    expect(split).toMatchObject({
      doctorShareAmount: 1000.8,
      platformFeeAmount: 250.2,
      feeSource: 'PERCENT',
    });
  });
});

describe('applyRefundToSplit', () => {
  const original = { grossAmount: 1251, doctorShareAmount: 1000, platformFeeAmount: 251 };

  it('reduces both sides in proportion to a partial refund', () => {
    const refunded = applyRefundToSplit(original, 625.5);
    expect(refunded.doctorShareAmount).toBe(500);
    expect(refunded.platformFeeAmount).toBe(125.5);
  });

  it('zeroes both sides on a full refund', () => {
    expect(applyRefundToSplit(original, 1251)).toEqual({
      doctorShareAmount: 0,
      platformFeeAmount: 0,
    });
  });

  it('does not compound repeated refunds (cumulative total is used)', () => {
    const once = applyRefundToSplit(original, 625.5);
    const twiceSameTotal = applyRefundToSplit(original, 625.5);
    expect(twiceSameTotal).toEqual(once);
  });

  it('caps the refund at what was paid', () => {
    expect(applyRefundToSplit(original, 5000)).toEqual({
      doctorShareAmount: 0,
      platformFeeAmount: 0,
    });
  });
});
