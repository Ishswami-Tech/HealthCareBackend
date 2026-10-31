/**
 * Ayurveda list-query helpers
 * @module AyurvedaPatientFilter
 * @description Pure parsing of the `patientId` / `limit` / `offset` query parameters shared by the
 * Ayurveda list endpoints (Prakriti assessments, Nadi Pariksha, Dosha imbalance). Kept free of
 * Nest/Prisma imports so it can be unit-tested directly.
 */

/** Default page size when no limit (or an unusable one) is supplied. */
export const AYURVEDA_LIST_DEFAULT_LIMIT = 20;
/** Upper bound for a single page, so a clinic-wide recent list stays cheap. */
export const AYURVEDA_LIST_MAX_LIMIT = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATIENT_ROLE = 'PATIENT';

/** Outcome of parsing the `patientId` query parameter. */
export type AyurvedaPatientFilter =
  | { readonly kind: 'patient'; readonly patientId: string }
  | { readonly kind: 'clinic' }
  | { readonly kind: 'invalid' };

/** Minimal caller identity needed to scope a list. */
export interface AyurvedaListCaller {
  readonly id?: string | undefined;
  readonly role?: string | undefined;
}

/**
 * Resolves the patient scope of an Ayurveda list request.
 *
 * - A non-blank value must be a UUID (otherwise `invalid`, which callers answer with 400).
 * - A missing/blank value means "not provided": staff get the clinic-scoped recent list, while a
 *   PATIENT caller is always narrowed to their own records (never the clinic-wide list).
 */
export function resolveAyurvedaPatientFilter(
  rawPatientId: string | undefined,
  caller: AyurvedaListCaller
): AyurvedaPatientFilter {
  const trimmed = typeof rawPatientId === 'string' ? rawPatientId.trim() : '';

  if (trimmed.length > 0) {
    return UUID_PATTERN.test(trimmed)
      ? { kind: 'patient', patientId: trimmed }
      : { kind: 'invalid' };
  }

  if (caller.role === PATIENT_ROLE) {
    return caller.id ? { kind: 'patient', patientId: caller.id } : { kind: 'invalid' };
  }

  return { kind: 'clinic' };
}

/**
 * Parses a `limit` query value into a positive integer within [1, AYURVEDA_LIST_MAX_LIMIT].
 * Missing or non-numeric values fall back to the default.
 */
export function parseAyurvedaListLimit(rawLimit: string | undefined): number {
  const parsed = Number.parseInt(rawLimit ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return AYURVEDA_LIST_DEFAULT_LIMIT;
  }
  return Math.min(parsed, AYURVEDA_LIST_MAX_LIMIT);
}

/** Parses an `offset` query value into a non-negative integer (default 0). */
export function parseAyurvedaListOffset(rawOffset: string | undefined): number {
  const parsed = Number.parseInt(rawOffset ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
