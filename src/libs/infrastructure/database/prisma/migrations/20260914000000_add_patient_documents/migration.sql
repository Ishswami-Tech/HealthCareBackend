-- Patient document uploads from the patient portal.
--
-- Background: the portal's Quick Upload wrote prescriptions and generic
-- documents into "HealthRecord", which is keyed on Patient.id and requires a
-- Doctor.id, so a patient uploading their own file violated both foreign keys.
-- The comprehensive health record never read that table either, so anything
-- that did get written was invisible. Patient uploads now live here, keyed on
-- the user like every other EHR table.

CREATE TABLE IF NOT EXISTS "patient_documents" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "clinicId" TEXT,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "fileUrl" TEXT,
  "fileKey" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "uploadedBy" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patient_documents_userId_idx" ON "patient_documents"("userId");
CREATE INDEX IF NOT EXISTS "patient_documents_clinicId_idx" ON "patient_documents"("clinicId");
CREATE INDEX IF NOT EXISTS "patient_documents_category_idx" ON "patient_documents"("category");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_documents_userId_fkey'
  ) THEN
    ALTER TABLE "patient_documents"
      ADD CONSTRAINT "patient_documents_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- RadiologyReport had nowhere to store an attachment, so the upload endpoint was
-- pushing onto an "images" column that does not exist and failing at the write.
ALTER TABLE "RadiologyReport" ADD COLUMN IF NOT EXISTS "fileUrl" TEXT;
ALTER TABLE "RadiologyReport" ADD COLUMN IF NOT EXISTS "fileKey" TEXT;
