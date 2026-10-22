/**
 * Bounded legacy (no `page`) prescription list (pure, no Nest imports).
 *
 * GET /pharmacy/prescriptions without `page` used to return EVERY prescription of the clinic
 * (4 relation includes + payment enrichment over the whole result) and mobile polls it every
 * 30s. Old clients still get the bare array, but only the most recent
 * LEGACY_PRESCRIPTION_LIST_LIMIT rows, newest first; X-Total-Count / X-Truncated tell a client
 * that wants more to switch to `?page=`.
 */

/** Most recent prescriptions returned by the legacy list. */
export const LEGACY_PRESCRIPTION_LIST_LIMIT = 200;

/** Prescription statuses that sit in the medicine-desk queue (see isOffMedicineDesk). */
export const MEDICINE_DESK_ACTIVE_STATUSES = ['PENDING', 'PARTIAL'] as const;

export interface LegacyPrescriptionWindow<T> {
  readonly rows: T[];
  readonly truncated: boolean;
}

export interface LegacyPrescriptionList<T> {
  readonly data: T[];
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * The query asks for `limit + 1` rows: an extra row means there are more than `limit`, so the
 * (costlier) count only runs when the window is actually truncated.
 */
export function sliceLegacyPrescriptionWindow<T>(
  fetched: readonly T[],
  limit: number = LEGACY_PRESCRIPTION_LIST_LIMIT
): LegacyPrescriptionWindow<T> {
  const safeLimit = Math.max(1, Math.floor(limit));
  if (fetched.length <= safeLimit) {
    return { rows: [...fetched], truncated: false };
  }
  return { rows: fetched.slice(0, safeLimit), truncated: true };
}

/** Response headers of the legacy list (the cache replays the body only). */
export function legacyPrescriptionListHeaders(
  list: Pick<LegacyPrescriptionList<unknown>, 'total' | 'truncated'>
): Readonly<Record<'X-Total-Count' | 'X-Truncated', string>> {
  return {
    'X-Total-Count': String(Math.max(0, list.total)),
    'X-Truncated': list.truncated ? 'true' : 'false',
  };
}
