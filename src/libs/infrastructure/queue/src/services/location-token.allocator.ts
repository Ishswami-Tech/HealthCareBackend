/**
 * Durable in-person token allocation (audit P0-1 / P0-2).
 *
 * ONE token series per clinic location per IST visit day (K-001, K-002, ... at Kothrud; B-001 at
 * Baner), shared by every doctor at the location and by walk-ins. The database is the source of
 * truth: `location_token_counters` is bumped with one atomic upsert and the allocated number and
 * label are stored on the appointment (`tokenNumber`, `tokenLabel`, `tokenDay`), so
 *   - concurrent check-ins on several API replicas get unique, consecutive numbers (row lock on
 *     the counter row),
 *   - a Dragonfly flush / restart never restarts the series at 1 (no second K-001),
 *   - a repeated check-in (double click, retry, undo no-show) returns the token already stored.
 *
 * Seam: a new counter row is seeded above the day's tokens already handed out (see
 * CREATE_LOCATION_COUNTER_SQL), so switching from the old cache counter mid-day continues the
 * series instead of issuing a second 001.
 *
 * Day rule: the series day is the IST calendar day of the appointment SLOT (`Appointment.date`),
 * not of the arrival. A 23:45 slot checked in at 00:10 keeps the previous day's series, matching
 * the cross-midnight check-in window (contract 19.14).
 */
import { formatDateKeyInIST } from '@utils/date-time.util';
import { formatQueueToken, locationTokenPrefix } from '@utils/in-person-flow.util';

/** Raw SQL surface of a Prisma (transaction) client. */
export interface RawSqlClient {
  $queryRawUnsafe: <T>(sql: string, ...values: Array<string | number | null>) => Promise<T>;
}

export interface LocationToken {
  tokenNumber: number;
  tokenLabel: string;
  /** IST visit day `YYYY-MM-DD` of the series. */
  tokenDay: string;
  /** true when this call allocated the number, false when the stored token was returned. */
  allocated: boolean;
}

export interface AssignTokenOptions {
  /** Location prefix ("K"); derived from the stored location name / settings when omitted. */
  prefix?: string | undefined;
}

interface LockedAppointmentRow {
  clinicId: string;
  locationId: string | null;
  date: Date | string;
  tokenNumber: number | null;
  tokenLabel: string | null;
  tokenDay: string | null;
  locationName: string | null;
  locationSettings: unknown;
}

/** Series key of an appointment without a clinic location (should not happen for in-person). */
export const NO_LOCATION_SERIES_KEY = '-';

const LOCK_APPOINTMENT_SQL = `
  SELECT a."clinicId", a."locationId", a."date", a."tokenNumber", a."tokenLabel",
         to_char(a."tokenDay", 'YYYY-MM-DD') AS "tokenDay",
         cl."name" AS "locationName", cl."settings" AS "locationSettings"
    FROM "Appointment" a
    LEFT JOIN "clinic_locations" cl ON cl."id" = a."locationId"
   WHERE a."id" = $1
     FOR UPDATE OF a`;

/** Fast path: bump the existing location/day row (row lock, atomic across replicas). */
export const BUMP_LOCATION_TOKEN_SQL = `
  UPDATE "location_token_counters"
     SET "lastValue" = "lastValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
   WHERE "clinicId" = $1 AND "locationId" = $2 AND "day" = $3::date
  RETURNING "lastValue"`;

/**
 * First token of a location/day: create the row, seeded ABOVE every token the day already handed
 * out (tokens stored on appointments, and the labels of the check-in log written while tokens
 * were cache-only), so a deploy or a lost counter row mid-day never restarts at 001. A concurrent
 * creator hits the conflict branch and simply takes the next number.
 */
export const CREATE_LOCATION_COUNTER_SQL = `
  INSERT INTO "location_token_counters" ("clinicId", "locationId", "day", "lastValue", "updatedAt")
  VALUES ($1, $2, $3::date, 1 + GREATEST(
    COALESCE((SELECT max(a."tokenNumber") FROM "Appointment" a
               WHERE a."clinicId" = $1 AND a."locationId" = $2 AND a."tokenDay" = $3::date), 0),
    COALESCE((SELECT max(substring(c."tokenLabel" from '([0-9]+)$')::int) FROM "check_in_attempts" c
               WHERE c."clinicId" = $1 AND c."locationId" = $2 AND c."tokenLabel" ~ '[0-9]+$'
                 AND c."createdAt" >= ($3::date::timestamp - interval '5 hours 30 minutes')
                 AND c."createdAt" < ($3::date::timestamp + interval '18 hours 30 minutes')), 0)
  ), CURRENT_TIMESTAMP)
  ON CONFLICT ("clinicId", "locationId", "day")
  DO UPDATE SET "lastValue" = "location_token_counters"."lastValue" + 1,
                "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "lastValue"`;

const STORE_TOKEN_SQL = `
  UPDATE "Appointment"
     SET "tokenNumber" = $2::int, "tokenLabel" = $3, "tokenDay" = $4::date
   WHERE "id" = $1 AND "tokenNumber" IS NULL
  RETURNING "tokenNumber"`;

/** IST visit day of the appointment slot: the token series day. */
export function tokenDayKey(appointmentDate: Date | string): string {
  const key = formatDateKeyInIST(appointmentDate);
  if (!key) {
    throw new Error('Token allocation needs the appointment date');
  }
  return key;
}

/** True when the client can run the raw upsert (a real Prisma client / transaction). */
export function supportsRawSql(client: unknown): client is RawSqlClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function'
  );
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'bigint' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The appointment's token: the stored one when it already has one, otherwise the next number of
 * its location/day series, stored on the appointment. MUST run inside a transaction: the
 * appointment row is locked first (`FOR UPDATE`), then the counter row, always in that order, so
 * concurrent callers never deadlock and one appointment never gets two numbers.
 * Returns null when the appointment does not exist.
 */
export async function assignLocationToken(
  tx: RawSqlClient,
  appointmentId: string,
  options: AssignTokenOptions = {}
): Promise<LocationToken | null> {
  const [row] = await tx.$queryRawUnsafe<LockedAppointmentRow[]>(
    LOCK_APPOINTMENT_SQL,
    appointmentId
  );
  if (!row) return null;

  const prefix =
    options.prefix ||
    locationTokenPrefix({ name: row.locationName, settings: row.locationSettings });
  const stored = positiveInt(row.tokenNumber);
  if (stored !== null) {
    return {
      tokenNumber: stored,
      tokenLabel: row.tokenLabel || formatQueueToken(stored, prefix) || '',
      tokenDay: row.tokenDay || tokenDayKey(row.date),
      allocated: false,
    };
  }

  const day = tokenDayKey(row.date);
  const seriesKey = [row.clinicId, row.locationId || NO_LOCATION_SERIES_KEY, day] as const;
  const [bumped] = await tx.$queryRawUnsafe<Array<{ lastValue: number | bigint }>>(
    BUMP_LOCATION_TOKEN_SQL,
    ...seriesKey
  );
  const [counter] = bumped
    ? [bumped]
    : await tx.$queryRawUnsafe<Array<{ lastValue: number | bigint }>>(
        CREATE_LOCATION_COUNTER_SQL,
        ...seriesKey
      );
  const tokenNumber = positiveInt(counter?.lastValue);
  if (tokenNumber === null) {
    throw new Error(`Token counter returned no value for appointment ${appointmentId}`);
  }
  const tokenLabel = formatQueueToken(tokenNumber, prefix) || '';
  const updated = await tx.$queryRawUnsafe<Array<{ tokenNumber: number }>>(
    STORE_TOKEN_SQL,
    appointmentId,
    tokenNumber,
    tokenLabel,
    day
  );
  if (updated.length === 0) {
    // Unreachable while the row lock is held; fail loudly rather than hand out a second number.
    throw new Error(`Appointment ${appointmentId} already holds a token`);
  }
  return { tokenNumber, tokenLabel, tokenDay: day, allocated: true };
}
