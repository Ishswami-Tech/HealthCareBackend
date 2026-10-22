/**
 * Did the assistant change a returned prescription draft? Compares the draft as the doctor
 * returned it (draftSnapshot written by returnDraft) with the draft now. Pure, unit-tested.
 *
 * Items are compared order-insensitively on the clinical fields; strings are trimmed and blank
 * equals null. A missing or unreadable snapshot counts as "changed" so an old draft is never
 * blocked by data we cannot compare.
 */

export interface DraftComparableItem {
  medicineId?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity?: number | null;
  instructions?: string | null;
}

export interface DraftComparable {
  diagnosis?: string | null;
  notes?: string | null;
  items?: readonly DraftComparableItem[] | null;
}

export const RESUBMIT_UNCHANGED_MESSAGE = 'Change the draft or add a note before resubmitting';

const text = (value: unknown): string | null => {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function itemKey(item: DraftComparableItem): string {
  return JSON.stringify([
    text(item.medicineId),
    text(item.dosage),
    text(item.frequency),
    text(item.duration),
    num(item.quantity),
    text(item.instructions),
  ]);
}

function itemsKey(items: readonly DraftComparableItem[] | null | undefined): string {
  return JSON.stringify((items ?? []).map(itemKey).sort());
}

function asComparable(snapshot: object | null | undefined): DraftComparable | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  if (!Array.isArray(record['items'])) return null;
  return {
    diagnosis: text(record['diagnosis']),
    notes: text(record['notes']),
    items: record['items'] as DraftComparableItem[],
  };
}

export function draftChangedSinceReturn(
  returnedSnapshot: object | null | undefined,
  current: DraftComparable
): boolean {
  const before = asComparable(returnedSnapshot);
  if (!before) return true;
  return (
    text(before.diagnosis) !== text(current.diagnosis) ||
    text(before.notes) !== text(current.notes) ||
    itemsKey(before.items) !== itemsKey(current.items)
  );
}
