/**
 * Which catalog services a patient can pick in the booking dialog, per clinic (product rule).
 * The value lives in the clinic's existing settings JSON, edited with `PUT /clinics/:id`:
 *
 *   appointmentSettings.bookableTreatmentTypes   string[] of TreatmentType
 *
 * Unknown or inactive values are ignored (aliases such as SURGERY resolve to their catalog entry);
 * a missing, empty or invalid list falls back to DEFAULT_PATIENT_BOOKABLE_TREATMENT_TYPES.
 * The catalog endpoint still returns every entry and only adds `bookable: boolean`, so existing
 * consumers (queue labels, clinic-admin schedule) keep working. Booking itself is not restricted:
 * staff flows may still create any catalog type. Pure, framework-free.
 */
import type { TreatmentType } from '@core/types/enums.types';
import {
  DEFAULT_PATIENT_BOOKABLE_TREATMENT_TYPES,
  findTreatmentCatalogEntryOrUndefined,
  type TreatmentCatalogEntry,
} from '@core/types/treatment-catalog.types';

export const BOOKABLE_TREATMENT_TYPES_SETTING_KEY = 'bookableTreatmentTypes';

export type BookableTreatmentCatalogEntry = TreatmentCatalogEntry & { bookable: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Clinic.settings` (whole JSON) or its `appointmentSettings` object -> the appointment settings. */
function appointmentSettingsOf(settings: unknown): Record<string, unknown> {
  if (!isRecord(settings)) return {};
  return isRecord(settings['appointmentSettings']) ? settings['appointmentSettings'] : settings;
}

/**
 * A raw list -> the canonical, de-duplicated treatment types of active catalog entries
 * (order kept). Anything that is not an array yields an empty list.
 */
export function normalizeBookableTreatmentTypes(value: unknown): TreatmentType[] {
  if (!Array.isArray(value)) return [];
  const result: TreatmentType[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    const entry = findTreatmentCatalogEntryOrUndefined(item);
    if (!entry || !entry.active || result.includes(entry.treatmentType)) continue;
    result.push(entry.treatmentType);
  }
  return result;
}

/** The bookable treatment types of a clinic. Accepts `Clinic.settings` as stored. */
export function resolveBookableTreatmentTypes(settings: unknown): Set<TreatmentType> {
  const configured = normalizeBookableTreatmentTypes(
    appointmentSettingsOf(settings)[BOOKABLE_TREATMENT_TYPES_SETTING_KEY]
  );
  return new Set(configured.length > 0 ? configured : DEFAULT_PATIENT_BOOKABLE_TREATMENT_TYPES);
}

/** Catalog entries -> new entries carrying `bookable` (inactive entries are never bookable). */
export function withBookableFlag(
  catalog: readonly TreatmentCatalogEntry[],
  settings: unknown
): BookableTreatmentCatalogEntry[] {
  const bookable = resolveBookableTreatmentTypes(settings);
  return catalog.map(entry => ({
    ...entry,
    bookable: entry.active && bookable.has(entry.treatmentType),
  }));
}

/**
 * Cleans `bookableTreatmentTypes` of an incoming `appointmentSettings` patch (PUT /clinics/:id):
 * an array is stored normalized (an empty result means "use the default list"), a non-array value
 * is dropped (the stored value stays), `null` is kept so the merge deletes the key.
 */
export function sanitizeBookableTreatmentTypesSetting(
  appointmentSettings: Record<string, unknown>
): Record<string, unknown> {
  const key = BOOKABLE_TREATMENT_TYPES_SETTING_KEY;
  if (!(key in appointmentSettings) || appointmentSettings[key] === null) {
    return appointmentSettings;
  }
  const next = { ...appointmentSettings };
  if (Array.isArray(next[key])) next[key] = normalizeBookableTreatmentTypes(next[key]);
  else delete next[key];
  return next;
}
