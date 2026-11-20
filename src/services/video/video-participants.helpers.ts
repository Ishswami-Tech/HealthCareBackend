/**
 * Who joined a video consultation, and when they left: one `video_participants` row per user per
 * consultation.
 *
 * The server sees a join when it hands someone into the call: the meeting-token request (the web
 * Join button) and the explicit start route. A leave is the patient's leave request, or the end of
 * the consultation (the doctor completing it, or an admin terminating it), which closes every row
 * still open.
 *
 * - `joinedAt` is the FIRST join and is never moved; a rejoin reopens the row (JOINED, no
 *   `leftAt`) without creating a second one.
 * - `duration` is the span in seconds from the first join to the latest leave.
 * - The system caller (the meeting-URL lookup) is not a person and is never recorded.
 *
 * Raw SQL on a transaction client: a transaction-scoped advisory lock on consultation + user makes
 * two devices of the same user joining at once write ONE row, on every API replica, without a
 * schema change. Timestamps are written as UTC wall time, the way Prisma stores `DateTime`.
 */
import { randomUUID } from 'node:crypto';
import type { RawSqlClient } from '@infrastructure/queue/src/services/location-token.allocator';
import type { VideoCallerRole } from './video-access.helpers';

export type VideoParticipantRoleValue = 'HOST' | 'PARTICIPANT' | 'OBSERVER';

export type ParticipantJoinOutcome =
  | { kind: 'joined'; participantId: string }
  | { kind: 'rejoined'; participantId: string }
  | { kind: 'no-consultation' };

/** The doctor hosts; the patient (or the account that booked) takes part; staff only observe. */
export function participantRoleFor(userRole: VideoCallerRole): VideoParticipantRoleValue {
  if (userRole === 'doctor') return 'HOST';
  if (userRole === 'patient') return 'PARTICIPANT';
  return 'OBSERVER';
}

/** Advisory lock key of one user's row in one consultation. */
export function participantLockKey(consultationId: string, userId: string): string {
  return `video-participant:${consultationId}:${userId}`;
}

const CONSULTATION_SQL = `
  SELECT c."id" FROM "video_consultations" c
   WHERE c."appointmentId" = $1
   ORDER BY c."createdAt" ASC
   LIMIT 1`;

const LOCK_SQL = `SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)`;

const FIND_SQL = `
  SELECT p."id" FROM "video_participants" p
   WHERE p."consultationId" = $1 AND p."userId" = $2
   ORDER BY p."createdAt" ASC
   LIMIT 1`;

const INSERT_SQL = `
  INSERT INTO "video_participants"
    ("id", "consultationId", "userId", "role", "status", "joinedAt", "createdAt", "updatedAt")
  VALUES (
    $1, $2, $3, $4::"VideoParticipantRole", 'JOINED',
    ($5::timestamptz AT TIME ZONE 'UTC'), ($5::timestamptz AT TIME ZONE 'UTC'),
    ($5::timestamptz AT TIME ZONE 'UTC')
  )
  RETURNING "id"`;

const REJOIN_SQL = `
  UPDATE "video_participants"
     SET "status" = 'JOINED',
         "joinedAt" = COALESCE("joinedAt", ($2::timestamptz AT TIME ZONE 'UTC')),
         "leftAt" = NULL,
         "updatedAt" = ($2::timestamptz AT TIME ZONE 'UTC')
   WHERE "id" = $1
  RETURNING "id"`;

/** Closes open rows; `$3` narrows it to one user, NULL closes everyone's. */
const LEAVE_SQL = `
  UPDATE "video_participants" p
     SET "status" = 'LEFT',
         "leftAt" = ($2::timestamptz AT TIME ZONE 'UTC'),
         "duration" = GREATEST(
           0,
           FLOOR(EXTRACT(EPOCH FROM (($2::timestamptz AT TIME ZONE 'UTC') - p."joinedAt")))
         )::int,
         "updatedAt" = ($2::timestamptz AT TIME ZONE 'UTC')
   WHERE p."consultationId" IN (
           SELECT c."id" FROM "video_consultations" c WHERE c."appointmentId" = $1
         )
     AND p."status" = 'JOINED'
     AND p."joinedAt" IS NOT NULL
     AND ($3::text IS NULL OR p."userId" = $3)
  RETURNING p."id"`;

/**
 * Record that `userId` joined the appointment's consultation. MUST run inside a transaction: the
 * advisory lock is transaction-scoped. `no-consultation` when the call has no consultation row yet
 * (nothing to attach the participant to).
 */
export async function recordParticipantJoined(
  tx: RawSqlClient,
  params: {
    appointmentId: string;
    userId: string;
    userRole: VideoCallerRole;
    now?: Date;
  }
): Promise<ParticipantJoinOutcome> {
  const at = (params.now ?? new Date()).toISOString();
  const [consultation] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    CONSULTATION_SQL,
    params.appointmentId
  );
  if (!consultation) return { kind: 'no-consultation' };

  await tx.$queryRawUnsafe(LOCK_SQL, participantLockKey(consultation.id, params.userId));
  const [existing] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    FIND_SQL,
    consultation.id,
    params.userId
  );
  if (existing) {
    await tx.$queryRawUnsafe(REJOIN_SQL, existing.id, at);
    return { kind: 'rejoined', participantId: existing.id };
  }

  const participantId = randomUUID();
  await tx.$queryRawUnsafe(
    INSERT_SQL,
    participantId,
    consultation.id,
    params.userId,
    participantRoleFor(params.userRole),
    at
  );
  return { kind: 'joined', participantId };
}

/**
 * Record a leave: one user's open row when `userId` is given, otherwise every open row of the
 * consultation (it ended). A single statement, so no transaction is needed.
 *
 * @returns how many rows were closed
 */
export async function recordParticipantsLeft(
  client: RawSqlClient,
  params: { appointmentId: string; userId?: string; now?: Date }
): Promise<number> {
  const at = (params.now ?? new Date()).toISOString();
  const closed = await client.$queryRawUnsafe<Array<{ id: string }>>(
    LEAVE_SQL,
    params.appointmentId,
    at,
    params.userId ?? null
  );
  return closed.length;
}
