-- Add soft-delete columns that exist in schema.prisma but were never migrated.
--
-- These six models declare `deletedAt DateTime?`, and application code filters on
-- `deletedAt: null`, but no migration ever created the column. Databases built with
-- `prisma db push` (local/dev) got the column implicitly; databases built with
-- `prisma migrate deploy` (production) did not, so every query filtering on
-- deletedAt fails with:
--   The column `<Table>.deletedAt` does not exist in the current database.
--
-- Observed in production as repeated failures of
--   GET  /api/v1/user/profile
--   POST /api/v1/profile/completion/update
-- via UsersService.getEmergencyContact() -> prisma.emergencyContact.findFirst().
--
-- Written to be fully idempotent (ALTER TABLE IF EXISTS / ADD COLUMN IF NOT EXISTS)
-- so it is safe to apply to any database regardless of how it was built.

ALTER TABLE IF EXISTS "EmergencyContact" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE IF EXISTS "clinics" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE IF EXISTS "clinic_locations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE IF EXISTS "family_members" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE IF EXISTS "Supplier" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE IF EXISTS "whatsapp_suppression_list" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Partial indexes for the soft-delete filter used on the hot read paths.
CREATE INDEX IF NOT EXISTS "EmergencyContact_deletedAt_idx" ON "EmergencyContact" ("deletedAt");
CREATE INDEX IF NOT EXISTS "clinics_deletedAt_idx" ON "clinics" ("deletedAt");
CREATE INDEX IF NOT EXISTS "clinic_locations_deletedAt_idx" ON "clinic_locations" ("deletedAt");
CREATE INDEX IF NOT EXISTS "family_members_deletedAt_idx" ON "family_members" ("deletedAt");
CREATE INDEX IF NOT EXISTS "Supplier_deletedAt_idx" ON "Supplier" ("deletedAt");
CREATE INDEX IF NOT EXISTS "whatsapp_suppression_list_deletedAt_idx" ON "whatsapp_suppression_list" ("deletedAt");
