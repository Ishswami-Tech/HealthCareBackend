-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'PATIENT', 'RECEPTIONIST', 'PHARMACIST', 'THERAPIST', 'LAB_TECHNICIAN', 'FINANCE_BILLING', 'SUPPORT_STAFF', 'NURSE', 'COUNSELOR');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'PENDING');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'UPI', 'NET_BANKING', 'WALLET', 'INSURANCE');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HealthRecordType" AS ENUM ('LAB_TEST', 'XRAY', 'MRI', 'PRESCRIPTION', 'DIAGNOSIS_REPORT', 'PULSE_DIAGNOSIS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('EMAIL', 'SMS', 'PUSH_NOTIFICATION');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('IN_PERSON', 'VIDEO_CALL', 'HOME_VISIT', 'VIDDHAKARMA', 'AGNIKARMA', 'PANCHAKARMA', 'NADI_PARIKSHA', 'DOSHA_ANALYSIS', 'SHIRODHARA', 'VIRECHANA', 'ABHYANGA', 'SWEDANA', 'BASTI', 'NASYA', 'RAKTAMOKSHANA');

-- CreateEnum
CREATE TYPE "Dosha" AS ENUM ('VATA', 'PITTA', 'KAPHA');

-- CreateEnum
CREATE TYPE "Prakriti" AS ENUM ('VATA', 'PITTA', 'KAPHA', 'VATA_PITTA', 'PITTA_KAPHA', 'VATA_KAPHA', 'TRIDOSHA');

-- CreateEnum
CREATE TYPE "MedicineType" AS ENUM ('CLASSICAL', 'PROPRIETARY', 'HERBAL');

-- CreateEnum
CREATE TYPE "DatabaseStatus" AS ENUM ('CREATING', 'ACTIVE', 'ERROR', 'MIGRATING', 'DISABLED');

-- CreateEnum
CREATE TYPE "TherapyType" AS ENUM ('SHODHANA', 'SHAMANA', 'RASAYANA', 'VAJIKARANA');

-- CreateEnum
CREATE TYPE "TherapyDuration" AS ENUM ('SHORT', 'MEDIUM', 'LONG', 'EXTENDED', 'RESIDENTIAL');

-- CreateEnum
CREATE TYPE "AgniType" AS ENUM ('TIKSHNA', 'MANDA', 'SAMA', 'VISHAMA');

-- CreateEnum
CREATE TYPE "TherapyStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "VideoCallStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoParticipantRole" AS ENUM ('HOST', 'PARTICIPANT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "VideoParticipantStatus" AS ENUM ('INVITED', 'JOINED', 'LEFT', 'DISCONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'PAUSED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'OVERDUE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "userid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'PATIENT',
    "profilePicture" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "zipCode" TEXT,
    "emergencyContact" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLogin" TIMESTAMP(3),
    "lastLoginIP" TEXT,
    "lastLoginDevice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "passwordChangedAt" TIMESTAMP(3),
    "googleId" TEXT,
    "facebookId" TEXT,
    "appleId" TEXT,
    "appName" TEXT,
    "medicalConditions" TEXT,
    "prakriti" "Prakriti",
    "vikriti" TEXT,
    "doshaImbalances" JSONB,
    "agni" "AgniType",
    "dinacharya" TEXT,
    "ritucharya" TEXT,
    "dietaryRestrictionsJson" JSONB,
    "lifestyleFactors" JSONB,
    "seasonalPatterns" JSONB,
    "primaryClinicId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receptionist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receptionist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "db_connection_string" TEXT NOT NULL,
    "databaseName" TEXT,
    "databaseStatus" "DatabaseStatus" NOT NULL DEFAULT 'CREATING',
    "databaseCreatedAt" TIMESTAMP(3),
    "databaseLastSync" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "subdomain" TEXT,
    "logo" TEXT,
    "website" TEXT,
    "description" TEXT,
    "timezone" TEXT DEFAULT 'UTC',
    "currency" TEXT DEFAULT 'INR',
    "language" TEXT DEFAULT 'en',
    "settings" JSONB,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_locations" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "zipCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clinicId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT DEFAULT 'UTC',
    "workingHours" JSONB,
    "settings" JSONB,

    CONSTRAINT "clinic_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClinicAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pharmacist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pharmacist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Therapist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Therapist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTechnician" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabTechnician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBilling" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportStaff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nurse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nurse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counselor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Counselor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "experience" INTEGER NOT NULL,
    "qualification" TEXT,
    "consultationFee" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION DEFAULT 0.0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "workingHours" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prakriti" "Prakriti",
    "dosha" "Dosha",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "type" "AppointmentType" NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "priority" TEXT DEFAULT 'NORMAL',
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "updatedBy" TEXT,
    "cancellationReason" TEXT,
    "metadata" JSONB,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "therapyId" TEXT,
    "startedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "subscriptionId" TEXT,
    "isSubscriptionBased" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Therapy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,

    CONSTRAINT "Therapy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "clinicId" TEXT NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medicineId" TEXT,
    "dosage" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "clinicId" TEXT NOT NULL,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingredients" TEXT,
    "properties" TEXT,
    "dosage" TEXT,
    "manufacturer" TEXT,
    "type" "MedicineType" NOT NULL,
    "clinicId" TEXT NOT NULL,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorClinic" (
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "locationId" TEXT,

    CONSTRAINT "DoctorClinic_pkey" PRIMARY KEY ("doctorId","clinicId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod",
    "transactionId" TEXT,
    "clinicId" TEXT NOT NULL,
    "userId" TEXT,
    "invoiceId" TEXT,
    "subscriptionId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "refundAmount" DOUBLE PRECISION DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "metadata" JSONB,
    "appointmentsUsed" INTEGER NOT NULL DEFAULT 0,
    "appointmentsRemaining" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "trialPeriodDays" INTEGER,
    "features" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clinicId" TEXT,
    "metadata" JSONB,
    "appointmentsIncluded" INTEGER,
    "isUnlimitedAppointments" BOOLEAN NOT NULL DEFAULT false,
    "appointmentTypes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "clinicId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION DEFAULT 0,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "description" TEXT,
    "lineItems" JSONB,
    "metadata" JSONB,
    "pdfFilePath" TEXT,
    "pdfUrl" TEXT,
    "sentViaWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "whatsappSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Queue" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "queueNumber" INTEGER NOT NULL,
    "estimatedWaitTime" INTEGER,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "clinicId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "recordType" "HealthRecordType" NOT NULL,
    "report" TEXT,
    "fileUrl" TEXT,
    "clinicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "device" TEXT,
    "userAgent" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "clinicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "metadata" TEXT,
    "clinicId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ReceptionistsAtClinic" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ReceptionistsAtClinic_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "MedicalHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "condition" TEXT NOT NULL,
    "diagnosis" TEXT,
    "treatment" TEXT,
    "doctorId" TEXT,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "testName" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "unit" TEXT,
    "normalRange" TEXT,
    "labName" TEXT,
    "doctorId" TEXT,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiologyReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "imageType" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "doctorId" TEXT,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadiologyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgicalRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "surgeryName" TEXT NOT NULL,
    "surgeon" TEXT NOT NULL,
    "doctorId" TEXT,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurgicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentalHealthNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "therapist" TEXT NOT NULL,
    "sessionNote" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentalHealthNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vital" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "doctorId" TEXT,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NadiPariksha" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "pulseType" TEXT NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "practitioner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NadiPariksha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AyurvedicPrescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "formulation" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "instructions" TEXT,
    "prescribedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AyurvedicPrescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrakritiAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vataLevel" INTEGER NOT NULL,
    "pittaLevel" INTEGER NOT NULL,
    "kaphaLevel" INTEGER NOT NULL,
    "dominantType" TEXT NOT NULL,
    "notes" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrakritiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Immunization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "vaccineName" TEXT NOT NULL,
    "dateAdministered" TIMESTAMP(3) NOT NULL,
    "nextDueDate" TIMESTAMP(3),
    "batchNumber" TEXT,
    "administrator" TEXT,
    "location" TEXT,
    "doctorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Immunization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "allergen" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "diagnosedDate" TIMESTAMP(3) NOT NULL,
    "doctorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "relation" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "diagnosedAge" INTEGER,
    "doctorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifestyleAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "diet" TEXT,
    "exercise" TEXT,
    "smoking" TEXT,
    "alcohol" TEXT,
    "sleep" TEXT,
    "stress" TEXT,
    "occupation" TEXT,
    "doctorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifestyleAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insurance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "groupNumber" TEXT,
    "primaryHolder" TEXT NOT NULL,
    "coverageStartDate" TIMESTAMP(3) NOT NULL,
    "coverageEndDate" TIMESTAMP(3),
    "coverageType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT,

    CONSTRAINT "Insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "prescribedBy" TEXT NOT NULL,
    "purpose" TEXT,
    "sideEffects" TEXT,
    "doctorId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietaryRestriction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restriction" TEXT NOT NULL,
    "reason" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "prescribedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietaryRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT NOT NULL DEFAULT 'healthcare',
    "isSystemPermission" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RbacRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT NOT NULL DEFAULT 'healthcare',
    "clinicId" TEXT,
    "isSystemRole" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RbacRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "clinicId" TEXT,
    "assignedBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB,
    "schedule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "clinicId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCriteria" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCheck" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentType" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "criteria" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentTemplate" (
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

-- CreateTable
CREATE TABLE "RecurringAppointmentSeries" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringAppointmentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
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

-- CreateTable
CREATE TABLE "Resource" (
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

-- CreateTable
CREATE TABLE "ResourceBooking" (
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

-- CreateTable
CREATE TABLE "video_consultations" (
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

    CONSTRAINT "video_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_participants" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "VideoParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "status" "VideoParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "duration" INTEGER,
    "peerId" TEXT,
    "connectionId" TEXT,
    "isAudioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isVideoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isScreenSharing" BOOLEAN NOT NULL DEFAULT false,
    "audioQuality" DOUBLE PRECISION,
    "videoQuality" DOUBLE PRECISION,
    "connectionQuality" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_recordings" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" BIGINT,
    "duration" INTEGER,
    "format" TEXT NOT NULL DEFAULT 'mp4',
    "quality" TEXT NOT NULL DEFAULT '720p',
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storageUrl" TEXT,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AyurvedicTherapy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "therapyType" "TherapyType" NOT NULL,
    "duration" "TherapyDuration" NOT NULL,
    "estimatedDuration" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clinicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AyurvedicTherapy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapySession" (
    "id" TEXT NOT NULL,
    "therapyId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" "TherapyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "observations" JSONB,
    "nextSessionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyQueue" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "therapyType" "TherapyType" NOT NULL,
    "queueName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxCapacity" INTEGER NOT NULL DEFAULT 10,
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "estimatedWaitTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "estimatedWaitTime" INTEGER,
    "actualWaitTime" INTEGER,
    "checkedInAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInLocation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "coordinates" JSONB NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coordinates" JSONB,
    "deviceInfo" JSONB,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserClinics" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserClinics_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_userid_key" ON "users"("userid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_primaryClinicId_idx" ON "users"("primaryClinicId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_userId_key" ON "Receptionist"("userId");

-- CreateIndex
CREATE INDEX "Receptionist_clinicId_idx" ON "Receptionist"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_clinicId_key" ON "clinics"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_email_key" ON "clinics"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_app_name_key" ON "clinics"("app_name");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_subdomain_key" ON "clinics"("subdomain");

-- CreateIndex
CREATE INDEX "clinics_app_name_idx" ON "clinics"("app_name");

-- CreateIndex
CREATE INDEX "clinics_isActive_idx" ON "clinics"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_locations_locationId_key" ON "clinic_locations"("locationId");

-- CreateIndex
CREATE INDEX "clinic_locations_clinicId_idx" ON "clinic_locations"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_userId_key" ON "SuperAdmin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicAdmin_userId_key" ON "ClinicAdmin"("userId");

-- CreateIndex
CREATE INDEX "ClinicAdmin_clinicId_idx" ON "ClinicAdmin"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacist_userId_key" ON "Pharmacist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Therapist_userId_key" ON "Therapist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LabTechnician_userId_key" ON "LabTechnician"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBilling_userId_key" ON "FinanceBilling"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportStaff_userId_key" ON "SupportStaff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Nurse_userId_key" ON "Nurse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Counselor_userId_key" ON "Counselor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_userId_key" ON "Patient"("userId");

-- CreateIndex
CREATE INDEX "Appointment_doctorId_idx" ON "Appointment"("doctorId");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_locationId_idx" ON "Appointment"("locationId");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_idx" ON "Appointment"("clinicId");

-- CreateIndex
CREATE INDEX "Appointment_subscriptionId_idx" ON "Appointment"("subscriptionId");

-- CreateIndex
CREATE INDEX "Therapy_clinicId_idx" ON "Therapy"("clinicId");

-- CreateIndex
CREATE INDEX "Prescription_clinicId_idx" ON "Prescription"("clinicId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_clinicId_idx" ON "PrescriptionItem"("clinicId");

-- CreateIndex
CREATE INDEX "Medicine_clinicId_idx" ON "Medicine"("clinicId");

-- CreateIndex
CREATE INDEX "DoctorClinic_clinicId_idx" ON "DoctorClinic"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_appointmentId_key" ON "Payment"("appointmentId");

-- CreateIndex
CREATE INDEX "Payment_clinicId_idx" ON "Payment"("clinicId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE INDEX "Subscription_clinicId_idx" ON "Subscription"("clinicId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "BillingPlan_clinicId_idx" ON "BillingPlan"("clinicId");

-- CreateIndex
CREATE INDEX "BillingPlan_isActive_idx" ON "BillingPlan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

-- CreateIndex
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

-- CreateIndex
CREATE INDEX "Invoice_clinicId_idx" ON "Invoice"("clinicId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Queue_appointmentId_key" ON "Queue"("appointmentId");

-- CreateIndex
CREATE INDEX "Queue_clinicId_idx" ON "Queue"("clinicId");

-- CreateIndex
CREATE INDEX "Notification_clinicId_idx" ON "Notification"("clinicId");

-- CreateIndex
CREATE INDEX "HealthRecord_clinicId_idx" ON "HealthRecord"("clinicId");

-- CreateIndex
CREATE INDEX "AuditLog_clinicId_idx" ON "AuditLog"("clinicId");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_idx" ON "AuditLog"("resourceType");

-- CreateIndex
CREATE INDEX "AuditLog_resourceId_idx" ON "AuditLog"("resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "Review_clinicId_idx" ON "Review"("clinicId");

-- CreateIndex
CREATE INDEX "Product_clinicId_idx" ON "Product"("clinicId");

-- CreateIndex
CREATE INDEX "logs_clinicId_idx" ON "logs"("clinicId");

-- CreateIndex
CREATE INDEX "logs_timestamp_idx" ON "logs"("timestamp");

-- CreateIndex
CREATE INDEX "logs_type_idx" ON "logs"("type");

-- CreateIndex
CREATE INDEX "logs_level_idx" ON "logs"("level");

-- CreateIndex
CREATE INDEX "logs_timestamp_type_level_idx" ON "logs"("timestamp", "type", "level");

-- CreateIndex
CREATE INDEX "_ReceptionistsAtClinic_B_index" ON "_ReceptionistsAtClinic"("B");

-- CreateIndex
CREATE INDEX "MedicalHistory_userId_idx" ON "MedicalHistory"("userId");

-- CreateIndex
CREATE INDEX "MedicalHistory_clinicId_idx" ON "MedicalHistory"("clinicId");

-- CreateIndex
CREATE INDEX "MedicalHistory_doctorId_idx" ON "MedicalHistory"("doctorId");

-- CreateIndex
CREATE INDEX "LabReport_userId_idx" ON "LabReport"("userId");

-- CreateIndex
CREATE INDEX "LabReport_clinicId_idx" ON "LabReport"("clinicId");

-- CreateIndex
CREATE INDEX "LabReport_doctorId_idx" ON "LabReport"("doctorId");

-- CreateIndex
CREATE INDEX "RadiologyReport_userId_idx" ON "RadiologyReport"("userId");

-- CreateIndex
CREATE INDEX "RadiologyReport_clinicId_idx" ON "RadiologyReport"("clinicId");

-- CreateIndex
CREATE INDEX "RadiologyReport_doctorId_idx" ON "RadiologyReport"("doctorId");

-- CreateIndex
CREATE INDEX "SurgicalRecord_userId_idx" ON "SurgicalRecord"("userId");

-- CreateIndex
CREATE INDEX "SurgicalRecord_clinicId_idx" ON "SurgicalRecord"("clinicId");

-- CreateIndex
CREATE INDEX "SurgicalRecord_doctorId_idx" ON "SurgicalRecord"("doctorId");

-- CreateIndex
CREATE INDEX "MentalHealthNote_userId_idx" ON "MentalHealthNote"("userId");

-- CreateIndex
CREATE INDEX "MentalHealthNote_clinicId_idx" ON "MentalHealthNote"("clinicId");

-- CreateIndex
CREATE INDEX "Vital_userId_idx" ON "Vital"("userId");

-- CreateIndex
CREATE INDEX "Vital_clinicId_idx" ON "Vital"("clinicId");

-- CreateIndex
CREATE INDEX "Vital_doctorId_idx" ON "Vital"("doctorId");

-- CreateIndex
CREATE INDEX "NadiPariksha_userId_idx" ON "NadiPariksha"("userId");

-- CreateIndex
CREATE INDEX "AyurvedicPrescription_userId_idx" ON "AyurvedicPrescription"("userId");

-- CreateIndex
CREATE INDEX "PrakritiAnalysis_userId_idx" ON "PrakritiAnalysis"("userId");

-- CreateIndex
CREATE INDEX "Immunization_userId_idx" ON "Immunization"("userId");

-- CreateIndex
CREATE INDEX "Immunization_clinicId_idx" ON "Immunization"("clinicId");

-- CreateIndex
CREATE INDEX "Immunization_doctorId_idx" ON "Immunization"("doctorId");

-- CreateIndex
CREATE INDEX "Allergy_userId_idx" ON "Allergy"("userId");

-- CreateIndex
CREATE INDEX "Allergy_clinicId_idx" ON "Allergy"("clinicId");

-- CreateIndex
CREATE INDEX "Allergy_doctorId_idx" ON "Allergy"("doctorId");

-- CreateIndex
CREATE INDEX "FamilyHistory_userId_idx" ON "FamilyHistory"("userId");

-- CreateIndex
CREATE INDEX "FamilyHistory_clinicId_idx" ON "FamilyHistory"("clinicId");

-- CreateIndex
CREATE INDEX "FamilyHistory_doctorId_idx" ON "FamilyHistory"("doctorId");

-- CreateIndex
CREATE INDEX "LifestyleAssessment_userId_idx" ON "LifestyleAssessment"("userId");

-- CreateIndex
CREATE INDEX "LifestyleAssessment_clinicId_idx" ON "LifestyleAssessment"("clinicId");

-- CreateIndex
CREATE INDEX "LifestyleAssessment_doctorId_idx" ON "LifestyleAssessment"("doctorId");

-- CreateIndex
CREATE INDEX "EmergencyContact_userId_idx" ON "EmergencyContact"("userId");

-- CreateIndex
CREATE INDEX "Insurance_userId_idx" ON "Insurance"("userId");

-- CreateIndex
CREATE INDEX "Medication_userId_idx" ON "Medication"("userId");

-- CreateIndex
CREATE INDEX "Medication_clinicId_idx" ON "Medication"("clinicId");

-- CreateIndex
CREATE INDEX "Medication_doctorId_idx" ON "Medication"("doctorId");

-- CreateIndex
CREATE INDEX "DietaryRestriction_userId_idx" ON "DietaryRestriction"("userId");

-- CreateIndex
CREATE INDEX "Permission_resource_action_idx" ON "Permission"("resource", "action");

-- CreateIndex
CREATE INDEX "Permission_domain_idx" ON "Permission"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_domain_key" ON "Permission"("resource", "action", "domain");

-- CreateIndex
CREATE INDEX "RbacRole_domain_clinicId_idx" ON "RbacRole"("domain", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "RbacRole_name_domain_clinicId_key" ON "RbacRole"("name", "domain", "clinicId");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "UserRole_clinicId_idx" ON "UserRole"("clinicId");

-- CreateIndex
CREATE INDEX "UserRole_isPrimary_idx" ON "UserRole"("isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_clinicId_key" ON "UserRole"("userId", "roleId", "clinicId");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "RolePermission_clinicId_idx" ON "RolePermission"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_clinicId_key" ON "RolePermission"("roleId", "permissionId", "clinicId");

-- CreateIndex
CREATE INDEX "BusinessRule_clinicId_idx" ON "BusinessRule"("clinicId");

-- CreateIndex
CREATE INDEX "BusinessRule_isActive_priority_idx" ON "BusinessRule"("isActive", "priority");

-- CreateIndex
CREATE INDEX "EligibilityCriteria_clinicId_idx" ON "EligibilityCriteria"("clinicId");

-- CreateIndex
CREATE INDEX "EligibilityCriteria_isActive_idx" ON "EligibilityCriteria"("isActive");

-- CreateIndex
CREATE INDEX "EligibilityCheck_patientId_idx" ON "EligibilityCheck"("patientId");

-- CreateIndex
CREATE INDEX "EligibilityCheck_clinicId_idx" ON "EligibilityCheck"("clinicId");

-- CreateIndex
CREATE INDEX "EligibilityCheck_checkedAt_idx" ON "EligibilityCheck"("checkedAt");

-- CreateIndex
CREATE INDEX "AppointmentTemplate_clinicId_idx" ON "AppointmentTemplate"("clinicId");

-- CreateIndex
CREATE INDEX "AppointmentTemplate_doctorId_idx" ON "AppointmentTemplate"("doctorId");

-- CreateIndex
CREATE INDEX "AppointmentTemplate_isActive_idx" ON "AppointmentTemplate"("isActive");

-- CreateIndex
CREATE INDEX "RecurringAppointmentSeries_templateId_idx" ON "RecurringAppointmentSeries"("templateId");

-- CreateIndex
CREATE INDEX "RecurringAppointmentSeries_patientId_idx" ON "RecurringAppointmentSeries"("patientId");

-- CreateIndex
CREATE INDEX "RecurringAppointmentSeries_clinicId_idx" ON "RecurringAppointmentSeries"("clinicId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_patientId_idx" ON "WaitlistEntry"("patientId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_doctorId_idx" ON "WaitlistEntry"("doctorId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_clinicId_idx" ON "WaitlistEntry"("clinicId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_status_priority_idx" ON "WaitlistEntry"("status", "priority");

-- CreateIndex
CREATE INDEX "Resource_clinicId_idx" ON "Resource"("clinicId");

-- CreateIndex
CREATE INDEX "Resource_type_idx" ON "Resource"("type");

-- CreateIndex
CREATE INDEX "Resource_isActive_idx" ON "Resource"("isActive");

-- CreateIndex
CREATE INDEX "ResourceBooking_resourceId_idx" ON "ResourceBooking"("resourceId");

-- CreateIndex
CREATE INDEX "ResourceBooking_appointmentId_idx" ON "ResourceBooking"("appointmentId");

-- CreateIndex
CREATE INDEX "ResourceBooking_startTime_endTime_idx" ON "ResourceBooking"("startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "video_consultations_roomId_key" ON "video_consultations"("roomId");

-- CreateIndex
CREATE INDEX "video_consultations_appointmentId_idx" ON "video_consultations"("appointmentId");

-- CreateIndex
CREATE INDEX "video_consultations_patientId_idx" ON "video_consultations"("patientId");

-- CreateIndex
CREATE INDEX "video_consultations_doctorId_idx" ON "video_consultations"("doctorId");

-- CreateIndex
CREATE INDEX "video_consultations_clinicId_idx" ON "video_consultations"("clinicId");

-- CreateIndex
CREATE INDEX "video_consultations_status_idx" ON "video_consultations"("status");

-- CreateIndex
CREATE INDEX "video_participants_consultationId_idx" ON "video_participants"("consultationId");

-- CreateIndex
CREATE INDEX "video_participants_userId_idx" ON "video_participants"("userId");

-- CreateIndex
CREATE INDEX "video_participants_status_idx" ON "video_participants"("status");

-- CreateIndex
CREATE INDEX "video_recordings_consultationId_idx" ON "video_recordings"("consultationId");

-- CreateIndex
CREATE INDEX "video_recordings_isProcessed_idx" ON "video_recordings"("isProcessed");

-- CreateIndex
CREATE INDEX "AyurvedicTherapy_clinicId_idx" ON "AyurvedicTherapy"("clinicId");

-- CreateIndex
CREATE INDEX "AyurvedicTherapy_therapyType_idx" ON "AyurvedicTherapy"("therapyType");

-- CreateIndex
CREATE INDEX "TherapySession_therapyId_idx" ON "TherapySession"("therapyId");

-- CreateIndex
CREATE INDEX "TherapySession_appointmentId_idx" ON "TherapySession"("appointmentId");

-- CreateIndex
CREATE INDEX "TherapySession_patientId_idx" ON "TherapySession"("patientId");

-- CreateIndex
CREATE INDEX "TherapySession_doctorId_idx" ON "TherapySession"("doctorId");

-- CreateIndex
CREATE INDEX "TherapySession_clinicId_idx" ON "TherapySession"("clinicId");

-- CreateIndex
CREATE INDEX "TherapySession_sessionDate_idx" ON "TherapySession"("sessionDate");

-- CreateIndex
CREATE INDEX "TherapyQueue_clinicId_idx" ON "TherapyQueue"("clinicId");

-- CreateIndex
CREATE INDEX "TherapyQueue_therapyType_idx" ON "TherapyQueue"("therapyType");

-- CreateIndex
CREATE INDEX "TherapyQueue_isActive_idx" ON "TherapyQueue"("isActive");

-- CreateIndex
CREATE INDEX "QueueEntry_queueId_idx" ON "QueueEntry"("queueId");

-- CreateIndex
CREATE INDEX "QueueEntry_appointmentId_idx" ON "QueueEntry"("appointmentId");

-- CreateIndex
CREATE INDEX "QueueEntry_patientId_idx" ON "QueueEntry"("patientId");

-- CreateIndex
CREATE INDEX "QueueEntry_status_idx" ON "QueueEntry"("status");

-- CreateIndex
CREATE INDEX "QueueEntry_position_idx" ON "QueueEntry"("position");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInLocation_qrCode_key" ON "CheckInLocation"("qrCode");

-- CreateIndex
CREATE INDEX "CheckInLocation_clinicId_idx" ON "CheckInLocation"("clinicId");

-- CreateIndex
CREATE INDEX "CheckInLocation_qrCode_idx" ON "CheckInLocation"("qrCode");

-- CreateIndex
CREATE INDEX "CheckIn_appointmentId_idx" ON "CheckIn"("appointmentId");

-- CreateIndex
CREATE INDEX "CheckIn_locationId_idx" ON "CheckIn"("locationId");

-- CreateIndex
CREATE INDEX "CheckIn_patientId_idx" ON "CheckIn"("patientId");

-- CreateIndex
CREATE INDEX "CheckIn_checkedInAt_idx" ON "CheckIn"("checkedInAt");

-- CreateIndex
CREATE INDEX "_UserClinics_B_index" ON "_UserClinics"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_primaryClinicId_fkey" FOREIGN KEY ("primaryClinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receptionist" ADD CONSTRAINT "Receptionist_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receptionist" ADD CONSTRAINT "Receptionist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_locations" ADD CONSTRAINT "clinic_locations_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperAdmin" ADD CONSTRAINT "SuperAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicAdmin" ADD CONSTRAINT "ClinicAdmin_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicAdmin" ADD CONSTRAINT "ClinicAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacist" ADD CONSTRAINT "Pharmacist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Therapist" ADD CONSTRAINT "Therapist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTechnician" ADD CONSTRAINT "LabTechnician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBilling" ADD CONSTRAINT "FinanceBilling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportStaff" ADD CONSTRAINT "SupportStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nurse" ADD CONSTRAINT "Nurse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counselor" ADD CONSTRAINT "Counselor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapyId_fkey" FOREIGN KEY ("therapyId") REFERENCES "Therapy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorClinic" ADD CONSTRAINT "DoctorClinic_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorClinic" ADD CONSTRAINT "DoctorClinic_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorClinic" ADD CONSTRAINT "DoctorClinic_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Queue" ADD CONSTRAINT "Queue_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReceptionistsAtClinic" ADD CONSTRAINT "_ReceptionistsAtClinic_A_fkey" FOREIGN KEY ("A") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReceptionistsAtClinic" ADD CONSTRAINT "_ReceptionistsAtClinic_B_fkey" FOREIGN KEY ("B") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalHistory" ADD CONSTRAINT "MedicalHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReport" ADD CONSTRAINT "LabReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyReport" ADD CONSTRAINT "RadiologyReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgicalRecord" ADD CONSTRAINT "SurgicalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentalHealthNote" ADD CONSTRAINT "MentalHealthNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vital" ADD CONSTRAINT "Vital_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NadiPariksha" ADD CONSTRAINT "NadiPariksha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AyurvedicPrescription" ADD CONSTRAINT "AyurvedicPrescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrakritiAnalysis" ADD CONSTRAINT "PrakritiAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Immunization" ADD CONSTRAINT "Immunization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyHistory" ADD CONSTRAINT "FamilyHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifestyleAssessment" ADD CONSTRAINT "LifestyleAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietaryRestriction" ADD CONSTRAINT "DietaryRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RbacRole" ADD CONSTRAINT "RbacRole_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRule" ADD CONSTRAINT "BusinessRule_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCriteria" ADD CONSTRAINT "EligibilityCriteria_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTemplate" ADD CONSTRAINT "AppointmentTemplate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTemplate" ADD CONSTRAINT "AppointmentTemplate_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringAppointmentSeries" ADD CONSTRAINT "RecurringAppointmentSeries_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AppointmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringAppointmentSeries" ADD CONSTRAINT "RecurringAppointmentSeries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringAppointmentSeries" ADD CONSTRAINT "RecurringAppointmentSeries_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_videoConsultationId_fkey" FOREIGN KEY ("videoConsultationId") REFERENCES "video_consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_consultations" ADD CONSTRAINT "video_consultations_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_consultations" ADD CONSTRAINT "video_consultations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_consultations" ADD CONSTRAINT "video_consultations_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_consultations" ADD CONSTRAINT "video_consultations_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_participants" ADD CONSTRAINT "video_participants_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_participants" ADD CONSTRAINT "video_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_recordings" ADD CONSTRAINT "video_recordings_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AyurvedicTherapy" ADD CONSTRAINT "AyurvedicTherapy_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_therapyId_fkey" FOREIGN KEY ("therapyId") REFERENCES "AyurvedicTherapy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyQueue" ADD CONSTRAINT "TherapyQueue_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "TherapyQueue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInLocation" ADD CONSTRAINT "CheckInLocation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CheckInLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserClinics" ADD CONSTRAINT "_UserClinics_A_fkey" FOREIGN KEY ("A") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserClinics" ADD CONSTRAINT "_UserClinics_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
