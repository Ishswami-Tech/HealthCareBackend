/**
 * Executes an import plan against PostgreSQL. Database access goes through `SqlExecutor`, so the
 * same code runs on `pg` in production and on an in-memory Postgres in tests.
 *
 * Why not the Nest services: this is a bulk, offline load. Booting the application from a second
 * process would start a second set of queue workers and scheduled jobs, and per-row events and
 * notifications must NOT fire for 40,000 historical patients. The pure rules (UHID format,
 * validators, field encryption) are shared; the writes are plain set-based SQL.
 *
 * What an imported patient is: an UNCLAIMED record. No password, no login phone, no login email,
 * no consent row. Mobile and email go to `patient_contact_points`. The register's patient number is
 * kept as a LEGACY_REGISTRATION identifier; the patient gets a real UHID.
 */
import { createHash, randomUUID } from 'crypto';
import { encryptField } from '@infrastructure/database/config/field-crypto.util';
import { formatUhid, normaliseClinicCode } from '@services/compliance/utils/uhid.util';
import {
  nameAndMobileKey,
  summarisePlan,
  type ExistingState,
  type ImportPlan,
  type PlanSummary,
  type PlannedPatient,
} from './import-plan';
import { normaliseIndianMobile } from './register-mapper';

export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface TransactionalExecutor extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface RunContext {
  readonly clinicId: string;
  /** User recorded as the actor of the import (audit row, `createdBy`). */
  readonly actorUserId: string;
  readonly batchId: string;
  readonly source: string;
  readonly batchSize: number;
  /** Master key for the free-text clinical fields; null means none is configured. */
  readonly masterKey: Buffer | null;
  /** When true no clinical text (diagnoses, known case of) is written. */
  readonly skipClinicalText: boolean;
}

export interface RunResult {
  readonly usersCreated: number;
  readonly patientsCreated: number;
  readonly legacyIdentifiersCreated: number;
  readonly uhidsIssued: number;
  readonly contactPointsCreated: number;
  readonly visitsCreated: number;
  readonly diagnosesCreated: number;
  readonly batches: number;
}

const ROLE_LITERAL = `'PATIENT'::"Role"`;
const ISO_IST = (date: string): string => new Date(`${date}T00:00:00+05:30`).toISOString();
const DIAGNOSIS_NOTE = 'Imported from the previous register; no clinical assessment recorded';

/** Stable, collision-free login-less user id for an imported patient: same patient, same id. */
export const importedUserId = (clinicId: string, legacyRegistration: string): string =>
  `UID_VMR_${createHash('sha1').update(`${clinicId}:${legacyRegistration}`).digest('hex').slice(0, 14).toUpperCase()}`;

export async function loadExistingState(db: SqlExecutor, clinicId: string): Promise<ExistingState> {
  const legacy = await db.query<{ value: string; patientId: string }>(
    `SELECT "value", "patientId" FROM "patient_identifiers"
      WHERE "clinicId" = $1::text AND "system" = 'LEGACY_REGISTRATION'`,
    [clinicId]
  );
  const visits = await db.query<{ opdNumber: string }>(
    `SELECT "opdNumber" FROM "patient_visits" WHERE "clinicId" = $1::text AND "opdNumber" LIKE 'VM-%'`,
    [clinicId]
  );
  const people = await db.query<{ id: string; name: string; phone: string }>(
    `SELECT p."id", u."name", u."phone" FROM "Patient" p
       JOIN "users" u ON u."id" = p."userId"
      WHERE u."primaryClinicId" = $1::text AND u."phone" IS NOT NULL`,
    [clinicId]
  );

  const byKey = new Map<string, string | null>();
  for (const person of people.rows) {
    const mobile = normaliseIndianMobile(person.phone);
    if (!mobile) continue;
    const key = nameAndMobileKey(person.name, mobile);
    // Two patients with the same name and number are ambiguous: never link to either.
    byKey.set(key, byKey.has(key) ? null : person.id);
  }
  const unique = new Map<string, string>();
  for (const [key, id] of byKey) if (id !== null) unique.set(key, id);

  return {
    legacyToPatientId: new Map(legacy.rows.map(row => [row.value, row.patientId])),
    uniquePatientByNameAndMobile: unique,
    opdNumbers: new Set(visits.rows.map(row => row.opdNumber)),
  };
}

/** Reserves `count` consecutive sequence numbers atomically and returns the first one. */
export async function reserveUhidRange(
  tx: SqlExecutor,
  clinicId: string,
  count: number
): Promise<number> {
  const result = await tx.query<{ lastValue: number | string }>(
    `INSERT INTO "uhid_sequences" ("clinicId", "lastValue", "updatedAt")
     VALUES (
       $1::text,
       (
         SELECT COALESCE(MAX(CAST(SUBSTRING("value" FROM '([0-9]{8})[0-9]$') AS INTEGER)), 0) + $2::int
           FROM "patient_identifiers"
          WHERE "clinicId" = $1::text
            AND "system" = 'UHID'
            AND "value" ~ '^[A-Z0-9]{2,8}-[0-9]{9}$'
       ),
       NOW()
     )
     ON CONFLICT ("clinicId")
     DO UPDATE SET "lastValue" = "uhid_sequences"."lastValue" + $2::int, "updatedAt" = NOW()
     RETURNING "lastValue"`,
    [clinicId, count]
  );
  const last = Number(result.rows[0]?.lastValue ?? 0);
  if (!Number.isInteger(last) || last < count) {
    throw new Error('Could not reserve a UHID range');
  }
  return last - count + 1;
}

async function clinicCodeFor(db: SqlExecutor, clinicId: string): Promise<string> {
  const result = await db.query<{ clinicId: string | null }>(
    `SELECT "clinicId" FROM "clinics" WHERE "id" = $1::text`,
    [clinicId]
  );
  const code = result.rows[0]?.clinicId?.trim();
  return normaliseClinicCode(code && code.length > 0 ? code : clinicId);
}

interface Rows {
  users: Array<Record<string, string | number | null>>;
  patients: Array<{ id: string; userId: string; createdAt: string }>;
  identifiers: Array<{ patientId: string; system: string; value: string }>;
  contacts: Array<{ patientId: string; system: string; value: string; use: string }>;
  visits: Array<{
    id: string;
    opd: string;
    patientId: string;
    registeredAt: string;
    knownCaseOf: string | null;
    referenceSource: string | null;
  }>;
  diagnoses: Array<{ patientId: string; disease: string; diagnosedAt: string }>;
}

function sealText(ctx: RunContext, visitId: string, text: string): string {
  if (!ctx.masterKey) {
    throw new Error('Clinical text cannot be written without an encryption key');
  }
  return encryptField(ctx.masterKey, text, `patient_visits.knownCaseOf:${visitId}`);
}

function collectRows(
  batch: readonly PlannedPatient[],
  ctx: RunContext,
  uhids: Map<string, string>
): Rows {
  const rows: Rows = {
    users: [],
    patients: [],
    identifiers: [],
    contacts: [],
    visits: [],
    diagnoses: [],
  };
  for (const planned of batch) {
    const { profile } = planned;
    let patientId = planned.existingPatientId;
    if (planned.mode === 'NEW') {
      patientId = randomUUID();
      const userId = randomUUID();
      rows.users.push({
        id: userId,
        userid: importedUserId(ctx.clinicId, planned.legacyRegistration),
        name: profile.name,
        age: profile.age,
        firstName: profile.firstName,
        lastName: profile.lastName,
        gender: profile.gender,
        dob: profile.dateOfBirth,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        country: profile.country,
        createdAt: ISO_IST(planned.firstCaseDate),
      });
      rows.patients.push({ id: patientId, userId, createdAt: ISO_IST(planned.firstCaseDate) });
      rows.identifiers.push({
        patientId,
        system: 'LEGACY_REGISTRATION',
        value: planned.legacyRegistration,
      });
      if (profile.mobile) {
        rows.contacts.push({ patientId, system: 'phone', value: profile.mobile, use: 'mobile' });
      }
      if (profile.email) {
        rows.contacts.push({ patientId, system: 'email', value: profile.email, use: 'home' });
      }
    } else if (planned.mode === 'LINK_EXISTING' && patientId) {
      rows.identifiers.push({
        patientId,
        system: 'LEGACY_REGISTRATION',
        value: planned.legacyRegistration,
      });
    }
    if (!patientId) continue;

    const uhid = uhids.get(planned.legacyRegistration);
    if (uhid) rows.identifiers.push({ patientId, system: 'UHID', value: uhid });

    for (const visit of planned.visits) {
      const visitId = randomUUID();
      const registeredAt = ISO_IST(visit.caseDate);
      rows.visits.push({
        id: visitId,
        opd: visit.opdNumber,
        patientId,
        registeredAt,
        referenceSource: visit.referenceSource,
        knownCaseOf:
          !ctx.skipClinicalText && visit.modernDiagnosis
            ? sealText(ctx, visitId, visit.modernDiagnosis)
            : null,
      });
      if (!ctx.skipClinicalText && visit.ayurvedicDiagnosis) {
        rows.diagnoses.push({
          patientId,
          disease: visit.ayurvedicDiagnosis,
          diagnosedAt: registeredAt,
        });
      }
    }
  }
  return rows;
}

const column = <T, K extends keyof T>(items: readonly T[], key: K): Array<T[K]> =>
  items.map(item => item[key]);

async function writeRows(tx: SqlExecutor, rows: Rows, ctx: RunContext): Promise<RunResult> {
  let users = 0;
  let patients = 0;
  let identifiers = 0;
  let uhids = 0;
  let contacts = 0;
  let visits = 0;
  let diagnoses = 0;

  if (rows.users.length > 0) {
    const u = rows.users;
    await tx.query(
      `INSERT INTO "users"
         ("id","userid","name","age","firstName","lastName","role","gender","dateOfBirth",
          "address","city","state","country","primaryClinicId","isActive","isVerified",
          "phoneVerified","createdAt","updatedAt")
       SELECT t.id, t.userid, t.name, t.age, t."firstName", t."lastName", ${ROLE_LITERAL}, t.gender,
              t.dob::timestamp, t.address, t.city, t.state, t.country, $1::text, true, false, false,
              (t."createdAt"::timestamptz AT TIME ZONE 'UTC'), NOW()
         FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[],
                     $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[],
                     $14::text[])
              AS t(id, userid, name, age, "firstName", "lastName", gender, dob, address, city,
                   state, country, "createdAt")`,
      [
        ctx.clinicId,
        column(u, 'id'),
        column(u, 'userid'),
        column(u, 'name'),
        column(u, 'age'),
        column(u, 'firstName'),
        column(u, 'lastName'),
        column(u, 'gender'),
        column(u, 'dob'),
        column(u, 'address'),
        column(u, 'city'),
        column(u, 'state'),
        column(u, 'country'),
        column(u, 'createdAt'),
      ]
    );
    users = rows.users.length;
  }

  if (rows.patients.length > 0) {
    await tx.query(
      `INSERT INTO "Patient" ("id","userId","createdAt")
       SELECT t.id, t."userId", (t."createdAt"::timestamptz AT TIME ZONE 'UTC')
         FROM unnest($1::text[], $2::text[], $3::text[]) AS t(id, "userId", "createdAt")`,
      [
        column(rows.patients, 'id'),
        column(rows.patients, 'userId'),
        column(rows.patients, 'createdAt'),
      ]
    );
    patients = rows.patients.length;
  }

  if (rows.identifiers.length > 0) {
    const result = await tx.query<{ system: string }>(
      `INSERT INTO "patient_identifiers"
         ("id","patientId","clinicId","system","value","source","createdBy","createdAt","updatedAt")
       SELECT gen_random_uuid()::text, t."patientId", $1::text, t.system, t.value, $2::text, $3::text,
              NOW(), NOW()
         FROM unnest($4::text[], $5::text[], $6::text[]) AS t("patientId", system, value)
       ON CONFLICT DO NOTHING
       RETURNING "system"`,
      [
        ctx.clinicId,
        ctx.source,
        ctx.actorUserId,
        column(rows.identifiers, 'patientId'),
        column(rows.identifiers, 'system'),
        column(rows.identifiers, 'value'),
      ]
    );
    identifiers = result.rows.filter(row => row.system === 'LEGACY_REGISTRATION').length;
    uhids = result.rows.filter(row => row.system === 'UHID').length;
  }

  if (rows.contacts.length > 0) {
    const result = await tx.query(
      `INSERT INTO "patient_contact_points"
         ("id","patientId","clinicId","system","value","use","source","createdAt","updatedAt")
       SELECT gen_random_uuid()::text, t."patientId", $1::text, t.system, t.value, t.use, $2::text,
              NOW(), NOW()
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[])
              AS t("patientId", system, value, use)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        ctx.clinicId,
        ctx.source,
        column(rows.contacts, 'patientId'),
        column(rows.contacts, 'system'),
        column(rows.contacts, 'value'),
        column(rows.contacts, 'use'),
      ]
    );
    contacts = result.rows.length;
  }

  if (rows.visits.length > 0) {
    const result = await tx.query(
      `INSERT INTO "patient_visits"
         ("id","opdNumber","registrationDate","patientId","clinicId","knownCaseOf","referenceSource",
          "createdBy","createdAt","updatedAt")
       SELECT t.id, t.opd, (t."registeredAt"::timestamptz AT TIME ZONE 'UTC'), t."patientId",
              $1::text, t."knownCaseOf", t."referenceSource", $2::text,
              (t."registeredAt"::timestamptz AT TIME ZONE 'UTC'), NOW()
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
              AS t(id, opd, "patientId", "registeredAt", "knownCaseOf", "referenceSource")
       ON CONFLICT ("clinicId", "opdNumber") DO NOTHING
       RETURNING "id"`,
      [
        ctx.clinicId,
        ctx.actorUserId,
        column(rows.visits, 'id'),
        column(rows.visits, 'opd'),
        column(rows.visits, 'patientId'),
        column(rows.visits, 'registeredAt'),
        column(rows.visits, 'knownCaseOf'),
        column(rows.visits, 'referenceSource'),
      ]
    );
    visits = result.rows.length;
  }

  if (rows.diagnoses.length > 0) {
    await tx.query(
      `INSERT INTO "ayurvedic_diagnoses"
         ("id","patientId","clinicId","primaryDisease","clinicalAssessment","status","createdBy",
          "diagnosedAt","createdAt","updatedAt")
       SELECT gen_random_uuid()::text, t."patientId", $1::text, t.disease, $2::text, 'HISTORICAL',
              $3::text, (t."diagnosedAt"::timestamptz AT TIME ZONE 'UTC'), NOW(), NOW()
         FROM unnest($4::text[], $5::text[], $6::text[]) AS t("patientId", disease, "diagnosedAt")`,
      [
        ctx.clinicId,
        DIAGNOSIS_NOTE,
        ctx.actorUserId,
        column(rows.diagnoses, 'patientId'),
        column(rows.diagnoses, 'disease'),
        column(rows.diagnoses, 'diagnosedAt'),
      ]
    );
    diagnoses = rows.diagnoses.length;
  }

  return {
    usersCreated: users,
    patientsCreated: patients,
    legacyIdentifiersCreated: identifiers,
    uhidsIssued: uhids,
    contactPointsCreated: contacts,
    visitsCreated: visits,
    diagnosesCreated: diagnoses,
    batches: 1,
  };
}

const ZERO: RunResult = {
  usersCreated: 0,
  patientsCreated: 0,
  legacyIdentifiersCreated: 0,
  uhidsIssued: 0,
  contactPointsCreated: 0,
  visitsCreated: 0,
  diagnosesCreated: 0,
  batches: 0,
};

const add = (a: RunResult, b: RunResult): RunResult => ({
  usersCreated: a.usersCreated + b.usersCreated,
  patientsCreated: a.patientsCreated + b.patientsCreated,
  legacyIdentifiersCreated: a.legacyIdentifiersCreated + b.legacyIdentifiersCreated,
  uhidsIssued: a.uhidsIssued + b.uhidsIssued,
  contactPointsCreated: a.contactPointsCreated + b.contactPointsCreated,
  visitsCreated: a.visitsCreated + b.visitsCreated,
  diagnosesCreated: a.diagnosesCreated + b.diagnosesCreated,
  batches: a.batches + b.batches,
});

/**
 * Writes the plan in batches. Each batch is one transaction (all of it or none of it), so a
 * failure never leaves half a patient; a re-run continues where the last one stopped because
 * everything already written is recognised by its legacy number and visit number.
 */
export async function executePlan(
  db: TransactionalExecutor,
  plan: ImportPlan,
  ctx: RunContext,
  progress: (done: number, total: number) => void = () => undefined
): Promise<RunResult> {
  const clinicCode = await clinicCodeFor(db, ctx.clinicId);
  let total = ZERO;
  const work = plan.patients.filter(
    patient => patient.mode !== 'ALREADY_IMPORTED' || patient.visits.length > 0
  );

  for (let start = 0; start < work.length; start += ctx.batchSize) {
    const batch = work.slice(start, start + ctx.batchSize);
    const result = await db.transaction(async tx => {
      // Every patient who has no UHID yet gets one; ALREADY_IMPORTED patients already have theirs.
      const needUhid = batch.filter(patient => patient.mode !== 'ALREADY_IMPORTED');
      const uhids = new Map<string, string>();
      if (needUhid.length > 0) {
        const first = await reserveUhidRange(tx, ctx.clinicId, needUhid.length);
        needUhid.forEach((patient, index) => {
          uhids.set(patient.legacyRegistration, formatUhid(clinicCode, first + index));
        });
      }
      const rows = collectRows(batch, ctx, uhids);
      const written = await writeRows(tx, rows, ctx);
      await tx.query(
        `INSERT INTO "AuditLog"
           ("id","userId","action","description","clinicId","resourceType","resourceId","metadata",
            "updatedAt")
         VALUES (gen_random_uuid()::text, $1::text, 'PHI_CREATE', $2::text, $3::text,
                 'PATIENT_IMPORT', $4::text, $5::jsonb, NOW())`,
        [
          ctx.actorUserId,
          `CREATE PATIENT_IMPORT (${ctx.source})`,
          ctx.clinicId,
          ctx.batchId,
          JSON.stringify({
            source: ctx.source,
            patients: written.patientsCreated,
            visits: written.visitsCreated,
            consentRecordsCreated: 0,
            unclaimed: true,
          }),
        ]
      );
      return written;
    });
    total = add(total, result);
    progress(Math.min(start + ctx.batchSize, work.length), work.length);
  }
  return total;
}

/** Counts used to verify an import afterwards. No personal data. */
export async function verifyImport(
  db: SqlExecutor,
  clinicId: string,
  source: string
): Promise<Record<string, number>> {
  const one = async (text: string, params: unknown[]): Promise<number> =>
    Number((await db.query<{ n: number | string }>(text, params)).rows[0]?.n ?? 0);
  return {
    importedPatients: await one(
      `SELECT count(*)::int n FROM "patient_identifiers" WHERE "clinicId"=$1::text AND "system"='LEGACY_REGISTRATION' AND "source"=$2::text`,
      [clinicId, source]
    ),
    uhids: await one(
      `SELECT count(*)::int n FROM "patient_identifiers" WHERE "clinicId"=$1::text AND "system"='UHID'`,
      [clinicId]
    ),
    importedVisits: await one(
      `SELECT count(*)::int n FROM "patient_visits" WHERE "clinicId"=$1::text AND "opdNumber" LIKE 'VM-%'`,
      [clinicId]
    ),
    importedUsersWithoutLoginIdentity: await one(
      `SELECT count(*)::int n FROM "users" WHERE "userid" LIKE 'UID\\_VMR\\_%' AND "password" IS NULL AND "phone" IS NULL AND "email" IS NULL`,
      []
    ),
    importedUsersTotal: await one(
      `SELECT count(*)::int n FROM "users" WHERE "userid" LIKE 'UID\\_VMR\\_%'`,
      []
    ),
    consentRowsForImportedPatients: await one(
      `SELECT count(*)::int n FROM "patient_consents" c JOIN "patient_identifiers" i ON i."patientId"=c."patientId" AND i."system"='LEGACY_REGISTRATION' AND i."source"=$1::text`,
      [source]
    ),
    patientsWithoutUhid: await one(
      `SELECT count(*)::int n FROM "patient_identifiers" i WHERE i."clinicId"=$1::text AND i."system"='LEGACY_REGISTRATION' AND i."source"=$2::text AND NOT EXISTS (SELECT 1 FROM "patient_identifiers" u WHERE u."patientId"=i."patientId" AND u."clinicId"=i."clinicId" AND u."system"='UHID')`,
      [clinicId, source]
    ),
  };
}

export { summarisePlan };
export type { PlanSummary };
