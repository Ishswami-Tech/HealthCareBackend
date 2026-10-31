/**
 * Latest counter hand-over state per prescription, attached to the prescription read models so
 * the patient app / web stop offering "Collect medicines" once the medicines were collected.
 *
 * Pure: the caller loads every hand-over row of the listed prescriptions in ONE query and this
 * picks the newest live row per prescription. SUPERSEDED rows are retired duplicate codes and
 * never represent the hand-over state.
 */

import {
  checkHandoverReadiness,
  type HandoverReadinessInput,
} from '@services/clinic-ops/services/handover-readiness.util';

export type PrescriptionHandoverStatus = 'PENDING_VERIFICATION' | 'HANDED_OVER' | 'UNDONE';

export interface PrescriptionHandoverState {
  status: PrescriptionHandoverStatus | null;
  handedOverAt: string | null;
}

export interface HandoverStateRow {
  prescriptionId: string;
  status: string | null;
  createdAt: Date | string | null;
  handedOverAt: Date | string | null;
}

const KNOWN_STATUSES = new Set<PrescriptionHandoverStatus>([
  'PENDING_VERIFICATION',
  'HANDED_OVER',
  'UNDONE',
]);

export const EMPTY_HANDOVER_STATE: PrescriptionHandoverState = Object.freeze({
  status: null,
  handedOverAt: null,
});

const toTime = (value: Date | string | null): number => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Newest non-superseded hand-over per prescription id. */
export function latestHandoverByPrescription(
  rows: readonly HandoverStateRow[]
): Map<string, PrescriptionHandoverState> {
  const newest = new Map<string, HandoverStateRow>();
  for (const row of rows) {
    const status = String(row.status ?? '').toUpperCase();
    if (!KNOWN_STATUSES.has(status as PrescriptionHandoverStatus)) continue;
    const current = newest.get(row.prescriptionId);
    if (!current || toTime(row.createdAt) > toTime(current.createdAt)) {
      newest.set(row.prescriptionId, row);
    }
  }
  const result = new Map<string, PrescriptionHandoverState>();
  for (const [prescriptionId, row] of newest) {
    const status = String(row.status).toUpperCase() as PrescriptionHandoverStatus;
    result.set(prescriptionId, {
      status,
      handedOverAt: status === 'HANDED_OVER' ? toIso(row.handedOverAt) : null,
    });
  }
  return result;
}

/** A collected prescription is never "ready for hand-over" again. */
export function readyForHandoverAfter(
  readyForHandover: boolean,
  handover: PrescriptionHandoverState
): boolean {
  return readyForHandover && handover.status !== 'HANDED_OVER';
}

/**
 * The patient may ask for a collection code: the counter would accept the hand-over now (the
 * same `checkHandoverReadiness` rule the hand-over service enforces: approved, paid, dispensed)
 * and the medicines were not collected yet. Unlike the desk's `readyForHandover` (paid, maybe
 * not dispensed yet), this never offers "Collect medicines" before the pharmacy dispensed.
 */
export function canCollectMedicines(
  readiness: HandoverReadinessInput,
  handover: PrescriptionHandoverState
): boolean {
  return (
    readiness.items.length > 0 &&
    handover.status !== 'HANDED_OVER' &&
    checkHandoverReadiness(readiness).ok
  );
}
