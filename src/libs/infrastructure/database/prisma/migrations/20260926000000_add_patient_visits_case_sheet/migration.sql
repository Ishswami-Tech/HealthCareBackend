-- OPD registration / per-visit case-sheet (Basic Details + History)
-- Adds: demographic fields on users, PatientVisit (OPD encounter),
-- visit vitals examination, classical exam findings, family-history duration,
-- and optional visit traceability on MedicalHistory / Medication.

-- 1. Demographics on users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "area" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "district" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "occupation" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization" TEXT;

-- 2. Family history duration (reference UI records "Duration", not diagnosed age)
ALTER TABLE "FamilyHistory" ADD COLUMN IF NOT EXISTS "duration" TEXT;

-- 3. Per-visit traceability for past-history rows and medicine-history rows
ALTER TABLE "MedicalHistory" ADD COLUMN IF NOT EXISTS "visitId" TEXT;
CREATE INDEX IF NOT EXISTS "MedicalHistory_visitId_idx" ON "MedicalHistory"("visitId");

ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "visitId" TEXT;
CREATE INDEX IF NOT EXISTS "Medication_visitId_idx" ON "Medication"("visitId");

-- 3b. Data repair: POST /ehr/medications used to drop the caller's clinicId, so
--     those rows were invisible to the clinic-scoped GET. Attribute them to the
--     patient's primary clinic (idempotent; only touches NULL clinicId rows).
UPDATE "Medication" m
SET "clinicId" = u."primaryClinicId"
FROM "users" u
WHERE m."userId" = u.id
  AND m."clinicId" IS NULL
  AND u."primaryClinicId" IS NOT NULL;

-- 4. Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SpecialCaseFlag') THEN
    CREATE TYPE "SpecialCaseFlag" AS ENUM ('MINOR', 'PHYSICAL_HANDICAP', 'PREGNANT_OR_SENIOR_CITIZEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClassicalExamType') THEN
    CREATE TYPE "ClassicalExamType" AS ENUM (
      'ASHTAVIDHA_PARIKSHA',
      'DASHAVIDHA_PARIKSHA',
      'SROTAS_PARIKSHA',
      'SAMPRAPTI_GHATAKA',
      'PAIN_ASSESSMENT',
      'PERSONAL_HISTORY'
    );
  END IF;
END $$;

-- 5. Patient visits (OPD encounters). Plain string FKs, matching the
--    lowercase Ayurveda models; OPD numbers are unique per clinic.
CREATE TABLE IF NOT EXISTS "patient_visits" (
  "id" TEXT NOT NULL,
  "opdNumber" TEXT NOT NULL,
  "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "doctorId" TEXT,
  "specialCaseFlags" "SpecialCaseFlag"[],
  "internationalId" TEXT,
  "presentIllness" TEXT,
  "presentComplaints" TEXT,
  "knownCaseOf" TEXT,
  "pastHistoryNotes" TEXT,
  "habits" JSONB,
  "nidra" TEXT,
  "nidraNotes" TEXT,
  "foodAllergyNotes" TEXT,
  "drugAllergyNotes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "patient_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "patient_visits_clinicId_opdNumber_key" ON "patient_visits"("clinicId", "opdNumber");
CREATE INDEX IF NOT EXISTS "patient_visits_patientId_idx" ON "patient_visits"("patientId");
CREATE INDEX IF NOT EXISTS "patient_visits_clinicId_idx" ON "patient_visits"("clinicId");

-- 5b. Per-clinic OPD number counter (atomic upsert-increment; see PatientVisitsService)
CREATE TABLE IF NOT EXISTS "opd_sequences" (
  "clinicId" TEXT NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "opd_sequences_pkey" PRIMARY KEY ("clinicId")
);

-- Seed counters from any visits that already exist so numbering continues.
INSERT INTO "opd_sequences" ("clinicId", "lastValue", "updatedAt")
SELECT "clinicId",
       COALESCE(MAX(CAST(SUBSTRING("opdNumber" FROM '([0-9]+)$') AS INTEGER)), 0),
       CURRENT_TIMESTAMP
FROM "patient_visits"
WHERE "opdNumber" ~ '^OPD-'
GROUP BY "clinicId"
ON CONFLICT ("clinicId") DO NOTHING;

-- 6. General Examination + Physical Measurement snapshot, one row per visit
CREATE TABLE IF NOT EXISTS "visit_vitals_examinations" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "heightCm" DOUBLE PRECISION,
  "weightKg" DOUBLE PRECISION,
  "bmi" DOUBLE PRECISION,
  "temperatureC" DOUBLE PRECISION,
  "pulse" INTEGER,
  "bpSystolic" INTEGER,
  "bpDiastolic" INTEGER,
  "rr" INTEGER,
  "painScore" INTEGER,
  "fbs" DOUBLE PRECISION,
  "ppbs" DOUBLE PRECISION,
  "pbs" DOUBLE PRECISION,
  "spo2" DOUBLE PRECISION,
  "sleep" TEXT,
  "bowel" TEXT,
  "appetite" TEXT,
  "neck" DOUBLE PRECISION,
  "chest" DOUBLE PRECISION,
  "upperAbs" DOUBLE PRECISION,
  "waist" DOUBLE PRECISION,
  "lowerAbs" DOUBLE PRECISION,
  "hips" DOUBLE PRECISION,
  "thighLeft" DOUBLE PRECISION,
  "thighRight" DOUBLE PRECISION,
  "calfLeft" DOUBLE PRECISION,
  "calfRight" DOUBLE PRECISION,
  "upperArmLeft" DOUBLE PRECISION,
  "upperArmRight" DOUBLE PRECISION,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visit_vitals_examinations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visit_vitals_examinations_visitId_key" ON "visit_vitals_examinations"("visitId");

-- 7. Classical examination findings: one row per (visit, exam type, category)
CREATE TABLE IF NOT EXISTS "classical_exam_findings" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "examType" "ClassicalExamType" NOT NULL,
  "categoryKey" TEXT NOT NULL,
  "selectedOptions" TEXT[],
  "remark" TEXT,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "classical_exam_findings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "classical_exam_findings_visitId_examType_categoryKey_key" ON "classical_exam_findings"("visitId", "examType", "categoryKey");
CREATE INDEX IF NOT EXISTS "classical_exam_findings_visitId_idx" ON "classical_exam_findings"("visitId");
CREATE INDEX IF NOT EXISTS "classical_exam_findings_examType_idx" ON "classical_exam_findings"("examType");
