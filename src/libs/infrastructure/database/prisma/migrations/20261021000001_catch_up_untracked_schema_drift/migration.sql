-- Audit item P0-3 (docs/DEPLOY_MIGRATIONS.md): schema.prisma had evolved further than any
-- migration captured (more db-push drift, same root cause as
-- 20260508154500_backfill_missing_schema_objects). This migration is the exact output of
-- `prisma migrate diff --from-migrations <dir> --to-schema schema.prisma --script` run
-- against a fresh replay of the full migration history, made idempotent (IF EXISTS / IF NOT
-- EXISTS / DO-block exception guards) so it is also safe to resolve as already-applied on a
-- database that was kept in sync by `db push` instead (dev, and probably production).


-- AlterEnum - KNOWN GAP, deliberately left out, see docs/DEPLOY_MIGRATIONS.md:
-- schema.prisma's "AppointmentType" has only IN_PERSON / VIDEO_CALL / HOME_VISIT; the init
-- migration created it with 12 more (ayurveda-specific) values that were dropped later via
-- `db push`, never via a migration. The standard Prisma create-new-type/swap/drop-old SQL for
-- that reshape (verified correct in isolation, and against this exact live database's already-
-- shrunk enum) reproducibly makes `prisma migrate deploy` fail with a spurious
-- `operator does not exist: "AppointmentType_new" = "AppointmentType"` error specifically when
-- run as part of this migration chain - looks like a Prisma 7 migration-engine issue, not a bug
-- in this SQL. Every environment this matters for (dev, and by the P0-3 assumption, production)
-- already has the 3-value enum, so the gap is latent: a genuinely fresh database would end up
-- with the 12 extra, unused enum values, which is harmless (nothing in the app ever writes
-- them) until this is root-caused and re-added as its own migration.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'ASSISTANT_DOCTOR';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'CLINIC_LOCATION_HEAD';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_locationId_fkey";

-- DropForeignKey
ALTER TABLE "AssistantDoctorCoverageAssignment" DROP CONSTRAINT IF EXISTS "AssistantDoctorCoverageAssignment_assistantDoctorId_fkey";

-- DropForeignKey
ALTER TABLE "AssistantDoctorCoverageAssignment" DROP CONSTRAINT IF EXISTS "AssistantDoctorCoverageAssignment_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "AssistantDoctorCoverageAssignment" DROP CONSTRAINT IF EXISTS "AssistantDoctorCoverageAssignment_primaryDoctorId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Appointment_clinicId_status_confirmationExpiresAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "Appointment_clinicId_status_paymentExpiresAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "Appointment_clinic_patient_idx";

-- DropIndex
DROP INDEX IF EXISTS "EmergencyContact_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "Patient_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "Supplier_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "clinic_locations_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "clinics_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "family_members_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "patient_contact_points_value_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "patient_identifiers_value_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "patient_visits_clinic_patient_date_idx";

-- DropIndex
DROP INDEX IF EXISTS "patient_visits_opdNumber_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "idx_users_deleted_at";

-- DropIndex
DROP INDEX IF EXISTS "users_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "whatsapp_suppression_list_deletedAt_idx";

-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "treatmentType" SET NOT NULL,
ALTER COLUMN "isFollowUp" SET NOT NULL;

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN IF NOT EXISTS "clinicId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "CheckInLocation" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

-- AlterTable
ALTER TABLE "NadiPariksha" ADD COLUMN IF NOT EXISTS "clinicId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "channel" TEXT,
ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deliveryReceipt" JSONB,
ADD COLUMN IF NOT EXISTS "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failureReason" TEXT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "surchargeServiceCharge" DROP NOT NULL,
ALTER COLUMN "surchargeServiceTax" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PrakritiAnalysis" ADD COLUMN IF NOT EXISTS "clinicId" TEXT;

-- AlterTable
ALTER TABLE "RecurringAppointmentSeries" ALTER COLUMN "endDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ayurvedic_diagnoses" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "secondaryDiseases" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dosha_imbalances" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "vitalsAffected" DROP DEFAULT,
ALTER COLUMN "symptoms" DROP DEFAULT,
ALTER COLUMN "rootCauses" DROP DEFAULT,
ALTER COLUMN "interventions" DROP DEFAULT;

-- AlterTable
ALTER TABLE "email_suppression_list" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "nadi_pariksha_records" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "prakriti_assessment_questions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "prakriti_assessments" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "vataScore" DROP DEFAULT,
ALTER COLUMN "pittaScore" DROP DEFAULT,
ALTER COLUMN "kaphaScore" DROP DEFAULT,
ALTER COLUMN "questionnaireAnswers" SET NOT NULL;

-- AlterTable
ALTER TABLE "samprapti_stages" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "symptoms" DROP DEFAULT;

-- AlterTable
ALTER TABLE "system_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN IF EXISTS "deletedat";

-- DropTable
DROP TABLE IF EXISTS "VideoConsultation";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_isFollowUp_idx" ON "Appointment"("isFollowUp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_originalAppointmentId_idx" ON "Appointment"("originalAppointmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_doctorId_clinicId_date_idx" ON "Appointment"("doctorId", "clinicId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_patientId_status_date_idx" ON "Appointment"("patientId", "status", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_clinicId_date_status_idx" ON "Appointment"("clinicId", "date", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_clinicId_isFollowUp_type_idx" ON "Appointment"("clinicId", "isFollowUp", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_parentAppointmentId_date_idx" ON "Appointment"("parentAppointmentId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_seriesId_seriesSequence_idx" ON "Appointment"("seriesId", "seriesSequence");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CheckIn_locationId_checkedInAt_idx" ON "CheckIn"("locationId", "checkedInAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CheckIn_patientId_checkedInAt_idx" ON "CheckIn"("patientId", "checkedInAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CheckIn_clinicId_locationId_checkedInAt_idx" ON "CheckIn"("clinicId", "locationId", "checkedInAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CheckInLocation_locationId_key" ON "CheckInLocation"("locationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CheckInLocation_locationId_idx" ON "CheckInLocation"("locationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_appointmentId_idx" ON "FollowUpPlan"("appointmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_clinicId_idx" ON "FollowUpPlan"("clinicId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_status_idx" ON "FollowUpPlan"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_scheduledFor_idx" ON "FollowUpPlan"("scheduledFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_followUpAppointmentId_idx" ON "FollowUpPlan"("followUpAppointmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_patientId_status_scheduledFor_idx" ON "FollowUpPlan"("patientId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_clinicId_status_scheduledFor_idx" ON "FollowUpPlan"("clinicId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FollowUpPlan_doctorId_scheduledFor_idx" ON "FollowUpPlan"("doctorId", "scheduledFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NadiPariksha_clinicId_idx" ON "NadiPariksha"("clinicId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_deliveryStatus_idx" ON "Notification"("userId", "deliveryStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_deliveryStatus_idx" ON "Notification"("deliveryStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PrakritiAnalysis_clinicId_idx" ON "PrakritiAnalysis"("clinicId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RecurringAppointmentSeries_status_idx" ON "RecurringAppointmentSeries"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "users"("phone");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FollowUpPlan" ADD CONSTRAINT "FollowUpPlan_followUpAppointmentId_fkey" FOREIGN KEY ("followUpAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FollowUpPlan" ADD CONSTRAINT "FollowUpPlan_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FollowUpPlan" ADD CONSTRAINT "FollowUpPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FollowUpPlan" ADD CONSTRAINT "FollowUpPlan_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FollowUpPlan" ADD CONSTRAINT "FollowUpPlan_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AssistantDoctorCoverageAssignment" ADD CONSTRAINT "AssistantDoctorCoverageAssignment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AssistantDoctorCoverageAssignment" ADD CONSTRAINT "AssistantDoctorCoverageAssignment_assistantDoctorId_fkey" FOREIGN KEY ("assistantDoctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AssistantDoctorCoverageAssignment" ADD CONSTRAINT "AssistantDoctorCoverageAssignment_primaryDoctorId_fkey" FOREIGN KEY ("primaryDoctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CheckInLocation" ADD CONSTRAINT "CheckInLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- RenameIndex
DO $$ BEGIN
  ALTER INDEX "AssistantDoctorCoverageAssignment_clinicId_assistantDoctorId_pr" RENAME TO "AssistantDoctorCoverageAssignment_clinicId_assistantDoctorI_key";
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- RenameIndex
DO $$ BEGIN
  ALTER INDEX "email_reason_clinicId_unique" RENAME TO "email_suppression_list_email_reason_clinicId_key";
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

