-- One OPD visit per appointment; NULL for walk-ins.
ALTER TABLE "patient_visits" ADD COLUMN "appointmentId" TEXT;
CREATE UNIQUE INDEX "patient_visits_appointmentId_key" ON "patient_visits"("appointmentId");
