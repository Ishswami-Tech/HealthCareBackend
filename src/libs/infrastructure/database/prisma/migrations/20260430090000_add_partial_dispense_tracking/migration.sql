-- Add partial dispense tracking to prescriptions and prescription items.

DO $$
BEGIN
  ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PrescriptionItem"
  ADD COLUMN IF NOT EXISTS "dispensedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dispensedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dispensedBatchNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "dispensedBatchExpiryDate" TIMESTAMP(3);
