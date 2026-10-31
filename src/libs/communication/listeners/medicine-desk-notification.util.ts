/**
 * Patient notifications for medicine-desk changes (pure, no Nest imports).
 *
 * INT-03: every desk update (created, payment recorded, queue moved, status touched) used to
 * fan out to socket, push, email and WhatsApp for the patient and the doctor. Staff screens are
 * refreshed by the socket broadcaster on their own, so the patient is told only about the
 * milestones that need them at the counter: the medicines were dispensed (all, or part of
 * them), i.e. ready to collect. Each milestone is sent once per prescription.
 */

export type MedicineDeskMilestone = 'READY_TO_COLLECT' | 'PARTLY_READY_TO_COLLECT';

/** The milestone a desk update stands for, or null for a minor update (no patient message). */
export function medicineDeskMilestone(
  action: string | null | undefined
): MedicineDeskMilestone | null {
  const value = String(action ?? '').toUpperCase();
  if (value === 'DISPENSED') return 'READY_TO_COLLECT';
  if (value === 'PARTIALLY_DISPENSED') return 'PARTLY_READY_TO_COLLECT';
  return null;
}

export function medicineDeskMilestoneContent(milestone: MedicineDeskMilestone): {
  title: string;
  body: string;
} {
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
