-- Add registeredByDoctorId to Patient and wire foreign key/index
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "registeredByDoctorId" TEXT;

DROP INDEX IF EXISTS "Patient_registeredByDoctorId_key";
CREATE INDEX IF NOT EXISTS "Patient_registeredByDoctorId_idx" ON "Patient" ("registeredByDoctorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Patient_registeredByDoctorId_fkey'
  ) THEN
    ALTER TABLE "Patient"
      ADD CONSTRAINT "Patient_registeredByDoctorId_fkey"
      FOREIGN KEY ("registeredByDoctorId") REFERENCES "Doctor" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add diagnosis to Prescription
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "diagnosis" TEXT;
