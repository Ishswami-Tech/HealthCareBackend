-- `Appointment.userId` had no index. A PATIENT-role list query ORs it with patientId
-- (CoreAppointmentService.buildAppointmentWhereClause), and with clinicId always ANDed
-- in, the unindexed OR branch made Postgres fall back to a Seq Scan on the whole table
-- for every such query (confirmed with EXPLAIN ANALYZE) instead of using any index.
-- A plain CREATE INDEX blocks writes while it builds; do not queue behind a long transaction.
SET lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS "Appointment_clinicId_userId_idx" ON "Appointment" ("clinicId", "userId");
