-- Dated per-day OPD availability override + L3 cascade reassignment proposals.
-- Idempotent (IF NOT EXISTS): dev databases already received these objects via `prisma db push`.

CREATE TABLE IF NOT EXISTS "doctor_day_availability" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "locationId" TEXT,
    "date" DATE NOT NULL,
    "sessions" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "doctor_day_availability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "doctor_reassignment_proposal" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "autoEligible" BOOLEAN NOT NULL DEFAULT false,
    "suggestedTargetDoctorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "appliedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "doctor_reassignment_proposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "doctor_day_availability_doctorId_date_idx" ON "doctor_day_availability"("doctorId", "date");
CREATE INDEX IF NOT EXISTS "doctor_day_availability_clinicId_date_idx" ON "doctor_day_availability"("clinicId", "date");
CREATE INDEX IF NOT EXISTS "doctor_reassignment_proposal_clinicId_status_idx" ON "doctor_reassignment_proposal"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "doctor_reassignment_proposal_appointmentId_idx" ON "doctor_reassignment_proposal"("appointmentId");
CREATE INDEX IF NOT EXISTS "doctor_reassignment_proposal_doctorId_date_idx" ON "doctor_reassignment_proposal"("doctorId", "date");
CREATE INDEX IF NOT EXISTS "Invoice_appointmentId_clinicId_status_idx" ON "Invoice"("appointmentId", "clinicId", "status");
