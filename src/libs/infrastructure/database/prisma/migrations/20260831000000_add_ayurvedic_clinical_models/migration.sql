-- Add ayurvedic clinical data models

-- 1. Prakriti Assessment table
CREATE TABLE IF NOT EXISTS "prakriti_assessments" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT,
  "primaryDosha" TEXT NOT NULL,
  "secondaryDosha" TEXT,
  "vataScore" INTEGER NOT NULL DEFAULT 0,
  "pittaScore" INTEGER NOT NULL DEFAULT 0,
  "kaphaScore" INTEGER NOT NULL DEFAULT 0,
  "questionnaireAnswers" JSONB,
  "patientNotes" TEXT,
  "practitionerNotes" TEXT,
  "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "recommendations" TEXT,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,

  CONSTRAINT "prakriti_assessments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "prakriti_assessments_patientId_idx" ON "prakriti_assessments"("patientId");
CREATE INDEX IF NOT EXISTS "prakriti_assessments_clinicId_idx" ON "prakriti_assessments"("clinicId");
CREATE INDEX IF NOT EXISTS "prakriti_assessments_assessedAt_idx" ON "prakriti_assessments"("assessedAt");

-- 2. Nadi Pariksha (Pulse Diagnosis) table
CREATE TABLE IF NOT EXISTS "nadi_pariksha_records" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT,
  "dominantDosha" TEXT NOT NULL,
  "pulseQuality" TEXT NOT NULL,
  "regularity" TEXT,
  "strength" TEXT,
  "abnormalities" TEXT,
  "interpretation" TEXT NOT NULL,
  "observations" TEXT,
  "side" TEXT,
  "performedBy" TEXT NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "nadi_pariksha_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "nadi_pariksha_records_patientId_idx" ON "nadi_pariksha_records"("patientId");
CREATE INDEX IF NOT EXISTS "nadi_pariksha_records_clinicId_idx" ON "nadi_pariksha_records"("clinicId");
CREATE INDEX IF NOT EXISTS "nadi_pariksha_records_assessedAt_idx" ON "nadi_pariksha_records"("assessedAt");

-- 3. Dosha Imbalance table
CREATE TABLE IF NOT EXISTS "dosha_imbalances" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT,
  "diagnosisId" TEXT,
  "doshaType" TEXT NOT NULL,
  "imbalanceType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "vitalsAffected" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "symptoms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "rootCauses" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "practitionerNotes" TEXT,
  "interventions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assessedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dosha_imbalances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dosha_imbalances_patientId_idx" ON "dosha_imbalances"("patientId");
CREATE INDEX IF NOT EXISTS "dosha_imbalances_clinicId_idx" ON "dosha_imbalances"("clinicId");
CREATE INDEX IF NOT EXISTS "dosha_imbalances_doshaType_idx" ON "dosha_imbalances"("doshaType");
CREATE INDEX IF NOT EXISTS "dosha_imbalances_assessedAt_idx" ON "dosha_imbalances"("assessedAt");

-- 4. Ayurvedic Diagnosis table
CREATE TABLE IF NOT EXISTS "ayurvedic_diagnoses" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT,
  "prakritiAssessmentId" TEXT,
  "nadiParikshaId" TEXT,
  "primaryDisease" TEXT NOT NULL,
  "secondaryDiseases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "diseaseClassification" TEXT,
  "vyadhiType" TEXT,
  "clinicalAssessment" TEXT NOT NULL,
  "agniStatus" TEXT,
  "amaPresence" TEXT,
  "srotasAffected" TEXT,
  "notes" TEXT,
  "confidenceLevel" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT,
  "diagnosedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ayurvedic_diagnoses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ayurvedic_diagnoses_patientId_idx" ON "ayurvedic_diagnoses"("patientId");
CREATE INDEX IF NOT EXISTS "ayurvedic_diagnoses_clinicId_idx" ON "ayurvedic_diagnoses"("clinicId");
CREATE INDEX IF NOT EXISTS "ayurvedic_diagnoses_diagnosedAt_idx" ON "ayurvedic_diagnoses"("diagnosedAt");
CREATE INDEX IF NOT EXISTS "ayurvedic_diagnoses_status_idx" ON "ayurvedic_diagnoses"("status");

-- 5. Samprapti Stage table
CREATE TABLE IF NOT EXISTS "samprapti_stages" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "diagnosisId" TEXT NOT NULL,
  "clinicId" TEXT,
  "stageName" TEXT NOT NULL,
  "stageOrder" INTEGER NOT NULL,
  "doshaInvolved" TEXT NOT NULL,
  "dhatuAffected" TEXT,
  "description" TEXT NOT NULL,
  "symptoms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "clinicalFindings" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "completedAt" TIMESTAMP(3),
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "samprapti_stages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "samprapti_stages_diagnosisId_idx" ON "samprapti_stages"("diagnosisId");
CREATE INDEX IF NOT EXISTS "samprapti_stages_clinicId_idx" ON "samprapti_stages"("clinicId");
CREATE INDEX IF NOT EXISTS "samprapti_stages_stageOrder_idx" ON "samprapti_stages"("stageOrder");

-- 6. Prakriti Assessment Question table
CREATE TABLE IF NOT EXISTS "prakriti_assessment_questions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "questionText" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "prakriti_assessment_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "prakriti_assessment_questions_category_idx" ON "prakriti_assessment_questions"("category");
CREATE INDEX IF NOT EXISTS "prakriti_assessment_questions_displayOrder_idx" ON "prakriti_assessment_questions"("displayOrder");
