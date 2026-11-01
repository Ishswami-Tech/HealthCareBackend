/**
 * Database reads behind the paged prescription list and the prescription summary. Everything is
 * clinic scoped (and doctor scoped for a DOCTOR caller); the where clauses come from
 * prescription-list.util.ts.
 */
import type { DatabaseService } from '@infrastructure/database';
import type { DateRange } from '@services/pharmacy/services/pharmacy-sales.util';
import {
  buildPrescriptionListWhere,
  buildScopeWhere,
  foldStatusCounts,
  istDayRange,
  istTodayRange,
  pageWindow,
  prescriptionListOrderBy,
  PUBLISHED_PRESCRIPTION_STATUSES,
  stageNeedsCollectLookup,
  stageNeedsPaymentLookup,
  type PrescriptionListFilters,
  type PrescriptionListScope,
  type PrescriptionSummary,
  type StatusCountRow,
} from '@services/pharmacy/services/prescription-list.util';

/** Most patients one side lookup (UHID / OPD number / phone) may contribute to a search. */
export const MAX_SEARCH_PATIENT_IDS = 500;

/** Most uncollected prescriptions the READY_TO_COLLECT stage reaches (newest first). */
export const MAX_READY_TO_COLLECT_IDS = 2000;

const PAYMENT_FOR_PRESCRIPTION_DISPENSE = 'PRESCRIPTION_DISPENSE';

interface PatientIdRow {
  readonly patientId: string;
}

interface FindManyDelegate<Row> {
  findMany: (args: object) => Promise<Row[]>;
}

/** The slice of the Prisma client these reads use. */
export interface PrescriptionListClient {
  prescription: FindManyDelegate<PrescriptionPageRow> & {
    count: (args: object) => Promise<number>;
    groupBy: (args: object) => Promise<StatusCountRow[]>;
  };
  doctor: { findUnique: (args: object) => Promise<{ id: string } | null> };
  patientIdentifier?: FindManyDelegate<PatientIdRow>;
  patientVisit?: FindManyDelegate<PatientIdRow>;
  patientContactPoint?: FindManyDelegate<PatientIdRow>;
  $queryRawUnsafe: <T>(sql: string, ...values: Array<string | number>) => Promise<T>;
}

/** A row of the list: the same shape the legacy list loads (see `include`). */
export interface PrescriptionPageRow {
  readonly id: string;
  readonly clinicId: string;
  readonly [key: string]: object | string | number | boolean | null | undefined;
}

export interface PrescriptionPageResult {
  readonly rows: PrescriptionPageRow[];
  readonly total: number;
}

/** `timestamp(3) without time zone` literal of a UTC instant (Prisma stores UTC wall time). */
function timestampParam(date: Date): string {
  return date.toISOString().replace('Z', '');
}

/** Raw-SQL predicates (and their params) for the clinic / doctor / patient / date scope. */
function rawScope(
  alias: string,
  scope: PrescriptionListScope,
  range: Partial<DateRange>,
  patientId?: string
): { sql: string; params: string[] } {
  const params: string[] = [scope.clinicId];
  const parts = [`${alias}."clinicId" = $1`];
  const add = (predicate: (placeholder: string) => string, value: string): void => {
    params.push(value);
    parts.push(predicate(`$${params.length}`));
  };
  if (scope.doctorId) add(p => `${alias}."doctorId" = ${p}`, scope.doctorId);
  if (patientId) add(p => `${alias}."patientId" = ${p}`, patientId);
  if (range.from) add(p => `${alias}."date" >= ${p}::timestamp(3)`, timestampParam(range.from));
  if (range.to) add(p => `${alias}."date" < ${p}::timestamp(3)`, timestampParam(range.to));
  if (scope.medicinesOnly) {
    parts.push(
      `EXISTS (SELECT 1 FROM "PrescriptionItem" it0 WHERE it0."prescriptionId" = ${alias}.id)`
    );
  }
  return { sql: parts.join(' AND '), params };
}

/**
 * PENDING prescriptions of the scope that are ready to dispense: the COMPLETED prescription
 * payments cover the medicine total (sum of quantity x price, both rounded to paise like
 * `buildPrescriptionPaymentState`), or the total is 0. One aggregate query, no rows loaded.
 */
export async function findReadyPendingPrescriptionIds(
  db: PrescriptionListClient,
  scope: PrescriptionListScope,
  range: Partial<DateRange>,
  patientId?: string
): Promise<string[]> {
  const where = rawScope('rx', scope, range, patientId);
  const sql = `
    WITH totals AS (
      SELECT rx.id, COALESCE(SUM(it.quantity * COALESCE(m.price, 0)), 0) AS total
      FROM "Prescription" rx
      LEFT JOIN "PrescriptionItem" it ON it."prescriptionId" = rx.id
      LEFT JOIN "Medicine" m ON m.id = it."medicineId"
      WHERE ${where.sql} AND rx.status = 'PENDING'
      GROUP BY rx.id
    ), paid AS (
      SELECT pay.metadata->>'prescriptionId' AS pid, SUM(pay.amount) AS paid
      FROM "Payment" pay
      WHERE pay."clinicId" = $1
        AND pay.status = 'COMPLETED'
        AND pay.metadata->>'paymentFor' = '${PAYMENT_FOR_PRESCRIPTION_DISPENSE}'
        AND pay.metadata->>'prescriptionId' IN (SELECT id FROM totals)
      GROUP BY 1
    )
    SELECT t.id FROM totals t LEFT JOIN paid p ON p.pid = t.id
    WHERE ROUND(t.total::numeric, 2) <= ROUND(COALESCE(p.paid, 0)::numeric, 2)`;
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(sql, ...where.params);
  return rows.map(row => row.id);
}

/**
 * Prescriptions of the scope waiting at the counter, at ANY age (the legacy list only reaches the
 * newest 200): has medicines, dispensed (FILLED, or PARTIAL with units dispensed), paid like
 * `checkHandoverReadiness` (COMPLETED payments linked to it cover the total, the PHARMACY invoice
 * is PAID, or the total is 0), and no HANDED_OVER hand-over. Newest first, at most
 * MAX_READY_TO_COLLECT_IDS (the page then pages over these ids).
 */
export async function findReadyToCollectPrescriptionIds(
  db: PrescriptionListClient,
  scope: PrescriptionListScope,
  range: Partial<DateRange>,
  patientId?: string
): Promise<string[]> {
  const where = rawScope('rx', scope, range, patientId);
  const sql = `
    WITH dispensed AS (
      SELECT rx.id, rx.status, rx.date,
        COALESCE(SUM(it.quantity * COALESCE(m.price, 0)), 0) AS total,
        COALESCE(SUM(GREATEST(it."dispensedQuantity", 0)), 0) AS units,
        COUNT(it.id) AS lines
      FROM "Prescription" rx
      LEFT JOIN "PrescriptionItem" it ON it."prescriptionId" = rx.id
      LEFT JOIN "Medicine" m ON m.id = it."medicineId"
      WHERE ${where.sql} AND rx.status IN ('FILLED', 'PARTIAL')
      GROUP BY rx.id, rx.status, rx.date
    ), paid AS (
      SELECT pay.metadata->>'prescriptionId' AS pid, SUM(pay.amount) AS paid
      FROM "Payment" pay
      WHERE pay."clinicId" = $1
        AND pay.status = 'COMPLETED'
        AND pay.metadata->>'prescriptionId' IN (SELECT id FROM dispensed)
      GROUP BY 1
    )
    SELECT d.id FROM dispensed d LEFT JOIN paid p ON p.pid = d.id
    WHERE d.lines > 0
      AND (d.status = 'FILLED' OR d.units > 0)
      AND (
        ROUND(d.total::numeric, 2) <= ROUND(COALESCE(p.paid, 0)::numeric, 2)
        OR EXISTS (
          SELECT 1 FROM "Invoice" inv
          WHERE inv."prescriptionId" = d.id AND inv."clinicId" = $1
            AND inv."billType" = 'PHARMACY' AND inv.status = 'PAID'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "dispense_handovers" h
        WHERE h."prescriptionId" = d.id AND h."clinicId" = $1 AND h.status = 'HANDED_OVER'
      )
    ORDER BY d.date DESC, d.id DESC
    LIMIT ${MAX_READY_TO_COLLECT_IDS}`;
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(sql, ...where.params);
  return rows.map(row => row.id);
}

/** Patients of the clinic whose UHID, OPD number or contact phone contains `q`. */
export async function findSearchPatientIds(
  db: PrescriptionListClient,
  clinicId: string,
  q: string
): Promise<string[]> {
  const insensitive = { contains: q, mode: 'insensitive' };
  const lookup = (
    delegate: FindManyDelegate<PatientIdRow> | undefined,
    where: object
  ): Promise<PatientIdRow[]> =>
    delegate
      ? delegate.findMany({ where, select: { patientId: true }, take: MAX_SEARCH_PATIENT_IDS })
      : Promise.resolve([]);
  const groups = await Promise.all([
    lookup(db.patientIdentifier, { clinicId, value: insensitive }),
    lookup(db.patientVisit, { clinicId, opdNumber: insensitive }),
    lookup(db.patientContactPoint, { clinicId, system: 'phone', value: { contains: q } }),
  ]);
  return Array.from(new Set(groups.flat().map(row => row.patientId)));
}

/** Doctor.id of a doctor user; null when the user has no doctor profile. */
export async function findDoctorIdOfUser(
  databaseService: DatabaseService,
  userId: string
): Promise<string | null> {
  return await databaseService.executeHealthcareRead(async client => {
    const db = client as unknown as PrescriptionListClient;
    const doctor = await db.doctor.findUnique({ where: { userId }, select: { id: true } });
    return doctor?.id ?? null;
  });
}

/** One page of prescriptions plus the matching total (count and page run together). */
export async function loadPrescriptionPage(
  databaseService: DatabaseService,
  scope: PrescriptionListScope,
  filters: PrescriptionListFilters,
  include: object
): Promise<PrescriptionPageResult> {
  const range = istDayRange(filters.dateFrom, filters.dateTo);
  return await databaseService.executeHealthcareRead(async client => {
    const db = client as unknown as PrescriptionListClient;
    const q = filters.q?.trim();
    const [searchPatientIds, readyPendingIds, readyToCollectIds] = await Promise.all([
      q ? findSearchPatientIds(db, scope.clinicId, q) : Promise.resolve([]),
      stageNeedsPaymentLookup(filters.pharmacyStage)
        ? findReadyPendingPrescriptionIds(db, scope, range, filters.patientId)
        : Promise.resolve([]),
      stageNeedsCollectLookup(filters.pharmacyStage)
        ? findReadyToCollectPrescriptionIds(db, scope, range, filters.patientId)
        : Promise.resolve([]),
    ]);
    const where = buildPrescriptionListWhere(filters, scope, {
      searchPatientIds,
      readyPendingIds,
      readyToCollectIds,
    });
    const { skip, take } = pageWindow(filters.page, filters.limit);
    const [total, rows] = await Promise.all([
      db.prescription.count({ where }),
      db.prescription.findMany({
        where,
        include,
        orderBy: prescriptionListOrderBy(filters.sort),
        skip,
        take,
      }),
    ]);
    return { rows, total };
  });
}

/** Status counts, today's count and distinct patients, all computed by the database. */
export async function loadPrescriptionSummary(
  databaseService: DatabaseService,
  scope: PrescriptionListScope,
  dates: { readonly dateFrom?: string; readonly dateTo?: string },
  now: Date = new Date()
): Promise<PrescriptionSummary> {
  const range = istDayRange(dates.dateFrom, dates.dateTo);
  const published = { status: { in: [...PUBLISHED_PRESCRIPTION_STATUSES] } };
  return await databaseService.executeHealthcareRead(async client => {
    const db = client as unknown as PrescriptionListClient;
    const distinct = rawScope('rx', scope, range);
    const [statusRows, today, distinctRows] = await Promise.all([
      db.prescription.groupBy({
        by: ['status'],
        where: buildScopeWhere(scope, range),
        _count: { _all: true },
      }),
      db.prescription.count({
        where: { ...buildScopeWhere(scope, istTodayRange(now)), ...published },
      }),
      db.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(DISTINCT rx."patientId")::int AS count FROM "Prescription" rx
         WHERE ${distinct.sql} AND rx.status IN (${PUBLISHED_PRESCRIPTION_STATUSES.map(
           status => `'${status}'`
         ).join(', ')})`,
        ...distinct.params
      ),
    ]);
    return {
      ...foldStatusCounts(statusRows, scope.allowDrafts),
      today,
      uniquePatients: Number(distinctRows[0]?.count ?? 0),
    };
  });
}
