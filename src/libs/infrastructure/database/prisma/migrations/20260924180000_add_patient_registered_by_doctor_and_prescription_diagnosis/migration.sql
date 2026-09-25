-- Add registeredByDoctorId to Patient and wire foreign key/index
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "registeredByDoctorId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'Patient_registeredByDoctorId_key'
  ) THEN
    CREATE UNIQUE INDEX "Patient_registeredByDoctorId_key" ON "Patient" ("registeredByDoctorId");
  END IF;
END $$;

IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'Patient_registeredByDoctorId_fkey'
) THEN
  ALTER TABLE "Patient"
    ADD CONSTRAINT "Patient_registeredByDoctorId_fkey"
    FOREIGN KEY ("registeredByDoctorId") REFERENCES "Doctor" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
END IF;

-- Backfill nullable for existing rows
UPDATE "Patient" SET "registeredByDoctorId" = NULL WHERE "registeredByDoctorId" IS NULL;

-- Add diagnosis to Prescription
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "diagnosis" TEXT;
