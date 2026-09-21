-- Add new columns to HealthRecord model
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER;
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "uploadedBy" TEXT;
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Add indexes
CREATE INDEX IF NOT EXISTS "HealthRecord_patientId_idx" ON "HealthRecord"("patientId");
CREATE INDEX IF NOT EXISTS "HealthRecord_doctorId_idx" ON "HealthRecord"("doctorId");
CREATE INDEX IF NOT EXISTS "HealthRecord_recordType_idx" ON "HealthRecord"("recordType");
CREATE INDEX IF NOT EXISTS "HealthRecord_createdAt_idx" ON "HealthRecord"("createdAt");
CREATE INDEX IF NOT EXISTS "HealthRecord_clinicId_recordType_idx" ON "HealthRecord"("clinicId", "recordType");
