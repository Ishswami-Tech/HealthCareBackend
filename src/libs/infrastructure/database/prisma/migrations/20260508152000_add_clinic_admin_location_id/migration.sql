-- Add missing ClinicAdmin.locationId column for local-prod schema alignment
ALTER TABLE "ClinicAdmin"
ADD COLUMN IF NOT EXISTS "locationId" TEXT;

CREATE INDEX IF NOT EXISTS "ClinicAdmin_locationId_idx"
ON "ClinicAdmin" ("locationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ClinicAdmin_locationId_fkey'
  ) THEN
    ALTER TABLE "ClinicAdmin"
    ADD CONSTRAINT "ClinicAdmin_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
