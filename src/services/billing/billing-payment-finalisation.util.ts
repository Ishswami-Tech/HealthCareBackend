/**
 * Pure helpers for the payment-finalisation protocol (no I/O).
 *
 * A payment is finalised by the delivery (webhook job, handoff callback, poller, repair run) whose
 * compare-and-set claim moves it to COMPLETED. The claim stores a marker in
 * `payment.metadata.finalisation`:
 *
 *   { claimToken, claimedAt, sideEffectsAppliedAt }
 *
 * - `claimToken` is a UUID generated per delivery, so a delivery whose claim committed but whose
 *   acknowledgement was lost (database retry) can recognise that it IS the winner.
 * - `sideEffectsAppliedAt` is stamped LAST, after every idempotent side effect ran. A COMPLETED
 *   payment without it, older than the grace window, is a crashed finalisation and is repaired.
 */

import { randomUUID } from 'crypto';
import {
  computeConfirmationExpiresAt,
  getConfirmationWindowMinutes,
} from '@services/appointments/core/confirmation-window.util';

export type JsonRecord = Record<string, unknown>;

export const FINALISATION_METADATA_KEY = 'finalisation';
export const FINALISATION_GRACE_MS = 60_000;
export const RENEWED_PAYMENT_IDS_LIMIT = 25;

export interface FinalisationMarker {
  claimToken: string;
  claimedAt: string;
  sideEffectsAppliedAt: string | null;
}

/**
 * - own: the stored claim token is this delivery's token (lost acknowledgement => it won)
 * - applied: another delivery already applied every side effect (pure duplicate)
 * - in_progress: another delivery claimed it recently and is still working
 * - stale: another delivery claimed it, never finished and is older than the grace window
 * - legacy: no marker (payment completed before the protocol existed, or completed by staff)
 */
export type FinalisationClaimView = 'own' | 'applied' | 'in_progress' | 'stale' | 'legacy';

export function asJsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export function createClaimToken(): string {
  return randomUUID();
}

export function buildFinalisationMarker(claimToken: string, now: Date): FinalisationMarker {
  return { claimToken, claimedAt: now.toISOString(), sideEffectsAppliedAt: null };
}

export function readFinalisationMarker(metadata: unknown): FinalisationMarker | null {
  const marker = asJsonRecord(asJsonRecord(metadata)?.[FINALISATION_METADATA_KEY]);
  if (!marker || typeof marker['claimToken'] !== 'string' || !marker['claimToken']) {
    return null;
  }
  return {
    claimToken: marker['claimToken'],
    claimedAt: typeof marker['claimedAt'] === 'string' ? marker['claimedAt'] : '',
    sideEffectsAppliedAt:
      typeof marker['sideEffectsAppliedAt'] === 'string' && marker['sideEffectsAppliedAt']
        ? marker['sideEffectsAppliedAt']
        : null,
  };
}

/** Whether the audit trail of the stored claim carries this delivery's token (any status). */
export function readCallbackAuditToken(metadata: unknown): string | null {
  const audit = asJsonRecord(asJsonRecord(metadata)?.['callbackAudit']);
  return typeof audit?.['claimToken'] === 'string' ? audit['claimToken'] : null;
}

export function ownsClaim(metadata: unknown, claimToken: string): boolean {
  return (
    readFinalisationMarker(metadata)?.claimToken === claimToken ||
    readCallbackAuditToken(metadata) === claimToken
  );
}

export function classifyFinalisationClaim(
  metadata: unknown,
  claimToken: string | null,
  nowMs: number,
  graceMs: number = FINALISATION_GRACE_MS
): FinalisationClaimView {
  const marker = readFinalisationMarker(metadata);
  if (!marker) {
    return 'legacy';
  }
  if (claimToken !== null && marker.claimToken === claimToken) {
    return 'own';
  }
  if (marker.sideEffectsAppliedAt) {
    return 'applied';
  }
  const claimedAtMs = Date.parse(marker.claimedAt);
  if (Number.isNaN(claimedAtMs)) {
    return 'stale';
  }
  return nowMs - claimedAtMs < graceMs ? 'in_progress' : 'stale';
}

// ---------------------------------------------------------------------------------------------
// Money. Amounts are Float columns; every comparison is made in the smallest unit (paise).
// ---------------------------------------------------------------------------------------------

export function toMinorUnits(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function isAmountCovered(paidMinorUnits: number, requiredMinorUnits: number): boolean {
  return paidMinorUnits >= requiredMinorUnits;
}

export interface AmountBearingPayment {
  status?: unknown;
  amount?: unknown;
}

/** Sum of the COMPLETED payments (refunded / failed / pending ones never count), in paise. */
export function sumCompletedPaymentMinorUnits(payments: readonly AmountBearingPayment[]): number {
  return payments
    .filter(
      payment =>
        (typeof payment.status === 'string' ? payment.status : '').toUpperCase() === 'COMPLETED'
    )
    .reduce((sum, payment) => sum + toMinorUnits(payment.amount), 0);
}

// ---------------------------------------------------------------------------------------------
// Distinguishing a redelivery of the settled order from a second paid gateway order.
// ---------------------------------------------------------------------------------------------

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function resolveKnownOrderIds(metadata: unknown): Set<string> {
  const record = asJsonRecord(metadata);
  const audit = asJsonRecord(record?.['callbackAudit']);
  return new Set(
    [
      record?.['orderId'],
      record?.['paymentIntentId'],
      record?.['supersededOrderId'],
      audit?.['orderId'],
      audit?.['requestedPaymentId'],
    ]
      .map(asNonEmptyString)
      .filter(Boolean)
  );
}

export function resolveKnownTransactionIds(
  transactionId: string | null | undefined,
  metadata: unknown
): Set<string> {
  const audit = asJsonRecord(asJsonRecord(metadata)?.['callbackAudit']);
  return new Set(
    [transactionId, audit?.['verifiedTransactionId']].map(asNonEmptyString).filter(Boolean)
  );
}

/**
 * True when a verified successful gateway payment is NOT the one already recorded on a settled
 * payment: its transaction id is unknown AND its order id is unknown. Both must differ, so a
 * redelivery that merely renders ids differently is never mistaken for a second payment, and a
 * payment with no recorded gateway ids can never be called distinct.
 */
export function isDistinctGatewayPayment(args: {
  storedTransactionId: string | null | undefined;
  storedMetadata: unknown;
  verifiedTransactionId: string | null | undefined;
  orderId: string;
}): boolean {
  const verifiedTransactionId = asNonEmptyString(args.verifiedTransactionId);
  const knownTransactionIds = resolveKnownTransactionIds(
    args.storedTransactionId,
    args.storedMetadata
  );
  const knownOrderIds = resolveKnownOrderIds(args.storedMetadata);
  if (!verifiedTransactionId || knownTransactionIds.size === 0 || knownOrderIds.size === 0) {
    return false;
  }
  return (
    !knownTransactionIds.has(verifiedTransactionId) &&
    !knownOrderIds.has(asNonEmptyString(args.orderId))
  );
}

// ---------------------------------------------------------------------------------------------
// Subscription renewal stamps: one payment can never buy two intervals.
// ---------------------------------------------------------------------------------------------

export function hasSubscriptionRenewalStamp(metadata: unknown, paymentId: string): boolean {
  const record = asJsonRecord(metadata);
  if (!record) {
    return false;
  }
  if (record['lastRenewedPaymentId'] === paymentId) {
    return true;
  }
  const renewed = record['renewedPaymentIds'];
  return Array.isArray(renewed) && renewed.includes(paymentId);
}

export function withSubscriptionRenewalStamp(
  metadata: unknown,
  paymentId: string,
  now: Date
): JsonRecord {
  const record = asJsonRecord(metadata) ?? {};
  const previous = Array.isArray(record['renewedPaymentIds'])
    ? (record['renewedPaymentIds'] as unknown[]).filter(
        (value): value is string => typeof value === 'string'
      )
    : [];
  const renewedPaymentIds = [...previous.filter(id => id !== paymentId), paymentId].slice(
    -RENEWED_PAYMENT_IDS_LIMIT
  );
  return {
    ...record,
    lastRenewedPaymentId: paymentId,
    lastRenewedAt: now.toISOString(),
    renewedPaymentIds,
  };
}

/** Keys of `subscription.metadata` owned by the payment protocol; staff edits must keep them. */
export const SUBSCRIPTION_RESERVED_METADATA_KEYS = [
  'lastRenewedPaymentId',
  'lastRenewedAt',
  'renewedPaymentIds',
] as const;

export function preserveReservedSubscriptionMetadata(
  existing: unknown,
  incoming: JsonRecord
): JsonRecord {
  const current = asJsonRecord(existing);
  if (!current) {
    return incoming;
  }
  const preserved: JsonRecord = {};
  for (const key of SUBSCRIPTION_RESERVED_METADATA_KEYS) {
    if (key in current) {
      preserved[key] = current[key];
    }
  }
  return { ...incoming, ...preserved };
}

/**
 * Expiry to stamp on an appointment that was just CONFIRMED because its payment completed.
 *
 * - Normally this is the appointment's own scheduled start plus the active window, so a visit
 *   paid today for tomorrow is not expired tonight.
 * - If that moment has already passed (late payment, or an admin recovering a missed webhook)
 *   a past expiry would make the scheduler expire the freshly paid visit on its next run, so
 *   the expiry is clamped to "now + window" - the same fallback the Prisma middleware applies
 *   when no expiry is supplied.
 *
 * Always returns a concrete date (never null) so the middleware never has to guess.
 */
export function resolvePaidConfirmationExpiresAt(
  appointment: { date?: Date | string | null; time?: string | null; type?: string | null },
  now: Date = new Date()
): Date {
  const computed = computeConfirmationExpiresAt(appointment);
  if (computed && computed.getTime() > now.getTime()) {
    return computed;
  }
  return new Date(now.getTime() + getConfirmationWindowMinutes() * 60_000);
}

/**
 * Admin-visible record of a payment whose money was really collected but that this system did
 * NOT apply as a normal settlement, stored on `payment.metadata.settlementReview`:
 *
 *  - DUPLICATE_SETTLEMENT: a second paid gateway order, or a second payment on an already
 *    settled invoice (the same booking charged twice);
 *  - UNDERPAYMENT: completed payments do not cover the invoice / plan amount.
 *
 * It is data for the clinic admin and finance dashboards only: nothing here refunds, requests a
 * refund or notifies anybody. Late settlements (money for an appointment that was already
 * released) are deliberately NOT recorded: the product has no refunds for visits that never
 * take place, so they only log and emit `billing.payment.late_settlement`.
 */

export type SettlementAnomalyReason = 'LATE_SETTLEMENT' | 'DUPLICATE_SETTLEMENT' | 'UNDERPAYMENT';
export type SettlementReviewReason = Exclude<SettlementAnomalyReason, 'LATE_SETTLEMENT'>;

export const SETTLEMENT_REVIEW_METADATA_KEY = 'settlementReview';
const SETTLEMENT_REVIEW_SETTLEMENTS_LIMIT = 10;

export interface SettlementReviewSettlement {
  orderId?: string;
  transactionId?: string;
  amount?: number;
  flaggedAt: string;
}

export interface SettlementReviewEntry {
  reason: SettlementReviewReason;
  appointmentId?: string | undefined;
  invoiceId?: string | undefined;
  orderId?: string | undefined;
  transactionId?: string | undefined;
  amount?: number | undefined;
}

export function isPersistedAnomaly(
  reason: SettlementAnomalyReason
): reason is SettlementReviewReason {
  return reason !== 'LATE_SETTLEMENT';
}

export function hasSettlementReview(metadata: unknown): boolean {
  return asJsonRecord(asJsonRecord(metadata)?.[SETTLEMENT_REVIEW_METADATA_KEY]) !== null;
}

/**
 * Next metadata for a settlement review, or null when nothing has to be written.
 * An existing review is never overwritten: a further settlement of a DIFFERENT gateway
 * transaction is only appended to `settlements`.
 */
export function buildSettlementReviewMetadata(
  current: JsonRecord,
  entry: SettlementReviewEntry,
  now: Date
): { next: JsonRecord; created: boolean } | null {
  const flaggedAt = now.toISOString();
  const settlement: SettlementReviewSettlement | null =
    entry.orderId || entry.transactionId || entry.amount !== undefined
      ? {
          ...(entry.orderId ? { orderId: entry.orderId } : {}),
          ...(entry.transactionId ? { transactionId: entry.transactionId } : {}),
          ...(entry.amount !== undefined ? { amount: entry.amount } : {}),
          flaggedAt,
        }
      : null;

  const existing = asJsonRecord(current[SETTLEMENT_REVIEW_METADATA_KEY]);
  if (!existing) {
    const review: JsonRecord = {
      reason: entry.reason,
      status: 'PENDING_REVIEW',
      flaggedAt,
      ...(entry.appointmentId ? { appointmentId: entry.appointmentId } : {}),
      ...(entry.invoiceId ? { invoiceId: entry.invoiceId } : {}),
      ...(settlement ? { settlements: [settlement] } : {}),
    };
    return { next: { ...current, [SETTLEMENT_REVIEW_METADATA_KEY]: review }, created: true };
  }

  const known = Array.isArray(existing['settlements'])
    ? (existing['settlements'] as SettlementReviewSettlement[])
    : [];
  const alreadyRecorded =
    !settlement ||
    known.some(
      item =>
        (settlement.transactionId && item.transactionId === settlement.transactionId) ||
        (!settlement.transactionId && settlement.orderId && item.orderId === settlement.orderId)
    );
  if (alreadyRecorded) {
    return null;
  }
  return {
    next: {
      ...current,
      [SETTLEMENT_REVIEW_METADATA_KEY]: {
        ...existing,
        settlements: [...known, settlement].slice(-SETTLEMENT_REVIEW_SETTLEMENTS_LIMIT),
      },
    },
    created: false,
  };
}
