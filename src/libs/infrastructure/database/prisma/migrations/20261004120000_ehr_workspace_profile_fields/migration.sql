-- WB3: EHR workspace + patient profile.
--  * User.maritalStatus / User.bloodGroup (patient profile)
--  * MedicalHistory.status / LabReport.status (record status in responses)
--  * care_plans (one living care plan per patient per clinic)
--  * medication_dose_logs (patient-marked taken doses; missed doses are derived)
-- Idempotent: safe to re-run. Not applied automatically.

-- 1. Patient profile columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "maritalStatus" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bloodGroup" TEXT;

-- 2. Record status columns (existing rows get the neutral default)
ALTER TABLE "MedicalHistory" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "LabReport" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED';

-- 3. Care plans
CREATE TABLE IF NOT EXISTS "care_plans" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Care plan',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "summary" TEXT,
  "goals" JSONB NOT NULL DEFAULT '[]',
  "interventions" JSONB NOT NULL DEFAULT '[]',
  "dietNotes" TEXT,
  "lifestyleNotes" TEXT,
  "nextReviewDate" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "care_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "care_plans_clinicId_patientId_key" ON "care_plans"("clinicId", "patientId");
CREATE INDEX IF NOT EXISTS "care_plans_patientId_idx" ON "care_plans"("patientId");

-- 4. Medication dose log
CREATE TABLE IF NOT EXISTS "medication_dose_logs" (
  "id" TEXT NOT NULL,
  "medicationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clinicId" TEXT,
  "doseDate" DATE NOT NULL,
  "doseIndex" INTEGER NOT NULL,
  "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "medication_dose_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "medication_dose_logs_medicationId_doseDate_doseIndex_key"
  ON "medication_dose_logs"("medicationId", "doseDate", "doseIndex");
CREATE INDEX IF NOT EXISTS "medication_dose_logs_userId_doseDate_idx"
  ON "medication_dose_logs"("userId", "doseDate");
