-- Same root cause as 20261021000001_catch_up_untracked_schema_drift (docs/DEPLOY_MIGRATIONS.md,
-- audit item P0-3): three commits after that catch-up migration (edf9411f, 7991c82a, a408baab)
-- each applied an additive schema.prisma change directly against the dev database (`db push` or
-- raw SQL) because `migrate dev`/`db push` refused without an explicit reset, same as before —
-- and none of them committed a migration file. This is the exact output of
-- `prisma migrate diff --from-migrations <dir> --to-schema schema.prisma --script`, with
-- `ADD COLUMN` made idempotent (`IF NOT EXISTS`) so it is also safe to apply (as a no-op) against
-- a database already kept in sync by `db push` instead — dev, and probably production.
--
-- AlterEnum - KNOWN GAP, deliberately left out again, see docs/DEPLOY_MIGRATIONS.md and
-- 20261021000001's own header: the diff also proposed re-dropping the 12 unused Ayurveda-specific
-- AppointmentType enum values, which is the exact same migration-engine issue documented there
-- (reproducibly fails `prisma migrate deploy` with a spurious
-- `operator does not exist: "AppointmentType_new" = "AppointmentType"` error). Every environment
-- this matters for already has the 3-value enum from db push; left out again until that's
-- root-caused.

-- AlterTable
ALTER TABLE "BillingPlan" ADD COLUMN IF NOT EXISTS "allowFamilyBooking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "abdmHprId" TEXT;

-- AlterTable
ALTER TABLE "clinic_locations" ADD COLUMN IF NOT EXISTS "abdmHfrId" TEXT;

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "abdmHipId" TEXT,
ADD COLUMN IF NOT EXISTS "supportEmail" TEXT,
ADD COLUMN IF NOT EXISTS "supportPhone" TEXT;
