-- Add missing soft-delete column used by the current Prisma schema. Nullable and idempotent, so this is safe for production data.
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "EmergencyContact_deletedAt_idx" ON "EmergencyContact"("deletedAt");

