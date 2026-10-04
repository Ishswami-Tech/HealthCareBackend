/**
 * Machine-readable outcome fields of the public payment callbacks, so clients know whether to
 * keep polling (`retryable: true`) or stop (a terminal state) without parsing messages.
 */
export type PaymentCallbackCode =
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_REFUNDED';

export interface PaymentCallbackOutcomeFields {
  code: PaymentCallbackCode;
  retryable: boolean;
}

const TERMINAL_CODES: Readonly<Record<string, PaymentCallbackCode>> = {
  failed: 'PAYMENT_FAILED',
  cancelled: 'PAYMENT_CANCELLED',
  expired: 'PAYMENT_EXPIRED',
  refunded: 'PAYMENT_REFUNDED',
};

/** Fields for a callback that is NOT a completed payment; null when it completed. */
export function describePaymentCallbackOutcome(args: {
  hasPaymentRecord: boolean;
  /** Payment status as stored (any case). */
  status?: string | undefined;
  /** BillingService answered "the winner is still finalising". */
  processing?: boolean | undefined;
}): PaymentCallbackOutcomeFields | null {
  if (!args.hasPaymentRecord) {
    return { code: 'PAYMENT_NOT_FOUND', retryable: true };
  }
  if (args.processing) {
    return { code: 'PAYMENT_PROCESSING', retryable: true };
  }
  const status = String(args.status ?? '').toLowerCase();
  if (status === 'completed') {
    return null;
  }
  const terminal = TERMINAL_CODES[status];
  if (terminal) {
    return { code: terminal, retryable: false };
  }
  return { code: 'PAYMENT_PENDING', retryable: true };
}
