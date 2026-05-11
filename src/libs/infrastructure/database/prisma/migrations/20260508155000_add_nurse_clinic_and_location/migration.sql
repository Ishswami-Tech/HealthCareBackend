-- Add the missing clinic/location foreign keys to Nurse so Prisma relations can resolve

ALTER TABLE "Nurse"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

CREATE INDEX IF NOT EXISTS "Nurse_clinicId_idx" ON "Nurse"("clinicId");
CREATE INDEX IF NOT EXISTS "Nurse_locationId_idx" ON "Nurse"("locationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Nurse_clinicId_fkey'
  ) THEN
    ALTER TABLE "Nurse"
      ADD CONSTRAINT "Nurse_clinicId_fkey"
      FOREIGN KEY ("clinicId")
      REFERENCES "clinics"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Nurse_locationId_fkey'
  ) THEN
    ALTER TABLE "Nurse"
      ADD CONSTRAINT "Nurse_locationId_fkey"
      FOREIGN KEY ("locationId")
      REFERENCES "clinic_locations"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
