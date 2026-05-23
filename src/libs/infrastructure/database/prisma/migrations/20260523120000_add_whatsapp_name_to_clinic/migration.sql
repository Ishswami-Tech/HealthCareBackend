-- Add whatsappName column to Clinic table for short clinic name used in WhatsApp templates
-- This field allows storing a shorter clinic name (max 15 chars) for WhatsApp OTP messages

BEGIN;

ALTER TABLE "clinics" ADD COLUMN "whatsappName" TEXT;

-- Create index for faster queries on whatsappName
CREATE INDEX "clinic_whatsapp_name_idx" ON "clinics"("whatsappName") WHERE "whatsappName" IS NOT NULL;

COMMIT;

-- Migration complete
-- To update existing clinics with a short name, run:
-- UPDATE "clinics" SET "whatsappName" = 'Dr.CK Deshmukh' WHERE "name" = 'Dr.Chandrakumar Deshmukh';