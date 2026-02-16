DO $$ BEGIN
    CREATE TYPE "TreatmentType" AS ENUM ('GENERAL_CONSULTATION', 'FOLLOW_UP', 'THERAPY', 'SURGERY', 'LAB_TEST', 'IMAGING', 'VACCINATION', 'VIDDHAKARMA', 'AGNIKARMA', 'PANCHAKARMA', 'NADI_PARIKSHA', 'DOSHA_ANALYSIS', 'SHIRODHARA', 'VIRECHANA', 'ABHYANGA', 'SWEDANA', 'BASTI', 'NASYA', 'RAKTAMOKSHANA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "VideoCallStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: Appointment
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "treatmentType" "TreatmentType" DEFAULT 'GENERAL_CONSULTATION';
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "proposedSlots" JSONB;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmedSlotIndex" INTEGER;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "seriesSequence" INTEGER;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "parentAppointmentId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "isFollowUp" BOOLEAN DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "followUpReason" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "originalAppointmentId" TEXT;

-- CreateTable: AppointmentTemplate
CREATE TABLE IF NOT EXISTS "AppointmentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "timeSlots" JSONB NOT NULL,
    "recurringPattern" TEXT NOT NULL,
    "recurringDays" JSONB,
    "recurringInterval" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RecurringAppointmentSeries
CREATE TABLE IF NOT EXISTS "RecurringAppointmentSeries" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringAppointmentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable: FollowUpPlan
CREATE TABLE IF NOT EXISTS "FollowUpPlan" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "followUpType" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "daysAfter" INTEGER,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "medications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restrictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "followUpAppointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WaitlistEntry
CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "videoConsultationId" TEXT,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Resource
CREATE TABLE IF NOT EXISTS "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ResourceBooking
CREATE TABLE IF NOT EXISTS "ResourceBooking" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clinicId" TEXT,

    CONSTRAINT "ResourceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VideoConsultation
CREATE TABLE IF NOT EXISTS "VideoConsultation" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "meetingUrl" TEXT NOT NULL,
    "status" "VideoCallStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "recordingUrl" TEXT,
    "recordingId" TEXT,
    "isRecording" BOOLEAN NOT NULL DEFAULT false,
    "maxParticipants" INTEGER NOT NULL DEFAULT 2,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "screenSharingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "waitingRoomEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoRecord" BOOLEAN NOT NULL DEFAULT false,
    "iceServers" JSONB,
    "turnServers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoConsultation_pkey" PRIMARY KEY ("id")
);

-- Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpPlan_appointmentId_key" ON "FollowUpPlan"("appointmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpPlan_followUpAppointmentId_key" ON "FollowUpPlan"("followUpAppointmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "VideoConsultation_roomId_key" ON "VideoConsultation"("roomId");

-- Indexes
CREATE INDEX IF NOT EXISTS "Appointment_seriesId_idx" ON "Appointment"("seriesId");
CREATE INDEX IF NOT EXISTS "Appointment_parentAppointmentId_idx" ON "Appointment"("parentAppointmentId");
CREATE INDEX IF NOT EXISTS "AppointmentTemplate_clinicId_idx" ON "AppointmentTemplate"("clinicId");
CREATE INDEX IF NOT EXISTS "RecurringAppointmentSeries_patientId_idx" ON "RecurringAppointmentSeries"("patientId");
CREATE INDEX IF NOT EXISTS "FollowUpPlan_patientId_idx" ON "FollowUpPlan"("patientId");
CREATE INDEX IF NOT EXISTS "WaitlistEntry_patientId_idx" ON "WaitlistEntry"("patientId");
CREATE INDEX IF NOT EXISTS "Resource_clinicId_idx" ON "Resource"("clinicId");
CREATE INDEX IF NOT EXISTS "ResourceBooking_resourceId_idx" ON "ResourceBooking"("resourceId");
CREATE INDEX IF NOT EXISTS "VideoConsultation_appointmentId_idx" ON "VideoConsultation"("appointmentId");

-- Foreign Keys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_seriesId_fkey') THEN
        ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "RecurringAppointmentSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_parentAppointmentId_fkey') THEN
        ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_parentAppointmentId_fkey" FOREIGN KEY ("parentAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecurringAppointmentSeries_templateId_fkey') THEN
        ALTER TABLE "RecurringAppointmentSeries" ADD CONSTRAINT "RecurringAppointmentSeries_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AppointmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
