/**
 * Undo no-show (contract 18.7), pure rules.
 *
 * M4 / B9: an undo must put the visit back exactly where it was: the status it had before the
 * no-show (CONFIRMED when the patient had checked in), the token stored on the appointment and
 * the place in the queue (the original arrival, ordered by token). The previous status is
 * recorded on the appointment metadata when the no-show is marked (`noShowMark`); an undo
 * records `noShowUndo`, which is how a repeated undo (200 alreadyRestored) is told apart from an
 * undo on a visit that was never a no-show (409, L3).
 */

export const NO_SHOW_MARK_KEY = 'noShowMark';
export const NO_SHOW_UNDO_KEY = 'noShowUndo';

export type RestoredStatus = 'CONFIRMED' | 'SCHEDULED';

export interface NoShowFacts {
  metadata?: unknown;
  checkedInAt?: Date | string | null;
  tokenNumber?: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Statuses a no-show can come from that mean "the patient had arrived". */
const ARRIVED_STATUSES: ReadonlySet<string> = new Set(['CONFIRMED', 'WAITING', 'CHECKED_IN']);

/** The status an undo restores: the recorded previous one, else arrival facts decide. */
export function resolveRestoredStatus(row: NoShowFacts): RestoredStatus {
  const mark = asRecord(asRecord(row.metadata)[NO_SHOW_MARK_KEY]);
  const previous = typeof mark['previousStatus'] === 'string' ? mark['previousStatus'] : '';
  if (previous) {
    return ARRIVED_STATUSES.has(previous.toUpperCase()) ? 'CONFIRMED' : 'SCHEDULED';
  }
  const arrived =
    Boolean(row.checkedInAt) || (typeof row.tokenNumber === 'number' && row.tokenNumber > 0);
  return arrived ? 'CONFIRMED' : 'SCHEDULED';
}

/** Metadata with the no-show mark (previous status, when) recorded. */
export function withNoShowMark(
  metadata: unknown,
  previousStatus: string,
  markedAt: Date
): Record<string, unknown> {
  return {
    ...asRecord(metadata),
    [NO_SHOW_MARK_KEY]: {
      previousStatus: previousStatus.toUpperCase(),
      markedAt: markedAt.toISOString(),
    },
  };
}

/** Metadata with the undo recorded (the mark is kept for the audit trail). */
export function withNoShowUndo(
  metadata: unknown,
  restoredStatus: RestoredStatus,
  undoneAt: Date,
  undoneBy: string
): Record<string, unknown> {
  return {
    ...asRecord(metadata),
    [NO_SHOW_UNDO_KEY]: { restoredStatus, undoneAt: undoneAt.toISOString(), undoneBy },
  };
}

/** True when this visit's no-show was undone (a repeated undo is a no-op, not a 409). */
export function wasNoShowUndone(metadata: unknown): boolean {
  const undo = asRecord(metadata)[NO_SHOW_UNDO_KEY];
  return Boolean(undo) && typeof undo === 'object';
}
