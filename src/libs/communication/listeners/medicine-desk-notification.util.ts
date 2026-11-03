/**
 * Patient notifications for medicine-desk changes (pure, no Nest imports).
 *
 * INT-03: every desk update (created, payment recorded, queue moved, status touched) used to
 * fan out to socket, push, email and WhatsApp for the patient and the doctor. Staff screens are
 * refreshed by the socket broadcaster on their own, so the patient is told only about the
 * milestones that need them at the counter: the medicines were dispensed (all, or part of
 * them), i.e. ready to collect. Each milestone is sent once per prescription.
 *
 * D4 (release E2E): the prescription itself reaching the pharmacy (`CREATED`, from the doctor's
 * save or the approval of an assistant's draft) told the patient nothing, so they did not know
 * there was a bill to pay. It is now the PRESCRIPTION_READY milestone: "Your prescription from
 * Dr X is ready - Rs N to pay at the pharmacy or online", once per prescription, only when the
 * prescription has medicines.
 */

export type MedicineDeskMilestone =
  'PRESCRIPTION_READY' | 'READY_TO_COLLECT' | 'PARTLY_READY_TO_COLLECT';

/** What the `pharmacy.medicine_desk.updated` payload says about the prescription. */
export interface MedicineDeskDetails {
  /** Number of medicines on the prescription (0 for a note-only prescription). */
  readonly medicationCount?: number | null;
  /** Amount still to pay, in rupees. */
  readonly pendingAmount?: number | null;
  readonly doctorName?: string | null;
}

/** The milestone a desk update stands for, or null for a minor update (no patient message). */
export function medicineDeskMilestone(
  action: string | null | undefined,
  details: MedicineDeskDetails = {}
): MedicineDeskMilestone | null {
  const value = String(action ?? '').toUpperCase();
  if (value === 'DISPENSED') return 'READY_TO_COLLECT';
  if (value === 'PARTIALLY_DISPENSED') return 'PARTLY_READY_TO_COLLECT';
  if (value === 'CREATED' && Number(details.medicationCount ?? 0) > 0) {
    return 'PRESCRIPTION_READY';
  }
  return null;
}

/** "Dr Asha Rao" for "Asha Rao" / "Dr. Asha Rao" / "dr asha rao"; '' when unknown. */
export function doctorDisplayName(name: string | null | undefined): string {
  const trimmed = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return '';
  const withoutTitle = trimmed.replace(/^dr\.?(\s+|$)/i, '').trim();
  return withoutTitle ? `Dr ${withoutTitle}` : '';
}

/** "₹2,480" / "₹99.50" (Indian digit grouping, paise only when there are any). */
export function formatRupees(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₹${rounded.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function prescriptionReadyContent(details: MedicineDeskDetails): { title: string; body: string } {
  const doctor = doctorDisplayName(details.doctorName);
  const from = doctor ? ` from ${doctor}` : '';
  const pending = Number(details.pendingAmount ?? 0);
  return {
    title: 'Prescription ready',
    body:
      Number.isFinite(pending) && pending > 0
        ? `Your prescription${from} is ready — ${formatRupees(pending)} to pay at the pharmacy or online.`
        : `Your prescription${from} is ready. Collect your medicines at the pharmacy counter.`,
  };
}

export function medicineDeskMilestoneContent(
  milestone: MedicineDeskMilestone,
  details: MedicineDeskDetails = {}
): {
  title: string;
  body: string;
} {
  if (milestone === 'PRESCRIPTION_READY') return prescriptionReadyContent(details);
  return milestone === 'READY_TO_COLLECT'
    ? {
        title: 'Medicines ready to collect',
        body: 'Your medicines are ready at the pharmacy counter. Open Collect medicines in the app to get your code.',
      }
    : {
        title: 'Some medicines ready to collect',
        body: 'Part of your medicines is ready at the pharmacy counter. Open Collect medicines in the app to get your code.',
      };
}

/**
 * Remembers which (prescription, milestone) pairs were already notified, for `ttlMs`, so a
 * repeated event (retry, double emit) does not message the patient twice.
 */
export class MilestoneDedup {
  private readonly sentAt = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000
  ) {}

  /** True the first time the key is seen within the window (and records it). */
  firstTime(key: string, nowMs: number): boolean {
    const previous = this.sentAt.get(key);
    if (previous !== undefined && nowMs - previous < this.ttlMs) {
      return false;
    }
    if (this.sentAt.size >= this.maxEntries) {
      for (const [entryKey, at] of this.sentAt) {
        if (nowMs - at >= this.ttlMs) this.sentAt.delete(entryKey);
      }
      if (this.sentAt.size >= this.maxEntries) {
        const oldest = this.sentAt.keys().next().value;
        if (oldest !== undefined) this.sentAt.delete(oldest);
      }
    }
    this.sentAt.set(key, nowMs);
    return true;
  }
}
