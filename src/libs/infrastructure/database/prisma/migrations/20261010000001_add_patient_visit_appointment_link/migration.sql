-- One OPD visit per appointment; NULL for walk-ins. Idempotent so it can be applied before the deploy.
ALTER TABLE "patient_visits" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "patient_visits_appointmentId_key" ON "patient_visits"("appointmentId");
