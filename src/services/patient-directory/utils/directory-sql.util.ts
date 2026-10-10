import type {
  PatientDirectoryFilters,
  PatientDirectoryQuery,
  PatientDirectorySortField,
  PatientDirectorySortOrder,
} from '@core/types/patient-directory.types';
import { escapeLike } from './directory-search.util';

/**
 * SQL for the patient directory. The text is assembled only from constants in this file; every value
 * a person can influence (clinic, search text, filters, page) travels as a bound parameter, so the
 * query cannot be changed by what is typed into the search box.
 *
 * Only named columns are selected: never `users.*`, so a credential column can never reach a response.
 */

export interface DirectorySql {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Case dates are calendar days in India; the database stores UTC. */
const IST_OFFSET = `interval '5 hours 30 minutes'`;

const NAME_EXPRESSION = `lower(coalesce(m.name, concat_ws(' ', m."firstName", m."lastName")))`;

/** Whitelisted ORDER BY expressions; the sort never comes from request text directly. */
const SORT_EXPRESSIONS: Readonly<Record<PatientDirectorySortField, string>> = {
  name: NAME_EXPRESSION,
  registered: 'm.registered_at',
  lastVisit: 'm.last_visit',
  firstVisit: 'm.first_visit',
  visits: 'm.visits',
};

class ParamList {
  private readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  toArray(): readonly unknown[] {
    return this.values;
  }
}

/** Patients that belong to the clinic: primary clinic, an identifier issued there, or an appointment. */
const SCOPE = (clinic: string): string => `(
  u."primaryClinicId" = ${clinic}
  OR EXISTS (SELECT 1 FROM patient_identifiers i WHERE i."patientId" = p.id AND i."clinicId" = ${clinic})
  OR EXISTS (SELECT 1 FROM "Appointment" a WHERE a."patientId" = p.id AND a."clinicId" = ${clinic})
)`;

const HAS_PHONE = (clinic: string): string => `(
  u.phone IS NOT NULL
  OR EXISTS (SELECT 1 FROM patient_contact_points c
             WHERE c."patientId" = p.id AND c."clinicId" = ${clinic} AND c.system = 'phone')
)`;

function searchCondition(
  filters: PatientDirectoryFilters,
  clinic: string,
  params: ParamList
): string[] {
  const term = filters.search;
  if (!term) return [];

  switch (term.kind) {
    case 'uhid':
    case 'legacy': {
      const system = term.kind === 'uhid' ? 'UHID' : 'LEGACY_REGISTRATION';
      return [
        `EXISTS (SELECT 1 FROM patient_identifiers i WHERE i."patientId" = p.id
           AND i."clinicId" = ${clinic} AND i.system = '${system}' AND i.value = ${params.add(term.value)})`,
      ];
    }
    case 'opd': {
      const pattern = `%${escapeLike(term.value)}%`;
      return [
        `EXISTS (SELECT 1 FROM patient_visits v WHERE v."patientId" = p.id
           AND v."clinicId" = ${clinic} AND v."opdNumber" ILIKE ${params.add(pattern)} ESCAPE '\\')`,
      ];
    }
    case 'phone': {
      const pattern = `%${escapeLike(term.value)}%`;
      const ref = params.add(pattern);
      return [
        `(u.phone LIKE ${ref} ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM patient_contact_points c WHERE c."patientId" = p.id
             AND c."clinicId" = ${clinic} AND c.system = 'phone' AND c.value LIKE ${ref} ESCAPE '\\'))`,
      ];
    }
    case 'email': {
      const ref = params.add(`%${escapeLike(term.value)}%`);
      return [
        `(lower(u.email) LIKE ${ref} ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM patient_contact_points c WHERE c."patientId" = p.id
             AND c."clinicId" = ${clinic} AND c.system = 'email' AND lower(c.value) LIKE ${ref} ESCAPE '\\'))`,
      ];
    }
    case 'name':
      // Every word must appear somewhere in the name, in any order.
      return (term.tokens ?? []).map(token => {
        const ref = params.add(`%${escapeLike(token)}%`);
        return `(lower(u.name) LIKE ${ref} ESCAPE '\\'
           OR lower(u."firstName") LIKE ${ref} ESCAPE '\\'
           OR lower(u."lastName") LIKE ${ref} ESCAPE '\\')`;
      });
  }
}

function demographicConditions(filters: PatientDirectoryFilters, params: ParamList): string[] {
  const conditions: string[] = [];
  const age = `COALESCE(u.age, CASE WHEN u."dateOfBirth" IS NOT NULL
                 THEN date_part('year', age(u."dateOfBirth"))::int END)`;
  if (filters.gender) conditions.push(`u.gender::text = ${params.add(filters.gender)}`);
  if (filters.ageMin !== undefined) conditions.push(`${age} >= ${params.add(filters.ageMin)}`);
  if (filters.ageMax !== undefined) conditions.push(`${age} <= ${params.add(filters.ageMax)}`);
  if (filters.city) conditions.push(`lower(u.city) = lower(${params.add(filters.city)})`);
  if (filters.state) conditions.push(`lower(u.state) = lower(${params.add(filters.state)})`);
  return conditions;
}

function visitConditions(
  filters: PatientDirectoryFilters,
  clinic: string,
  params: ParamList
): string[] {
  const conditions: string[] = [];
  if (filters.referenceSource) {
    conditions.push(
      `EXISTS (SELECT 1 FROM patient_visits v WHERE v."patientId" = p.id AND v."clinicId" = ${clinic}
         AND v."referenceSource" = ${params.add(filters.referenceSource)})`
    );
  }
  if (filters.caseDateFrom || filters.caseDateTo) {
    const bounds: string[] = [];
    if (filters.caseDateFrom) {
      bounds.push(
        `v."registrationDate" >= (${params.add(filters.caseDateFrom)}::date)::timestamp - ${IST_OFFSET}`
      );
    }
    if (filters.caseDateTo) {
      bounds.push(
        `v."registrationDate" < (${params.add(filters.caseDateTo)}::date + 1)::timestamp - ${IST_OFFSET}`
      );
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM patient_visits v WHERE v."patientId" = p.id AND v."clinicId" = ${clinic}
         AND ${bounds.join(' AND ')})`
    );
  }
  if (filters.minVisits !== undefined) {
    conditions.push(`COALESCE(vs.cnt, 0) >= ${params.add(filters.minVisits)}`);
  }
  return conditions;
}

function recordConditions(filters: PatientDirectoryFilters, clinic: string): string[] {
  const conditions: string[] = [];
  if (filters.hasMobile !== undefined) {
    conditions.push(filters.hasMobile ? HAS_PHONE(clinic) : `NOT ${HAS_PHONE(clinic)}`);
  }
  if (filters.hasDiagnosis !== undefined) {
    const diagnosed = `(
      EXISTS (SELECT 1 FROM ayurvedic_diagnoses d WHERE d."patientId" = p.id AND d."clinicId" = ${clinic})
      OR EXISTS (SELECT 1 FROM patient_visits v WHERE v."patientId" = p.id AND v."clinicId" = ${clinic}
                 AND v."knownCaseOf" IS NOT NULL)
    )`;
    conditions.push(filters.hasDiagnosis ? diagnosed : `NOT ${diagnosed}`);
  }
  return conditions;
}

function orderBy(sort: PatientDirectorySortField, order: PatientDirectorySortOrder): string {
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  return `${SORT_EXPRESSIONS[sort]} ${direction} NULLS LAST, m.patient_id ASC`;
}

/** One page of the directory, with the total match count on every row. */
export function buildDirectoryPageSql(query: PatientDirectoryQuery): DirectorySql {
  const params = new ParamList();
  const clinic = params.add(query.clinicId);
  const { filters } = query;

  const where = [
    SCOPE(clinic),
    ...searchCondition(filters, clinic, params),
    ...demographicConditions(filters, params),
    ...visitConditions(filters, clinic, params),
    ...recordConditions(filters, clinic),
  ].join('\n    AND ');

  const limit = params.add(query.pageSize);
  const offset = params.add((query.page - 1) * query.pageSize);

  const sql = `
WITH visit_stats AS (
  SELECT "patientId", count(*)::int AS cnt,
         min("registrationDate") AS first_visit, max("registrationDate") AS last_visit
    FROM patient_visits WHERE "clinicId" = ${clinic} GROUP BY "patientId"
),
matched AS (
  SELECT p.id AS patient_id, p."userId" AS user_id, p."createdAt" AS registered_at,
         u.name, u."firstName", u."lastName", u.gender::text AS gender, u.age,
         u."dateOfBirth", u.city, u.state, u.phone, u.email,
         COALESCE(vs.cnt, 0) AS visits, vs.first_visit, vs.last_visit
    FROM "Patient" p
    JOIN users u ON u.id = p."userId"
    LEFT JOIN visit_stats vs ON vs."patientId" = p.id
   WHERE ${where}
),
page AS (
  SELECT m.*, count(*) OVER () AS total_count,
         row_number() OVER (ORDER BY ${orderBy(query.sort, query.order)}) AS rn
    FROM matched m
   ORDER BY rn
   LIMIT ${limit} OFFSET ${offset}
)
SELECT pg.*,
  (SELECT i.value FROM patient_identifiers i
    WHERE i."patientId" = pg.patient_id AND i."clinicId" = ${clinic} AND i.system = 'UHID') AS uhid,
  (SELECT i.value FROM patient_identifiers i
    WHERE i."patientId" = pg.patient_id AND i."clinicId" = ${clinic}
      AND i.system = 'LEGACY_REGISTRATION') AS legacy_registration,
  COALESCE(pg.phone, (SELECT c.value FROM patient_contact_points c
    WHERE c."patientId" = pg.patient_id AND c."clinicId" = ${clinic} AND c.system = 'phone'
    ORDER BY c."createdAt" LIMIT 1)) AS contact_phone,
  COALESCE(pg.email, (SELECT c.value FROM patient_contact_points c
    WHERE c."patientId" = pg.patient_id AND c."clinicId" = ${clinic} AND c.system = 'email'
    ORDER BY c."createdAt" LIMIT 1)) AS contact_email,
  (SELECT v."referenceSource" FROM patient_visits v
    WHERE v."patientId" = pg.patient_id AND v."clinicId" = ${clinic} AND v."referenceSource" IS NOT NULL
    ORDER BY v."registrationDate" DESC LIMIT 1) AS reference_source
  FROM page pg
 ORDER BY pg.rn`;

  return { sql, params: params.toArray() };
}

/** Total matches, used when a requested page is past the end (the page query then returns no rows). */
export function buildDirectoryCountSql(query: PatientDirectoryQuery): DirectorySql {
  const params = new ParamList();
  const clinic = params.add(query.clinicId);
  const { filters } = query;
  const where = [
    SCOPE(clinic),
    ...searchCondition(filters, clinic, params),
    ...demographicConditions(filters, params),
    ...visitConditions(filters, clinic, params),
    ...recordConditions(filters, clinic),
  ].join('\n    AND ');
  const sql = `
WITH visit_stats AS (
  SELECT "patientId", count(*)::int AS cnt FROM patient_visits
   WHERE "clinicId" = ${clinic} GROUP BY "patientId"
)
SELECT count(*)::int AS total
  FROM "Patient" p
  JOIN users u ON u.id = p."userId"
  LEFT JOIN visit_stats vs ON vs."patientId" = p.id
 WHERE ${where}`;
  return { sql, params: params.toArray() };
}

const FACET_LIMIT = 200;

/** Distinct filter values (with counts) for the clinic. `$1` is the clinic. */
export const FACET_SQL = {
  cities: `SELECT u.city AS value, count(*)::int AS count
     FROM "Patient" p JOIN users u ON u.id = p."userId"
    WHERE ${SCOPE('$1')} AND u.city IS NOT NULL AND u.city <> ''
    GROUP BY u.city ORDER BY count(*) DESC, u.city LIMIT ${FACET_LIMIT}`,
  states: `SELECT u.state AS value, count(*)::int AS count
     FROM "Patient" p JOIN users u ON u.id = p."userId"
    WHERE ${SCOPE('$1')} AND u.state IS NOT NULL AND u.state <> ''
    GROUP BY u.state ORDER BY count(*) DESC, u.state LIMIT ${FACET_LIMIT}`,
  referenceSources: `SELECT v."referenceSource" AS value, count(DISTINCT v."patientId")::int AS count
     FROM patient_visits v WHERE v."clinicId" = $1 AND v."referenceSource" IS NOT NULL
    GROUP BY v."referenceSource" ORDER BY count(*) DESC LIMIT ${FACET_LIMIT}`,
  caseYears: `SELECT to_char(v."registrationDate" + ${IST_OFFSET}, 'YYYY') AS value,
            count(*)::int AS count
     FROM patient_visits v WHERE v."clinicId" = $1
    GROUP BY 1 ORDER BY 1 DESC LIMIT ${FACET_LIMIT}`,
} as const;
