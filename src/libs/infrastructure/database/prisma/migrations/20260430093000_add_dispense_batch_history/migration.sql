ALTER TABLE "PrescriptionItem"
ADD COLUMN IF NOT EXISTS "dispenseBatchHistory" JSONB;
