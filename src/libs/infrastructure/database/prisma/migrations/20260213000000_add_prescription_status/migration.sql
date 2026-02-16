-- CreateEnum: PrescriptionStatus
DO $$ BEGIN
  CREATE TYPE "PrescriptionStatus" AS ENUM ('PENDING', 'FILLED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: Add status column to Prescription with default PENDING
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "status" "PrescriptionStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable: Add isActive to User for deactivated user session invalidation
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
