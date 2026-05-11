-- Restore the clinic/location columns required by user profile relations

ALTER TABLE "Pharmacist"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

ALTER TABLE "Therapist"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

ALTER TABLE "LabTechnician"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

ALTER TABLE "FinanceBilling"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

ALTER TABLE "SupportStaff"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

ALTER TABLE "Counselor"
  ADD COLUMN IF NOT EXISTS "clinicId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

CREATE INDEX IF NOT EXISTS "Pharmacist_clinicId_idx" ON "Pharmacist"("clinicId");
CREATE INDEX IF NOT EXISTS "Pharmacist_locationId_idx" ON "Pharmacist"("locationId");
CREATE INDEX IF NOT EXISTS "Therapist_clinicId_idx" ON "Therapist"("clinicId");
CREATE INDEX IF NOT EXISTS "Therapist_locationId_idx" ON "Therapist"("locationId");
CREATE INDEX IF NOT EXISTS "LabTechnician_clinicId_idx" ON "LabTechnician"("clinicId");
CREATE INDEX IF NOT EXISTS "LabTechnician_locationId_idx" ON "LabTechnician"("locationId");
CREATE INDEX IF NOT EXISTS "FinanceBilling_clinicId_idx" ON "FinanceBilling"("clinicId");
CREATE INDEX IF NOT EXISTS "FinanceBilling_locationId_idx" ON "FinanceBilling"("locationId");
CREATE INDEX IF NOT EXISTS "SupportStaff_clinicId_idx" ON "SupportStaff"("clinicId");
CREATE INDEX IF NOT EXISTS "SupportStaff_locationId_idx" ON "SupportStaff"("locationId");
CREATE INDEX IF NOT EXISTS "Counselor_clinicId_idx" ON "Counselor"("clinicId");
CREATE INDEX IF NOT EXISTS "Counselor_locationId_idx" ON "Counselor"("locationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Pharmacist_clinicId_fkey'
  ) THEN
    ALTER TABLE "Pharmacist"
      ADD CONSTRAINT "Pharmacist_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Pharmacist_locationId_fkey'
  ) THEN
    ALTER TABLE "Pharmacist"
      ADD CONSTRAINT "Pharmacist_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Therapist_clinicId_fkey'
  ) THEN
    ALTER TABLE "Therapist"
      ADD CONSTRAINT "Therapist_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Therapist_locationId_fkey'
  ) THEN
    ALTER TABLE "Therapist"
      ADD CONSTRAINT "Therapist_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LabTechnician_clinicId_fkey'
  ) THEN
    ALTER TABLE "LabTechnician"
      ADD CONSTRAINT "LabTechnician_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LabTechnician_locationId_fkey'
  ) THEN
    ALTER TABLE "LabTechnician"
      ADD CONSTRAINT "LabTechnician_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FinanceBilling_clinicId_fkey'
  ) THEN
    ALTER TABLE "FinanceBilling"
      ADD CONSTRAINT "FinanceBilling_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FinanceBilling_locationId_fkey'
  ) THEN
    ALTER TABLE "FinanceBilling"
      ADD CONSTRAINT "FinanceBilling_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportStaff_clinicId_fkey'
  ) THEN
    ALTER TABLE "SupportStaff"
      ADD CONSTRAINT "SupportStaff_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupportStaff_locationId_fkey'
  ) THEN
    ALTER TABLE "SupportStaff"
      ADD CONSTRAINT "SupportStaff_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Counselor_clinicId_fkey'
  ) THEN
    ALTER TABLE "Counselor"
      ADD CONSTRAINT "Counselor_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Counselor_locationId_fkey'
  ) THEN
    ALTER TABLE "Counselor"
      ADD CONSTRAINT "Counselor_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
