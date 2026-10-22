-- Phase 3: indexes on the hot front-desk / queue filters (NOT applied; run with the normal
-- `prisma migrate deploy` on the target database). Idempotent.
--
-- Reception desk and GET /appointments for a receptionist: clinic + location + day (+ status).
CREATE INDEX IF NOT EXISTS "Appointment_clinicId_locationId_date_status_idx"
  ON "Appointment" ("clinicId", "locationId", "date", "status");

-- Persisted queue rows of one location (the live queue itself is per location per day in the
-- cache; QueueEntry is the therapy queue and has no location column).
CREATE INDEX IF NOT EXISTS "Queue_clinicId_clinicLocationId_status_idx"
  ON "Queue" ("clinicId", "clinicLocationId", "status");

-- Paged doctor prescription list and summary (GET /pharmacy/prescriptions?page=,
-- /pharmacy/prescriptions/summary): clinic + doctor + date window, ordered by date.
CREATE INDEX IF NOT EXISTS "Prescription_clinicId_doctorId_date_idx"
  ON "Prescription" ("clinicId", "doctorId", "date");

-- Billing: callback binding / duplicate-settlement checks look payments up by their gateway
-- reference (transactionId).
CREATE INDEX IF NOT EXISTS "Payment_transactionId_idx"
  ON "Payment" ("transactionId");

-- Billing: one gateway order can settle at most ONE payment. Partial + expression index (the
-- order id lives in metadata JSON): older superseded / cancelled rows may legitimately share an
-- order id with the row that was paid, so only COMPLETED rows are constrained. Not expressible
-- in schema.prisma; kept here only.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_completed_provider_orderId_key"
  ON "Payment" ((("metadata" ->> 'provider')), (("metadata" ->> 'orderId')))
  WHERE "status" = 'COMPLETED' AND ("metadata" ->> 'orderId') IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Phase 1 DB / performance: partial indexes, index hygiene, per-table storage settings.
-- All idempotent. NOTE: the partial indexes below are SQL-only (schema.prisma has no partial-
-- index support without a preview feature), so `prisma db push` (dev container) drops them;
-- re-apply this file with psql after a dev restart when testing. `prisma migrate deploy` keeps
-- them.
-- ---------------------------------------------------------------------------------------------

-- Legacy (no `page`) GET /pharmacy/prescriptions: clinic's most recent N, newest first.
CREATE INDEX IF NOT EXISTS "Prescription_clinicId_date_idx"
  ON "Prescription" ("clinicId", "date");

-- Per-minute in-person queue notify / reconcile cron (in-person-queue-maintenance.service.ts):
-- live arrivals checked in today. SQL-only (partial).
CREATE INDEX IF NOT EXISTS "Appointment_live_checkedInAt_idx"
  ON "Appointment" ("checkedInAt")
  WHERE "status" IN ('CONFIRMED', 'IN_PROGRESS');

-- Video scheduler: auto-cancel unpaid PENDING video calls whose payment window expired.
-- SQL-only (partial).
CREATE INDEX IF NOT EXISTS "Appointment_video_pending_paymentExpiresAt_idx"
  ON "Appointment" ("paymentExpiresAt")
  WHERE "type" = 'VIDEO_CALL' AND "status" = 'PENDING';

-- Video scheduler: open (IN_PROGRESS) video visits within the lookback window. SQL-only (partial).
CREATE INDEX IF NOT EXISTS "Appointment_video_in_progress_date_idx"
  ON "Appointment" ("date")
  WHERE "type" = 'VIDEO_CALL' AND "status" = 'IN_PROGRESS';

-- Redundant single-column Appointment indexes: each is the leftmost prefix of a composite that
-- stays (so equality lookups and FK checks keep an index), removed from schema.prisma as well.
--   doctorId            -> ("doctorId", "clinicId", "date")
--   patientId           -> ("patientId", "status", "date")
--   clinicId            -> ("clinicId", "date", "status") / ("clinicId", "locationId", ...)
--   parentAppointmentId -> ("parentAppointmentId", "date")
--   seriesId            -> ("seriesId", "seriesSequence")
-- "Appointment_locationId_idx" is KEPT: no composite starts with locationId.
DROP INDEX IF EXISTS "Appointment_doctorId_idx";
DROP INDEX IF EXISTS "Appointment_patientId_idx";
DROP INDEX IF EXISTS "Appointment_clinicId_idx";
DROP INDEX IF EXISTS "Appointment_parentAppointmentId_idx";
DROP INDEX IF EXISTS "Appointment_seriesId_idx";

-- Appointment rows are updated many times in their life (status / check-in / queue / payment):
-- leave room on each page for HOT updates. Applies to newly written pages; existing pages pick it
-- up on the next VACUUM FULL / pg_repack (not done here).
ALTER TABLE "Appointment" SET (fillfactor = 85);

-- Hot, update-heavy tables: vacuum / analyze after 2% / 1% churn instead of the 20% / 10%
-- defaults, so dead tuples and stale statistics don't build up between runs.
ALTER TABLE "Appointment" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "Payment" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "Invoice" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);

-- Append-only logs: insert-triggered vacuum (visibility map / freeze) after 5% new rows.
ALTER TABLE "AuditLog" SET (autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE "NotificationDeliveryLog" SET (autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE "clinic_audit_events" SET (autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE "check_in_attempts" SET (autovacuum_vacuum_insert_scale_factor = 0.05);
