-- WB4: doctor profile fields (fees, slot length, consultation toggles, licence,
-- languages, education, certifications) and Review.appointmentId (one review per
-- appointment). Idempotent: safe to re-run.

ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "videoConsultationFee" DOUBLE PRECISION;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "slotDurationMinutes" INTEGER;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "videoConsultationEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "inPersonConsultationEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "licenseNumber" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "education" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Review_appointmentId_key" ON "Review"("appointmentId");
CREATE INDEX IF NOT EXISTS "Review_doctorId_clinicId_createdAt_idx" ON "Review"("doctorId", "clinicId", "createdAt");
