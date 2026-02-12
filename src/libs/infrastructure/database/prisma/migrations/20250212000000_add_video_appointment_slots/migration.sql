-- AlterEnum: Add new values to AppointmentStatus (skip if already exists - run manually if needed)
DO $$ BEGIN
  ALTER TYPE "AppointmentStatus" ADD VALUE 'FOLLOW_UP_SCHEDULED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AppointmentStatus" ADD VALUE 'AWAITING_SLOT_CONFIRMATION';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: Make locationId optional
ALTER TABLE "Appointment" ALTER COLUMN "locationId" DROP NOT NULL;

-- AlterTable: Add proposedSlots and confirmedSlotIndex
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "proposedSlots" JSONB;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmedSlotIndex" INTEGER;
