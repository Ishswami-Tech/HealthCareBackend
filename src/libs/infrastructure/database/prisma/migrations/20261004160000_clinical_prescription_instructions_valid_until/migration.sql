-- WB8 (clinical batch 2): prescription usage instructions per item and an optional
-- "valid until" date per prescription (ledger B5). No other table changes: the lab
-- report status IN_PROGRESS is a new allowed value of the existing TEXT column.
-- Idempotent: safe to re-run. Not applied automatically.

ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "instructions" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3);
