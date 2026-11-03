/**
 * Pure helpers of the appointment analytics plugin. Nothing here is a demo value: an empty
 * window folds to zeros.
 */

const finite = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Known appointment priorities, every one present (0 when none) so a chart never guesses. */
export const APPOINTMENT_PRIORITY_KEYS = ['EMERGENCY', 'URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;

/**
 * Appointment counts per priority from a groupBy. A missing priority counts as NORMAL (the
 * column default); legacy MEDIUM is NORMAL too. Unknown values keep their own key.
 */
export function foldPriorityCounts(
  rows: ReadonlyArray<{ readonly priority: string | null; readonly count: number }>
): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(
    APPOINTMENT_PRIORITY_KEYS.map(key => [key, 0])
  );
  for (const row of rows) {
    const raw = String(row.priority ?? '')
      .trim()
      .toUpperCase();
    const key = raw === '' || raw === 'MEDIUM' ? 'NORMAL' : raw;
    result[key] = (result[key] ?? 0) + finite(row.count);
  }
  return result;
}
