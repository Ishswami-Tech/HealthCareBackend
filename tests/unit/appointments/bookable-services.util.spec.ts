/**
 * Patient-bookable services per clinic (clinic settings JSON, no new table): the booking dialog
 * shows only catalog entries flagged `bookable`. src/libs/utils/bookable-services.util.ts
 */
import { describe, expect, it } from '@jest/globals';
import {
  BOOKABLE_TREATMENT_TYPES_SETTING_KEY,
  normalizeBookableTreatmentTypes,
  resolveBookableTreatmentTypes,
  sanitizeBookableTreatmentTypesSetting,
  withBookableFlag,
} from '@utils/bookable-services.util';
import {
  APPOINTMENT_SERVICE_CATALOG,
  DEFAULT_PATIENT_BOOKABLE_TREATMENT_TYPES,
  getAppointmentTreatmentCatalog,
} from '@core/types/treatment-catalog.types';
import { TreatmentType } from '@core/types/enums.types';

const DEFAULT_SET = [
  TreatmentType.GENERAL_CONSULTATION,
  TreatmentType.FOLLOW_UP,
  TreatmentType.SPECIAL_CASE,
  TreatmentType.GERIATRIC_CARE,
];

const sorted = (values: Iterable<TreatmentType>): string[] => [...values].map(String).sort();

describe('bookable services resolution', () => {
  it('default list is the four consultation services', () => {
    expect(sorted(DEFAULT_PATIENT_BOOKABLE_TREATMENT_TYPES)).toEqual(sorted(DEFAULT_SET));
  });

  it('no settings, no appointmentSettings, no key -> default list', () => {
    for (const settings of [undefined, null, 'x', {}, { appointmentSettings: {} }]) {
      expect(sorted(resolveBookableTreatmentTypes(settings))).toEqual(sorted(DEFAULT_SET));
    }
  });

  it('empty or invalid list -> default list', () => {
    for (const value of [[], 'GENERAL_CONSULTATION', 42, { a: 1 }, ['NOPE', '', 7, null]]) {
      const settings = { appointmentSettings: { [BOOKABLE_TREATMENT_TYPES_SETTING_KEY]: value } };
      expect(sorted(resolveBookableTreatmentTypes(settings))).toEqual(sorted(DEFAULT_SET));
    }
  });

  it('a clinic list overrides the default; unknown values are ignored, case-insensitive', () => {
    const settings = {
      appointmentSettings: {
        bookableTreatmentTypes: ['general_consultation', 'THERAPY', 'NOT_A_TYPE'],
      },
    };
    expect(sorted(resolveBookableTreatmentTypes(settings))).toEqual(
      sorted([TreatmentType.GENERAL_CONSULTATION, TreatmentType.THERAPY])
    );
  });

  it('accepts the appointmentSettings object directly', () => {
    expect(
      sorted(resolveBookableTreatmentTypes({ bookableTreatmentTypes: ['FOLLOW_UP'] }))
    ).toEqual([TreatmentType.FOLLOW_UP]);
  });

  it('aliases resolve to their catalog entry and duplicates collapse', () => {
    expect(
      normalizeBookableTreatmentTypes(['SURGERY', 'THERAPY', 'FOLLOW_UP', 'FOLLOW_UP'])
    ).toEqual([TreatmentType.THERAPY, TreatmentType.FOLLOW_UP]);
  });
});

describe('withBookableFlag', () => {
  it('keeps every catalog entry and flags exactly the default four', () => {
    const services = withBookableFlag(getAppointmentTreatmentCatalog(), undefined);
    expect(services).toHaveLength(APPOINTMENT_SERVICE_CATALOG.length);
    expect(sorted(services.filter(s => s.bookable).map(s => s.treatmentType))).toEqual(
      sorted(DEFAULT_SET)
    );
    expect(services.every(s => typeof s.bookable === 'boolean')).toBe(true);
  });

  it('follows the clinic list and does not mutate the catalog', () => {
    const catalog = getAppointmentTreatmentCatalog();
    const services = withBookableFlag(catalog, {
      appointmentSettings: { bookableTreatmentTypes: ['SPECIAL_CASE'] },
    });
    expect(services.filter(s => s.bookable).map(s => s.treatmentType)).toEqual([
      TreatmentType.SPECIAL_CASE,
    ]);
    expect(catalog.some(entry => 'bookable' in entry)).toBe(false);
  });

  it('inactive entries are never bookable', () => {
    const catalog = getAppointmentTreatmentCatalog().map(entry =>
      entry.treatmentType === TreatmentType.FOLLOW_UP ? { ...entry, active: false } : entry
    );
    const followUp = withBookableFlag(catalog, undefined).find(
      s => s.treatmentType === TreatmentType.FOLLOW_UP
    );
    expect(followUp?.bookable).toBe(false);
  });
});

describe('sanitizeBookableTreatmentTypesSetting (PUT /clinics/:id)', () => {
  it('normalizes an array, drops a non-array, keeps null and absent keys', () => {
    expect(
      sanitizeBookableTreatmentTypesSetting({
        bookableTreatmentTypes: ['follow_up', 'BAD', 'FOLLOW_UP'],
        other: 1,
      })
    ).toEqual({ bookableTreatmentTypes: [TreatmentType.FOLLOW_UP], other: 1 });
    expect(sanitizeBookableTreatmentTypesSetting({ bookableTreatmentTypes: 'x' })).toEqual({});
    expect(sanitizeBookableTreatmentTypesSetting({ bookableTreatmentTypes: null })).toEqual({
      bookableTreatmentTypes: null,
    });
    const untouched = { inPersonDurationMinutes: 5 };
    expect(sanitizeBookableTreatmentTypesSetting(untouched)).toBe(untouched);
  });
});
