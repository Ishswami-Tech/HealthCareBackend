-- How the patient found the clinic (from the old register: Friend/Relative, Doctor, Direct ...). Idempotent.
ALTER TABLE "patient_visits" ADD COLUMN IF NOT EXISTS "referenceSource" TEXT;
