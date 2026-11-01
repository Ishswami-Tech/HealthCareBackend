/**
 * Pure helpers of the paged prescription list (`GET /pharmacy/prescriptions?page=`) and the
 * prescription summary (`GET /pharmacy/prescriptions/summary`): status / pharmacy-stage mapping,
 * IST calendar-day windows, search and sort clauses, and folding the status counts. No database
 * access here; the reads live in prescription-list.queries.ts.
 */
import {
  PRESCRIPTION_LIST_ACTIVE_STATUS,
  PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE,
  PrescriptionListSort,
  PrescriptionPharmacyStage,
  PrescriptionStatus,
  type PrescriptionListStatus,
} from '@dtos/pharmacy.dto';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { istDayStart, type DateRange } from '@services/pharmacy/services/pharmacy-sales.util';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Prescriptions the pharmacy desk sees (no assistant-doctor drafts). */
export const PUBLISHED_PRESCRIPTION_STATUSES: readonly PrescriptionStatus[] = Object.freeze([
  PrescriptionStatus.PENDING,
  PrescriptionStatus.PARTIAL,
  PrescriptionStatus.FILLED,
  PrescriptionStatus.CANCELLED,
]);

export const DRAFT_PRESCRIPTION_STATUSES: readonly PrescriptionStatus[] = Object.freeze([
  PrescriptionStatus.DRAFT,
  PrescriptionStatus.RETURNED,
]);

/** Still at the medicine desk. */
export const ACTIVE_PRESCRIPTION_STATUSES: readonly PrescriptionStatus[] = Object.freeze([
  PrescriptionStatus.PENDING,
  PrescriptionStatus.PARTIAL,
]);

/** Filters of the paged list once the query DTO has been validated. */
export interface PrescriptionListFilters {
  readonly page: number;
  readonly limit: number;
  readonly q?: string;
  readonly status?: PrescriptionListStatus;
  readonly pharmacyStage?: PrescriptionPharmacyStage;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly patientId?: string;
  readonly sort?: PrescriptionListSort;
}

/** Whose prescriptions the caller may list. */
export interface PrescriptionListScope {
  readonly clinicId: string;
  /** Doctor.id of a DOCTOR caller (own prescriptions only); undefined = the whole clinic. */
  readonly doctorId?: string;
  /** DOCTOR / ASSISTANT_DOCTOR / CLINIC_ADMIN / SUPER_ADMIN may list DRAFT / RETURNED. */
  readonly allowDrafts: boolean;
  /**
   * PHARMACIST: only prescriptions with at least one medicine line. A note-only (advice /
   * diagnosis) prescription has nothing to dispense or hand over, so it never reaches the desk.
   */
  readonly medicinesOnly?: boolean;
}

/** Ids found by the side lookups the main where clause cannot express. */
export interface PrescriptionListLookups {
  /** Patients whose UHID / OPD number / contact phone matches `q`. */
  readonly searchPatientIds?: readonly string[];
  /**
   * PENDING prescriptions of the scope whose completed payments cover the medicine total
   * (or whose total is 0). Required when `pharmacyStage` is PAYMENT_PENDING / READY_TO_DISPENSE.
   */
  readonly readyPendingIds?: readonly string[];
  /**
   * Dispensed, paid, not-yet-collected prescriptions of the scope (any age, bounded). Required
   * when `pharmacyStage` is READY_TO_COLLECT.
   */
  readonly readyToCollectIds?: readonly string[];
}

export class PrescriptionListRangeError extends Error {}

type IdCondition = { in: string[] } | { notIn: string[] };

interface StatusClause {
  readonly status: PrescriptionStatus;
  readonly id?: IdCondition;
}

const MATCH_NOTHING = Object.freeze({ id: { in: [] as string[] } });

/** Statuses an explicit `status` filter selects (ACTIVE folds PENDING + PARTIAL). */
export function statusesForListStatus(status: PrescriptionListStatus): PrescriptionStatus[] {
  return status === PRESCRIPTION_LIST_ACTIVE_STATUS ? [...ACTIVE_PRESCRIPTION_STATUSES] : [status];
}

/** True when the stage is decided by payments vs the medicine total (needs readyPendingIds). */
export function stageNeedsPaymentLookup(stage?: PrescriptionPharmacyStage): boolean {
  return (
    stage === PrescriptionPharmacyStage.PAYMENT_PENDING ||
    stage === PrescriptionPharmacyStage.READY_TO_DISPENSE
  );
}

/** True when the stage is decided by the ready-to-collect lookup (needs readyToCollectIds). */
export function stageNeedsCollectLookup(stage?: PrescriptionPharmacyStage): boolean {
  return stage === PrescriptionPharmacyStage.READY_TO_COLLECT;
}

/** The id lookup a stage's clauses are built from (empty for stages decided by status alone). */
export function stageLookupIds(
  stage: PrescriptionPharmacyStage | undefined,
  lookups: PrescriptionListLookups
): readonly string[] {
  if (stageNeedsCollectLookup(stage)) return lookups.readyToCollectIds ?? [];
  return lookups.readyPendingIds ?? [];
}

/**
 * Mirrors the PHARMACY pill of the doctor screen (doctor-prescriptions.logic.ts `pharmacyState`):
 * FILLED -> dispensed; PENDING -> ready when the payments cover the total (canDispense), else
 * payment pending; DRAFT / RETURNED never reached the pharmacy. PARTIAL (partly dispensed,
 * the rest still to hand over) counts as ready to dispense. READY_TO_COLLECT is the counter's
 * hand-over list: the dispensed (FILLED / PARTIAL) rows the collect lookup found.
 *
 * `stageIds`: readyPendingIds for PAYMENT_PENDING / READY_TO_DISPENSE, readyToCollectIds for
 * READY_TO_COLLECT (see stageLookupIds).
 */
export function stageClauses(
  stage: PrescriptionPharmacyStage,
  stageIds: readonly string[] = []
): StatusClause[] {
  switch (stage) {
    case PrescriptionPharmacyStage.READY_TO_COLLECT:
      return [PrescriptionStatus.FILLED, PrescriptionStatus.PARTIAL].map(status => ({
        status,
        id: { in: [...stageIds] },
      }));
    case PrescriptionPharmacyStage.DISPENSED:
      return [{ status: PrescriptionStatus.FILLED }];
    case PrescriptionPharmacyStage.NOT_SENT:
      return DRAFT_PRESCRIPTION_STATUSES.map(status => ({ status }));
    case PrescriptionPharmacyStage.READY_TO_DISPENSE:
      return [
        { status: PrescriptionStatus.PARTIAL },
        { status: PrescriptionStatus.PENDING, id: { in: [...stageIds] } },
      ];
    case PrescriptionPharmacyStage.PAYMENT_PENDING:
      return [
        {
          status: PrescriptionStatus.PENDING,
          ...(stageIds.length > 0 ? { id: { notIn: [...stageIds] } } : {}),
        },
      ];
    default:
      return [];
  }
}

/** Statuses the caller may list at all. */
export function visibleStatuses(allowDrafts: boolean): PrescriptionStatus[] {
  return allowDrafts
    ? [...PUBLISHED_PRESCRIPTION_STATUSES, ...DRAFT_PRESCRIPTION_STATUSES]
    : [...PUBLISHED_PRESCRIPTION_STATUSES];
}

/**
 * The status part of the where clause. With neither `status` nor `pharmacyStage` the list keeps
 * the legacy rule (drafts excluded for everyone); an explicit DRAFT / RETURNED / NOT_SENT only
 * matches for roles that may see drafts and matches nothing otherwise.
 */
export function buildStatusCondition(
  filters: Pick<PrescriptionListFilters, 'status' | 'pharmacyStage'>,
  allowDrafts: boolean,
  stageIds: readonly string[] = []
): Record<string, unknown> {
  if (!filters.status && !filters.pharmacyStage) {
    return { status: { in: [...PUBLISHED_PRESCRIPTION_STATUSES] } };
  }
  const visible = new Set(visibleStatuses(allowDrafts));
  const wanted = filters.status ? new Set(statusesForListStatus(filters.status)) : null;
  const candidates: StatusClause[] = filters.pharmacyStage
    ? stageClauses(filters.pharmacyStage, stageIds)
    : [...visible].map(status => ({ status }));
  const clauses = candidates.filter(
    clause => visible.has(clause.status) && (!wanted || wanted.has(clause.status))
  );
  if (clauses.length === 0) {
    return { ...MATCH_NOTHING };
  }
  if (clauses.every(clause => !clause.id)) {
    return { status: { in: clauses.map(clause => clause.status) } };
  }
  return {
    OR: clauses.map(clause => ({ status: clause.status, ...(clause.id ? { id: clause.id } : {}) })),
  };
}

/** True for a real calendar day key (YYYY-MM-DD); rejects 2026-02-31. */
export function isIstDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const start = istDayStart(value);
  return !Number.isNaN(start.getTime()) && formatDateKeyInIST(start) === value;
}

/**
 * `dateFrom` .. `dateTo` as IST calendar days, inclusive: from IST midnight of `dateFrom` up to
 * (not including) IST midnight after `dateTo`. Either end may be open.
 */
export function istDayRange(dateFrom?: string, dateTo?: string): Partial<DateRange> {
  for (const [name, value] of [
    ['dateFrom', dateFrom],
    ['dateTo', dateTo],
  ] as const) {
    if (value !== undefined && !isIstDayKey(value)) {
      throw new PrescriptionListRangeError(`${name} must be a valid calendar day (YYYY-MM-DD)`);
    }
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new PrescriptionListRangeError('dateFrom must be on or before dateTo');
  }
  return {
    ...(dateFrom ? { from: istDayStart(dateFrom) } : {}),
    ...(dateTo ? { to: new Date(istDayStart(dateTo).getTime() + DAY_MS) } : {}),
  };
}

/** Today (IST) as a range, for the summary's `today`. */
export function istTodayRange(now: Date = new Date()): DateRange {
  const from = istDayStart(formatDateKeyInIST(now));
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** Prisma `date` filter of a range; undefined when both ends are open. */
export function dateCondition(range: Partial<DateRange>): Record<string, Date> | undefined {
  if (!range.from && !range.to) {
    return undefined;
  }
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lt: range.to } : {}),
  };
}

/** Clinic / doctor / patient / date part shared by the list, its count and the summary. */
export function buildScopeWhere(
  scope: PrescriptionListScope,
  range: Partial<DateRange>,
  patientId?: string
): Record<string, unknown> {
  const date = dateCondition(range);
  return {
    clinicId: scope.clinicId,
    ...(scope.doctorId ? { doctorId: scope.doctorId } : {}),
    ...(patientId ? { patientId } : {}),
    ...(date ? { date } : {}),
    ...(scope.medicinesOnly ? { items: { some: {} } } : {}),
  };
}

/** `q` over patient name / phone, prescription number, diagnosis, medicine names and the ids found by the side lookups. */
export function buildSearchCondition(
  q: string,
  searchPatientIds: readonly string[] = []
): Record<string, unknown> {
  const insensitive = { contains: q, mode: 'insensitive' };
  return {
    OR: [
      { patient: { user: { name: insensitive } } },
      { patient: { user: { phone: { contains: q } } } },
      { prescriptionNumber: insensitive },
      { diagnosis: insensitive },
      { items: { some: { medicine: { name: insensitive } } } },
      ...(searchPatientIds.length > 0 ? [{ patientId: { in: [...searchPatientIds] } }] : []),
    ],
  };
}

/** Complete where clause of the paged list (and its count). */
export function buildPrescriptionListWhere(
  filters: PrescriptionListFilters,
  scope: PrescriptionListScope,
  lookups: PrescriptionListLookups = {}
): Record<string, unknown> {
  const range = istDayRange(filters.dateFrom, filters.dateTo);
  const q = filters.q?.trim();
  const and: Record<string, unknown>[] = [
    buildStatusCondition(
      filters,
      scope.allowDrafts,
      stageLookupIds(filters.pharmacyStage, lookups)
    ),
    ...(q ? [buildSearchCondition(q, lookups.searchPatientIds)] : []),
  ];
  return { ...buildScopeWhere(scope, range, filters.patientId), AND: and };
}

/** Stable order (id breaks ties so pages never overlap). */
export function prescriptionListOrderBy(
  sort: PrescriptionListSort = PrescriptionListSort.NEWEST
): Record<string, unknown>[] {
  switch (sort) {
    case PrescriptionListSort.OLDEST:
      return [{ date: 'asc' }, { id: 'asc' }];
    case PrescriptionListSort.PATIENT:
      return [{ patient: { user: { name: 'asc' } } }, { date: 'desc' }, { id: 'desc' }];
    case PrescriptionListSort.NEWEST:
    default:
      return [{ date: 'desc' }, { id: 'desc' }];
  }
}

/** skip / take of a 1-based page. */
export function pageWindow(
  page: number,
  limit: number = PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE
): { skip: number; take: number } {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  return { skip: (safePage - 1) * limit, take: limit };
}

export interface PrescriptionSummary {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  drafts: number;
  today: number;
  uniquePatients: number;
}

export interface StatusCountRow {
  readonly status: string;
  readonly _count: { readonly _all: number } | number;
}

function countOf(row: StatusCountRow): number {
  return typeof row._count === 'number' ? row._count : Number(row._count._all || 0);
}

/** Folds a `groupBy(['status'])` result into the summary counters. */
export function foldStatusCounts(
  rows: readonly StatusCountRow[],
  allowDrafts: boolean
): Pick<PrescriptionSummary, 'total' | 'active' | 'completed' | 'cancelled' | 'drafts'> {
  const byStatus = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status).toUpperCase();
    byStatus.set(status, (byStatus.get(status) ?? 0) + countOf(row));
  }
  const sum = (statuses: readonly PrescriptionStatus[]): number =>
    statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);
  return {
    total: sum(PUBLISHED_PRESCRIPTION_STATUSES),
    active: sum(ACTIVE_PRESCRIPTION_STATUSES),
    completed: sum([PrescriptionStatus.FILLED]),
    cancelled: sum([PrescriptionStatus.CANCELLED]),
    drafts: allowDrafts ? sum(DRAFT_PRESCRIPTION_STATUSES) : 0,
  };
}
