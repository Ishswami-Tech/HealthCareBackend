/**
 * Starting an in-clinic consultation (CONFIRMED + checked in -> IN_PROGRESS), atomically.
 *
 * H2 / B22: a doctor could have two patients IN_PROGRESS at once (call-next on one, start on
 * another, or two tabs). Every start path (PATCH /appointments/:id/status IN_PROGRESS, the
 * check-in plugin's start, PATCH /queue/:id/status IN_PROGRESS, POST /queue/call-next) runs this
 * ONE statement sequence inside a transaction:
 *   1. read the appointment (404 when it is not in the clinic),
 *   2. an IN_PROGRESS appointment is the same start repeated (double click): `already-started`,
 *   3. `pg_advisory_xact_lock` on doctor + IST day, so concurrent starts of the same doctor run
 *      one after the other on every API replica,
 *   4. another IN_PROGRESS consultation of that doctor today: `doctor-busy` (409 "Finish the
 *      current consultation first"),
 *   5. the conditional update (CONFIRMED and checked in only); 0 rows: re-read and answer
 *      `already-started` or `not-startable`.
 * Raw SQL on the transaction client (status literals inline: the column is a Postgres enum).
 */
import { formatDateKeyInIST } from '@utils/date-time.util';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import type { RawSqlClient } from './location-token.allocator';

export const DOCTOR_BUSY_MESSAGE = 'Finish the current consultation first';
/** Error code of the 409 "doctor already has a consultation in progress" refusal. */
export const DOCTOR_BUSY_CODE = 'CONSULTATION_IN_PROGRESS';
export const VISIT_NOT_STARTABLE_MESSAGE =
  'Appointment must be checked in before starting consultation';

export type VisitStartOutcome =
  | { kind: 'started'; doctorId: string; startedAt: Date }
  | { kind: 'already-started'; doctorId: string; startedAt: Date | null }
  | { kind: 'doctor-busy'; doctorId: string; inProgressAppointmentId: string }
  | { kind: 'not-startable'; doctorId: string; status: string; checkedIn: boolean }
  | { kind: 'not-found' };

interface StartRow {
  id: string;
  doctorId: string | null;
  status: string;
  checkedInAt: Date | null;
  startedAt: Date | null;
}

const READ_SQL = `
  SELECT a."id", a."doctorId", a."status"::text AS "status", a."checkedInAt", a."startedAt"
    FROM "Appointment" a
   WHERE a."id" = $1 AND a."clinicId" = $2`;

/** Selects a constant: the void result of the lock function is never deserialized. */
const LOCK_SQL = `SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)`;

/** Another consultation of the doctor still IN_PROGRESS today (started today, or slot today). */
const OTHER_IN_PROGRESS_SQL = `
  SELECT a."id"
    FROM "Appointment" a
   WHERE a."doctorId" = $1
     AND a."id" <> $2
     AND a."status" = 'IN_PROGRESS'
     AND (
       (a."startedAt" >= $3::timestamptz AND a."startedAt" <= $4::timestamptz)
       OR (a."startedAt" IS NULL AND a."date" >= $3::timestamptz AND a."date" <= $4::timestamptz)
     )
   LIMIT 1`;

const START_SQL = `
  UPDATE "Appointment"
     SET "status" = 'IN_PROGRESS', "startedAt" = $3::timestamptz, "updatedAt" = $3::timestamptz
   WHERE "id" = $1 AND "clinicId" = $2
     AND "status" = 'CONFIRMED' AND "checkedInAt" IS NOT NULL
  RETURNING "id"`;

/** Advisory lock key of one doctor's IST day. */
export function doctorVisitLockKey(doctorId: string, dayKey: string): string {
  return `doctor-visit-start:${doctorId}:${dayKey}`;
}

/** MUST run inside a transaction (the advisory lock is transaction-scoped). */
export async function startVisitAtomically(
  tx: RawSqlClient,
  params: { appointmentId: string; clinicId: string; now?: Date }
): Promise<VisitStartOutcome> {
  const now = params.now ?? new Date();
  const [row] = await tx.$queryRawUnsafe<StartRow[]>(
    READ_SQL,
    params.appointmentId,
    params.clinicId
  );
  if (!row) return { kind: 'not-found' };
  const doctorId = row.doctorId ?? '';
  if (String(row.status).toUpperCase() === 'IN_PROGRESS') {
    return { kind: 'already-started', doctorId, startedAt: row.startedAt };
  }

  const dayKey = formatDateKeyInIST(now);
  const from = startOfIstDay(dayKey);
  const to = endOfIstDay(dayKey);
  if (doctorId && from && to) {
    await tx.$queryRawUnsafe(LOCK_SQL, doctorVisitLockKey(doctorId, dayKey));
    const [other] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      OTHER_IN_PROGRESS_SQL,
      doctorId,
      params.appointmentId,
      from.toISOString(),
      to.toISOString()
    );
    if (other) {
      return { kind: 'doctor-busy', doctorId, inProgressAppointmentId: other.id };
    }
  }

  const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    START_SQL,
    params.appointmentId,
    params.clinicId,
    now.toISOString()
  );
  if (updated.length > 0) return { kind: 'started', doctorId, startedAt: now };

  const [latest] = await tx.$queryRawUnsafe<StartRow[]>(
    READ_SQL,
    params.appointmentId,
    params.clinicId
  );
  if (latest && String(latest.status).toUpperCase() === 'IN_PROGRESS') {
    return { kind: 'already-started', doctorId, startedAt: latest.startedAt };
  }
  return {
    kind: 'not-startable',
    doctorId,
    status: String(latest?.status ?? row.status).toUpperCase(),
    checkedIn: Boolean(latest?.checkedInAt ?? row.checkedInAt),
  };
}
