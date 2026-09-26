-- Case-sheet phase 2: Bill History (invoice links), Therapy / Panchakarma,
-- Diet chart (4 languages), Investigations & Documents.
-- Idempotent: safe to re-run (IF NOT EXISTS / DO $$ guards).

-- 1. Bill type enum + invoice links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillType') THEN
    CREATE TYPE "BillType" AS ENUM ('CONSULTATION', 'PHARMACY', 'APPOINTMENT', 'SUBSCRIPTION', 'IPD', 'OTHER');
  END IF;
END $$;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "billType" "BillType" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "visitId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "prescriptionId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_visitId_billType_key" ON "Invoice"("visitId", "billType");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_prescriptionId_billType_key" ON "Invoice"("prescriptionId", "billType");
CREATE INDEX IF NOT EXISTS "Invoice_patientId_createdAt_idx" ON "Invoice"("patientId", "createdAt");
CREATE INDEX IF NOT EXISTS "Invoice_clinicId_patientId_idx" ON "Invoice"("clinicId", "patientId");

CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- 1b. Prescription -> OPD visit link
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "visitId" TEXT;
CREATE INDEX IF NOT EXISTS "Prescription_visitId_idx" ON "Prescription"("visitId");

-- 2. Therapy / Panchakarma plans and sessions
CREATE TABLE IF NOT EXISTS "visit_therapy_plans" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "procedure" "TreatmentType" NOT NULL,
  "procedureLabel" TEXT,
  "plannedSessions" INTEGER NOT NULL,
  "completedSessions" INTEGER NOT NULL DEFAULT 0,
  "frequency" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "therapistUserId" TEXT,
  "medicinesUsed" TEXT,
  "notes" TEXT,
  "status" "TherapyStatus" NOT NULL DEFAULT 'SCHEDULED',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visit_therapy_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "visit_therapy_plans_visitId_idx" ON "visit_therapy_plans"("visitId");
CREATE INDEX IF NOT EXISTS "visit_therapy_plans_patientId_clinicId_idx" ON "visit_therapy_plans"("patientId", "clinicId");
CREATE INDEX IF NOT EXISTS "visit_therapy_plans_therapistUserId_status_idx" ON "visit_therapy_plans"("therapistUserId", "status");

CREATE TABLE IF NOT EXISTS "visit_therapy_sessions" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "sessionNumber" INTEGER NOT NULL,
  "sessionDate" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER,
  "observations" TEXT,
  "patientResponse" TEXT,
  "painScore" INTEGER,
  "status" "TherapyStatus" NOT NULL DEFAULT 'COMPLETED',
  "performedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visit_therapy_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visit_therapy_sessions_planId_sessionNumber_key" ON "visit_therapy_sessions"("planId", "sessionNumber");
CREATE INDEX IF NOT EXISTS "visit_therapy_sessions_planId_idx" ON "visit_therapy_sessions"("planId");
CREATE INDEX IF NOT EXISTS "visit_therapy_sessions_performedBy_sessionDate_idx" ON "visit_therapy_sessions"("performedBy", "sessionDate");

-- 3. Diet chart
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DietAdviceCategory') THEN
    CREATE TYPE "DietAdviceCategory" AS ENUM ('TAKE', 'AVOID', 'OCCASIONAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "diet_chart_foods" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT,
  "key" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameGu" TEXT,
  "nameHi" TEXT,
  "nameMr" TEXT,
  "group" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "diet_chart_foods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "diet_chart_foods_clinicId_key_key" ON "diet_chart_foods"("clinicId", "key");
CREATE INDEX IF NOT EXISTS "diet_chart_foods_clinicId_idx" ON "diet_chart_foods"("clinicId");

CREATE TABLE IF NOT EXISTS "visit_diet_charts" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "printLanguage" TEXT NOT NULL DEFAULT 'en',
  "notes" TEXT,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visit_diet_charts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visit_diet_charts_visitId_key" ON "visit_diet_charts"("visitId");
CREATE INDEX IF NOT EXISTS "visit_diet_charts_patientId_idx" ON "visit_diet_charts"("patientId");
CREATE INDEX IF NOT EXISTS "visit_diet_charts_clinicId_idx" ON "visit_diet_charts"("clinicId");

CREATE TABLE IF NOT EXISTS "visit_diet_chart_items" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "category" "DietAdviceCategory" NOT NULL,
  "foodId" TEXT,
  "nameEn" TEXT NOT NULL,
  "nameGu" TEXT,
  "nameHi" TEXT,
  "nameMr" TEXT,
  "note" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visit_diet_chart_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "visit_diet_chart_items_visitId_idx" ON "visit_diet_chart_items"("visitId");
CREATE INDEX IF NOT EXISTS "visit_diet_chart_items_visitId_category_idx" ON "visit_diet_chart_items"("visitId", "category");

-- 4. Investigations & Documents
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PatientDocumentCategory') THEN
    CREATE TYPE "PatientDocumentCategory" AS ENUM ('INVESTIGATION', 'DOCUMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PatientDocumentMediaKind') THEN
    CREATE TYPE "PatientDocumentMediaKind" AS ENUM ('IMAGE', 'PDF', 'AUDIO', 'VIDEO', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "patient_documents" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "visitId" TEXT,
  "category" "PatientDocumentCategory" NOT NULL,
  "subType" TEXT,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "reportDate" TIMESTAMP(3),
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "mediaKind" "PatientDocumentMediaKind" NOT NULL DEFAULT 'OTHER',
  "fileSize" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "checksum" TEXT,
  "labReportId" TEXT,
  "uploadedBy" TEXT NOT NULL,
  "uploadedByRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,

  CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patient_documents_clinicId_patientId_category_deletedAt_idx" ON "patient_documents"("clinicId", "patientId", "category", "deletedAt");
CREATE INDEX IF NOT EXISTS "patient_documents_visitId_idx" ON "patient_documents"("visitId");
