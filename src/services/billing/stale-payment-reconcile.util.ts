/**
 * Rules for the automatic check of payments that were started but never confirmed.
 *
 * A patient can pay at the gateway and never reach us: the webhook can be lost and the browser may
 * not return from the UPI app. The sweep asks the gateway about such payments and confirms the
 * paid ones, so nobody is left paying for a booking that stays unconfirmed.
 */

/** A payment younger than this is still being paid; the normal callback or webhook handles it. */
export const STALE_PENDING_MIN_AGE_MS = 3 * 60 * 1000;

/** Older payments are left to an admin (the booking slot has long since been released). */
export const STALE_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Payments checked per run, so one run stays short. */
export const STALE_PENDING_BATCH_SIZE = 25;

/** Seconds the cross-replica lock is held; just under the 5 minute schedule. */
export const STALE_PENDING_LOCK_TTL_SECONDS = 240;

export const STALE_PENDING_LOCK_KEY = 'lock:cron:billing:stale-pending-reconcile';

/**
 * Only a booking still waiting for its payment is confirmed automatically. One that has expired or
 * been cancelled may have had its slot given to someone else, so an admin decides those.
 */
const AWAITING_PAYMENT_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'SCHEDULED']);

export function isAwaitingPayment(appointmentStatus: unknown): boolean {
  return typeof appointmentStatus === 'string' && AWAITING_PAYMENT_STATUSES.has(appointmentStatus);
}

export function staleWindow(now: Date): { olderThan: Date; newerThan: Date } {
  return {
    olderThan: new Date(now.getTime() - STALE_PENDING_MIN_AGE_MS),
    newerThan: new Date(now.getTime() - STALE_PENDING_MAX_AGE_MS),
  };
}
