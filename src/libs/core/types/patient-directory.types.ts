/**
 * Patient directory: the staff-facing, searchable, filterable, paged list of a clinic's patients.
 * Built for tens of thousands of patients, so every filter and the paging run in the database.
 */

/** Page sizes the directory offers; anything else is rejected, so one request cannot pull the clinic. */
export const PATIENT_DIRECTORY_PAGE_SIZES = [10, 50, 200, 500] as const;
export type PatientDirectoryPageSize = (typeof PATIENT_DIRECTORY_PAGE_SIZES)[number];
export const PATIENT_DIRECTORY_DEFAULT_PAGE_SIZE: PatientDirectoryPageSize = 50;

export const PATIENT_DIRECTORY_SORT_FIELDS = [
  'name',
  'registered',
  'lastVisit',
  'firstVisit',
  'visits',
] as const;
export type PatientDirectorySortField = (typeof PATIENT_DIRECTORY_SORT_FIELDS)[number];
export type PatientDirectorySortOrder = 'asc' | 'desc';

export const PATIENT_DIRECTORY_GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type PatientDirectoryGender = (typeof PATIENT_DIRECTORY_GENDERS)[number];

/** What a free-text search term was recognised as. */
export type PatientSearchKind = 'uhid' | 'legacy' | 'opd' | 'phone' | 'email' | 'name';

export interface PatientSearchTerm {
  readonly kind: PatientSearchKind;
  /** Normalised value to match: upper-cased UHID, digits only for a phone, lower-cased name tokens. */
  readonly value: string;
  /** Name tokens; only set for `name`. */
  readonly tokens?: readonly string[];
}

export interface PatientDirectoryFilters {
  readonly search?: PatientSearchTerm;
  readonly gender?: PatientDirectoryGender;
  readonly ageMin?: number;
  readonly ageMax?: number;
  readonly city?: string;
  readonly state?: string;
  readonly referenceSource?: string;
  /** First and last day (inclusive, YYYY-MM-DD, India time) of a case/visit date range. */
  readonly caseDateFrom?: string;
  readonly caseDateTo?: string;
  readonly hasMobile?: boolean;
  readonly hasDiagnosis?: boolean;
  readonly minVisits?: number;
}

export interface PatientDirectoryQuery {
  readonly clinicId: string;
  readonly filters: PatientDirectoryFilters;
  readonly sort: PatientDirectorySortField;
  readonly order: PatientDirectorySortOrder;
  readonly page: number;
  readonly pageSize: PatientDirectoryPageSize;
}

export interface PatientDirectoryRow {
  readonly patientId: string;
  readonly userId: string;
  readonly name: string;
  readonly gender: string | null;
  readonly age: number | null;
  readonly dateOfBirth: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly uhid: string | null;
  readonly legacyRegistration: string | null;
  readonly totalVisits: number;
  readonly firstVisit: string | null;
  readonly lastVisit: string | null;
  readonly referenceSource: string | null;
  readonly registeredAt: string;
}

export interface PatientDirectoryPage {
  readonly rows: readonly PatientDirectoryRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: PatientDirectoryPageSize;
  readonly totalPages: number;
}

export interface PatientDirectoryFacetValue {
  readonly value: string;
  readonly count: number;
}

/** The values a filter UI can offer, so staff pick from what exists instead of typing. */
export interface PatientDirectoryFacets {
  readonly cities: readonly PatientDirectoryFacetValue[];
  readonly states: readonly PatientDirectoryFacetValue[];
  readonly referenceSources: readonly PatientDirectoryFacetValue[];
  readonly caseYears: readonly PatientDirectoryFacetValue[];
}
