-- Add structured event history for pharmacy dispense, substitution, and reversal workflows
ALTER TABLE "PrescriptionItem"
ADD COLUMN IF NOT EXISTS "dispenseEventHistory" JSONB;
