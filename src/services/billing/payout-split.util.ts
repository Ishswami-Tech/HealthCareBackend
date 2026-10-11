/**
 * Pure payout split maths. Money is handled in integer paise so a split never drifts by a
 * fraction of a rupee. A doctor with a fixed fee for the visit type earns exactly that fee
 * (capped at what the patient paid) and the remainder is the convenience fee; otherwise the
 * clinic-wide percentage platform fee applies.
 */

export interface PayoutSplit {
  grossAmount: number;
  doctorShareAmount: number;
  platformFeeAmount: number;
  platformFeePercent: number;
  feeSource: 'FIXED' | 'PERCENT';
}

export interface PayoutSplitInput {
  grossAmount: number;
  /** Fixed doctor fee in rupees for this visit type, or null/undefined when not configured. */
  fixedDoctorFee?: number | null;
  /** Percentage platform fee used when no fixed doctor fee is configured. */
  fallbackFeePercent: number;
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const toRupees = (paise: number): number => paise / 100;

export function computePayoutSplit(input: PayoutSplitInput): PayoutSplit {
  const grossPaise = Math.max(0, toPaise(input.grossAmount));
  const fixed = input.fixedDoctorFee;
  const hasFixedFee = typeof fixed === 'number' && Number.isFinite(fixed) && fixed >= 0;

  const doctorPaise = hasFixedFee
    ? Math.min(grossPaise, toPaise(fixed))
    : grossPaise - Math.round((grossPaise * input.fallbackFeePercent) / 100);
  const platformPaise = grossPaise - doctorPaise;

  return {
    grossAmount: toRupees(grossPaise),
    doctorShareAmount: toRupees(doctorPaise),
    platformFeeAmount: toRupees(platformPaise),
    platformFeePercent:
      grossPaise === 0 ? 0 : Math.round((platformPaise / grossPaise) * 10000) / 100,
    feeSource: hasFixedFee ? 'FIXED' : 'PERCENT',
  };
}

export interface RefundedSplit {
  doctorShareAmount: number;
  platformFeeAmount: number;
}

/**
 * Reduces both sides of a split in proportion to the refunded share of what was paid.
 * `original` is the split at payment time and `totalRefunded` the cumulative refund, so a second
 * refund never compounds on the first.
 */
export function applyRefundToSplit(
  original: Pick<PayoutSplit, 'grossAmount' | 'doctorShareAmount' | 'platformFeeAmount'>,
  totalRefunded: number
): RefundedSplit {
  const grossPaise = toPaise(original.grossAmount);
  if (grossPaise <= 0) {
    return { doctorShareAmount: 0, platformFeeAmount: 0 };
  }
  const refundedPaise = Math.min(grossPaise, Math.max(0, toPaise(totalRefunded)));
  const keptPaise = grossPaise - refundedPaise;
  const doctorPaise = Math.round((toPaise(original.doctorShareAmount) * keptPaise) / grossPaise);
  const platformPaise = Math.round((toPaise(original.platformFeeAmount) * keptPaise) / grossPaise);
  return { doctorShareAmount: toRupees(doctorPaise), platformFeeAmount: toRupees(platformPaise) };
}
