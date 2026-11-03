/**
 * Medicine-desk lifecycle for a prescription row (pure, no Nest imports).
 *
 * Assistant drafts (DRAFT / RETURNED) never reach the pharmacy: they keep their own status
 * instead of being reported as WAITING_FOR_PAYMENT, and they are never put in the desk queue.
 */

export type MedicineDeskPaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID';

export type MedicineDeskDraftStatus = 'DRAFT' | 'RETURNED';

export type MedicineDeskLifecycleStatus =
  | 'WAITING_FOR_PAYMENT'
  | 'READY_FOR_HANDOVER'
  | 'DISPENSED'
  | 'CANCELLED'
  | MedicineDeskDraftStatus;

const DRAFT_STATUSES: ReadonlySet<string> = new Set<MedicineDeskDraftStatus>(['DRAFT', 'RETURNED']);

function normalise(status: string | null | undefined): string {
  return String(status || '').toUpperCase();
}

/** DRAFT or RETURNED: an assistant draft still awaiting the doctor. */
export function isDraftPrescriptionStatus(status: string | null | undefined): boolean {
  return DRAFT_STATUSES.has(normalise(status));
}

/** Rows that must not sit in the medicine-desk queue: finished, cancelled, or still a draft. */
export function isOffMedicineDesk(status: string | null | undefined): boolean {
  const value = normalise(status);
  return value === 'FILLED' || value === 'CANCELLED' || DRAFT_STATUSES.has(value);
}

export function medicineDeskLifecycleStatus(
  prescriptionStatus: string | null | undefined,
  paymentStatus: MedicineDeskPaymentStatus
): MedicineDeskLifecycleStatus {
  const value = normalise(prescriptionStatus);
  if (value === 'FILLED') return 'DISPENSED';
  if (value === 'CANCELLED') return 'CANCELLED';
  if (value === 'DRAFT' || value === 'RETURNED') return value;
  return paymentStatus === 'PAID' ? 'READY_FOR_HANDOVER' : 'WAITING_FOR_PAYMENT';
}
