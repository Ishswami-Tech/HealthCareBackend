-- Add missing location reference to receptionists
ALTER TABLE "Receptionist"
ADD COLUMN IF NOT EXISTS "locationId" TEXT;

CREATE INDEX IF NOT EXISTS "Receptionist_locationId_idx"
ON "Receptionist"("locationId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Receptionist_locationId_fkey'
  ) THEN
    ALTER TABLE "Receptionist"
    ADD CONSTRAINT "Receptionist_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

