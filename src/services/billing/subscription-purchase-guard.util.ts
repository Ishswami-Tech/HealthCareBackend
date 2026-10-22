/**
 * One plan per patient per clinic.
 *
 * A patient may hold only one subscription in a clinic at a time. A new plan purchase is refused
 * while another plan of that clinic is still running, and a renewal payment can only be opened
 * near the end of the paid period. A paid plan is never extended twice for the same period.
 */
import { getEnv } from '@config/environment/utils';

/** Days before the end of the paid period from which a renewal can be paid. */
export const DEFAULT_RENEWAL_WINDOW_DAYS = 7;

export function renewalWindowDays(): number {
  const raw = getEnv('SUBSCRIPTION_RENEWAL_WINDOW_DAYS');
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(Math.floor(parsed), 365)
    : DEFAULT_RENEWAL_WINDOW_DAYS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses of a plan the patient is using right now (until its period ends). */
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['ACTIVE', 'TRIALING']);

export interface GuardSubscription {
  id: string;
  status: string;
  planId?: string | null;
  currentPeriodEnd?: Date | string | null;
  endDate?: Date | string | null;
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** When the paid period of a subscription ends, or null when it has no end. */
export function periodEndOf(subscription: GuardSubscription): Date | null {
  const time = timeOf(subscription.currentPeriodEnd) ?? timeOf(subscription.endDate);
  return time === null ? null : new Date(time);
}

/** The plan is in use: ACTIVE / TRIALING and its period has not ended. */
export function isRunning(subscription: GuardSubscription, now: Date): boolean {
  if (!RUNNING_STATUSES.has(String(subscription.status).toUpperCase())) {
    return false;
  }
  const end = periodEndOf(subscription);
  return end === null || end.getTime() > now.getTime();
}

/** From when a renewal of this subscription may be paid (period end minus the window). */
export function renewalOpensAt(
  subscription: GuardSubscription,
  windowDays: number = renewalWindowDays()
): Date | null {
  const end = periodEndOf(subscription);
  return end === null ? null : new Date(end.getTime() - windowDays * DAY_MS);
}

/** A renewal payment may be opened: the plan is not running, or it is inside the window. */
export function isRenewalOpen(
  subscription: GuardSubscription,
  now: Date,
  windowDays: number = renewalWindowDays()
): boolean {
  if (!isRunning(subscription, now)) {
    return true;
  }
  const opensAt = renewalOpensAt(subscription, windowDays);
  return opensAt !== null && opensAt.getTime() <= now.getTime();
}

export type PurchaseBlock =
  | { kind: 'running-plan'; subscription: GuardSubscription; periodEnd: Date | null }
  | { kind: 'payment-pending'; subscription: GuardSubscription };

/**
 * Why a NEW plan purchase in a clinic must be refused, or null when it may go ahead.
 * - another plan of the clinic is running (any plan: one plan per clinic);
 * - another plan purchase of the clinic is waiting on a live payment attempt
 *   (`hasLivePayment` says which subscription ids have one): the patient resumes that one.
 * The unpaid checkout of the SAME plan is not a block: it is reused by the caller.
 */
export function findPurchaseBlock(args: {
  subscriptions: readonly GuardSubscription[];
  planId: string;
  now: Date;
  hasLivePayment: (subscriptionId: string) => boolean;
}): PurchaseBlock | null {
  const running = args.subscriptions.find(subscription => isRunning(subscription, args.now));
  if (running) {
    return { kind: 'running-plan', subscription: running, periodEnd: periodEndOf(running) };
  }
  const pending = args.subscriptions.find(
    subscription =>
      String(subscription.status).toUpperCase() === 'INCOMPLETE' &&
      subscription.planId !== args.planId &&
      args.hasLivePayment(subscription.id)
  );
  return pending ? { kind: 'payment-pending', subscription: pending } : null;
}

/**
 * A completed payment that would extend a subscription a second time for the same period.
 * The invoice a payment settles records the period it was issued for (`periodEnd`). Once the
 * subscription has moved past that period (another payment already paid it), a further payment
 * for it is a duplicate: it is flagged for a refund decision, never used to extend again.
 * A payment whose invoice names no period cannot be judged and is not treated as a duplicate.
 */
export function isDuplicatePeriodPayment(args: {
  subscription: GuardSubscription;
  invoicePeriodEnd: Date | string | null | undefined;
  alreadyRenewedBy: readonly string[];
  paymentId: string;
}): boolean {
  if (args.alreadyRenewedBy.includes(args.paymentId)) {
    return false;
  }
  if (!RUNNING_STATUSES.has(String(args.subscription.status).toUpperCase())) {
    return false;
  }
  const invoiceEnd = timeOf(args.invoicePeriodEnd);
  const currentEnd = timeOf(args.subscription.currentPeriodEnd);
  if (invoiceEnd === null || currentEnd === null) {
    return false;
  }
  // Same period still current (a normal renewal) -> not a duplicate. Moved past it -> duplicate.
  return currentEnd > invoiceEnd + 60 * 1000;
}
