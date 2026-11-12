-- Document uploads now run as a background queue job (the configured S3-compatible
-- provider has been observed taking anywhere from under a second to 90+ seconds per
-- upload); a HealthRecord for an in-flight upload is created PENDING and flipped to
-- READY/FAILED once the job finishes. Default is READY (not PENDING) so every existing
-- row - all of which already have fileUrl set - is correctly backfilled as already
-- uploaded, and any other HealthRecord creation path that isn't a file upload (lab
-- reports entered with a report string, etc.) stays READY from creation.
-- Idempotent: dev databases may already have this type via `prisma db push`, and unlike
-- CREATE TABLE, Postgres has no CREATE TYPE ... IF NOT EXISTS.
DO $$ BEGIN
  CREATE TYPE "HealthRecordUploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "uploadStatus" "HealthRecordUploadStatus" NOT NULL DEFAULT 'READY';
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "HealthRecord" ADD COLUMN IF NOT EXISTS "s3Key" TEXT;
