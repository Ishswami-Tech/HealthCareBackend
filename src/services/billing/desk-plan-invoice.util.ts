/**
 * Desk fallback for plan (subscription) purchases: reception sells a plan and collects cash /
 * UPI-at-desk instead of the online checkout. Pure decisions only; BillingService does the I/O.
 */

export interface DeskPlanInvoiceCandidate {
  readonly id: string;
  readonly userId: string;
  readonly clinicId: string;
  readonly status: string;
  readonly totalAmount: number;
  readonly createdAt: Date | string;
}

/** Amounts are compared in paise so float noise never creates a second invoice. */
function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * The open plan invoice the desk should collect against: the newest PENDING invoice of the same
 * patient and clinic whose total equals what the plan charges now. Null means a new desk invoice
 * is raised. Reusing it keeps one bill per plan period, so the patient is never billed twice.
 */
export function pickDeskPlanInvoice<T extends DeskPlanInvoiceCandidate>(
  invoices: readonly T[],
  expected: { userId: string; clinicId: string; totalAmount: number }
): T | null {
  const expectedPaise = toPaise(expected.totalAmount);
  const matches = invoices.filter(
    invoice =>
      String(invoice.status).toUpperCase() === 'PENDING' &&
      invoice.userId === expected.userId &&
      invoice.clinicId === expected.clinicId &&
      toPaise(Number(invoice.totalAmount)) === expectedPaise
  );
  if (matches.length === 0) {
    return null;
  }
  return [...matches].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  )[0] as T;
}

/**
 * A payment recorded at the desk that settles a plan invoice must start the plan, through the
 * same finalisation the gateway path runs. Any other desk payment only settles its invoice.
 */
export function shouldActivatePlanAfterDeskPayment(args: {
  settlesInvoice: boolean;
  subscriptionId?: string | null;
}): boolean {
  return (
    args.settlesInvoice &&
    typeof args.subscriptionId === 'string' &&
    args.subscriptionId.trim().length > 0
  );
}
