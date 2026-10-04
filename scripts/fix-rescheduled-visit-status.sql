-- ============================================================================
-- fix-rescheduled-visit-status.sql   (REVIEW FIRST - NOT RUN BY ANY AGENT)
--
-- Background
--   Before the reschedule fix, rescheduleAppointment() reset EVERY moved visit to SCHEDULED.
--   That is right for an in-clinic visit (SCHEDULED until the patient checks in) but wrong for
--   a paid VIDEO_CALL visit: it was CONFIRMED (payment done), and moving it does not undo the
--   payment. Those rows are now stuck at SCHEDULED, so the doctor never sees them as confirmed
--   and the scheduler never gives them a confirmation window. The fixed code keeps them
--   CONFIRMED and re-stamps confirmationExpiresAt from the new slot.
--
-- How a damaged row is recognised (all must hold)
--   * type = 'VIDEO_CALL' and status = 'SCHEDULED'
--   * it was rescheduled: metadata has lastRescheduledAt or rescheduleCount > 0
--   * it was confirmed before the move: a COMPLETED payment exists for it (video visits only
--     become CONFIRMED through payment). In-clinic visits are never touched: SCHEDULED is
--     their correct state after a reschedule, and a checked-in visit cannot be rescheduled.
--   * checkedInAt is NULL, startedAt/completedAt are NULL (never touched by a visit)
--   * the new slot's active window has not ended yet (otherwise the visit simply did not
--     happen: per product rules it is left to auto-expire, never revived)
--
-- What the fix does (one idempotent statement)
--   status -> CONFIRMED, confirmationExpiresAt -> new slot start (IST) + VIDEO_ACTIVE_WINDOW
--   minutes (default 300, change :window_minutes below to match the environment), and a
--   metadata audit key statusRepairedAt / statusRepairedFrom. Re-running matches nothing
--   because the rows are no longer SCHEDULED.
--
-- Usage (psql)
--   1. Run STEP 1 (dry run) and read the rows.
--   2. If they look right, run STEP 2 inside a transaction, check the count, then COMMIT.
--   psql "$DATABASE_URL" -v window_minutes=300 -f scripts/fix-rescheduled-visit-status.sql
--   (the file stops after the dry run; uncomment STEP 2 to apply)
-- ============================================================================

\if :{?window_minutes}
\else
  \set window_minutes 300
\endif

-- ----------------------------------------------------------------------------
-- STEP 1 - DRY RUN (read only)
-- ----------------------------------------------------------------------------
WITH candidate AS (
  SELECT
    a."id",
    a."clinicId",
    a."status",
    a."date",
    a."time",
    a."metadata",
    (
      (
        ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
        + a."time"::time
      ) AT TIME ZONE 'Asia/Kolkata'
    ) AT TIME ZONE 'UTC' AS new_start_utc
  FROM "Appointment" a
  WHERE a."type" = 'VIDEO_CALL'
    AND a."status" = 'SCHEDULED'
    AND a."checkedInAt" IS NULL
    AND a."startedAt" IS NULL
    AND a."completedAt" IS NULL
    AND a."time" ~ '^[0-9]{1,2}:[0-9]{2}$'
    AND (
      a."metadata" ->> 'lastRescheduledAt' IS NOT NULL
      OR COALESCE((a."metadata" ->> 'rescheduleCount')::int, 0) > 0
    )
    AND EXISTS (
      SELECT 1
      FROM "Payment" p
      WHERE p."appointmentId" = a."id"
        AND p."status" = 'COMPLETED'
    )
)
SELECT
  c."id",
  c."clinicId",
  c."date",
  c."time",
  c.new_start_utc,
  c.new_start_utc + make_interval(mins => :window_minutes) AS new_confirmation_expires_at,
  c."metadata" ->> 'rescheduleCount' AS reschedule_count,
  c."metadata" ->> 'lastRescheduledAt' AS last_rescheduled_at
FROM candidate c
WHERE c.new_start_utc + make_interval(mins => :window_minutes) > (now() AT TIME ZONE 'UTC')
ORDER BY c."clinicId", c.new_start_utc;

-- Rows that match everything EXCEPT the window check (visit already past: left to auto-expire):
--   SELECT count(*) ... same CTE ... WHERE new_start_utc + window <= now();

-- ----------------------------------------------------------------------------
-- STEP 2 - APPLY (uncomment, run inside BEGIN; ... COMMIT; after reviewing STEP 1)
-- ----------------------------------------------------------------------------
-- BEGIN;
-- WITH candidate AS (
--   SELECT
--     a."id",
--     (
--       (
--         ((a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
--         + a."time"::time
--       ) AT TIME ZONE 'Asia/Kolkata'
--     ) AT TIME ZONE 'UTC' AS new_start_utc
--   FROM "Appointment" a
--   WHERE a."type" = 'VIDEO_CALL'
--     AND a."status" = 'SCHEDULED'
--     AND a."checkedInAt" IS NULL
--     AND a."startedAt" IS NULL
--     AND a."completedAt" IS NULL
--     AND a."time" ~ '^[0-9]{1,2}:[0-9]{2}$'
--     AND (
--       a."metadata" ->> 'lastRescheduledAt' IS NOT NULL
--       OR COALESCE((a."metadata" ->> 'rescheduleCount')::int, 0) > 0
--     )
--     AND EXISTS (
--       SELECT 1 FROM "Payment" p
--       WHERE p."appointmentId" = a."id" AND p."status" = 'COMPLETED'
--     )
-- )
-- UPDATE "Appointment" a
-- SET "status" = 'CONFIRMED',
--     "confirmationExpiresAt" = c.new_start_utc + make_interval(mins => :window_minutes),
--     "metadata" = COALESCE(a."metadata", '{}'::jsonb)
--                  || jsonb_build_object(
--                       'statusRepairedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
--                       'statusRepairedFrom', 'SCHEDULED'
--                     ),
--     "updatedAt" = now() AT TIME ZONE 'UTC'
-- FROM candidate c
-- WHERE a."id" = c."id"
--   AND a."status" = 'SCHEDULED'
--   AND c.new_start_utc + make_interval(mins => :window_minutes) > (now() AT TIME ZONE 'UTC')
-- RETURNING a."id", a."status", a."confirmationExpiresAt";
-- COMMIT;
