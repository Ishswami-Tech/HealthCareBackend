-- Clinic admin / assistant doctor / round-3 operations.
-- NOT applied automatically: review, then run through the normal `yarn prisma:migrate` flow.
-- Everything is additive and idempotent (IF NOT EXISTS); no existing column or row is changed.

-- 1. Assistant-doctor prescription drafts: DRAFT -> approved (PENDING) | RETURNED -> resubmitted (DRAFT).
ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'RETURNED';

ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "draftedByUserId" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "draftedByRole" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "draftSnapshot" JSONB;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "returnedByUserId" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "returnNote" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT;

-- 2. Clinic QR rotation (POST .../qr-code/regenerate bumps the version; older posters stop validating).
ALTER TABLE "CheckInLocation" ADD COLUMN IF NOT EXISTS "qrVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CheckInLocation" ADD COLUMN IF NOT EXISTS "qrRotatedAt" TIMESTAMP(3);

-- 3. Family member allergies (patient app "Add family member").
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "allergies" TEXT;

-- 4. Leave requests
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "locationId" TEXT,
  "userId" TEXT NOT NULL,
  "requesterRole" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'LEAVE',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "startTime" TEXT,
  "endTime" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "coverUserId" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "impactedAppointmentCount" INTEGER NOT NULL DEFAULT 0,
  "patientsNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "leave_requests_clinicId_status_idx" ON "leave_requests"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "leave_requests_clinicId_startDate_endDate_idx" ON "leave_requests"("clinicId", "startDate", "endDate");
CREATE INDEX IF NOT EXISTS "leave_requests_userId_startDate_idx" ON "leave_requests"("userId", "startDate");

-- 5. Clinic holidays / closures / doctor-leave blocks
CREATE TABLE IF NOT EXISTS "clinic_holidays" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "locationId" TEXT,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'HOLIDAY',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "notifyPatients" BOOLEAN NOT NULL DEFAULT true,
  "notifiedCount" INTEGER NOT NULL DEFAULT 0,
  "messageTemplate" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "clinic_holidays_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "clinic_holidays_clinicId_startDate_endDate_idx" ON "clinic_holidays"("clinicId", "startDate", "endDate");
CREATE INDEX IF NOT EXISTS "clinic_holidays_clinicId_locationId_idx" ON "clinic_holidays"("clinicId", "locationId");

-- 6. Check-in attempts (scan log + failed scans)
CREATE TABLE IF NOT EXISTS "check_in_attempts" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "locationId" TEXT,
  "appointmentId" TEXT,
  "patientId" TEXT,
  "patientName" TEXT,
  "actorUserId" TEXT,
  "actorRole" TEXT,
  "method" TEXT NOT NULL DEFAULT 'QR',
  "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
  "failureReason" TEXT,
  "failureDetail" TEXT,
  "tokenLabel" TEXT,
  "resolution" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "check_in_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "check_in_attempts_clinicId_createdAt_idx" ON "check_in_attempts"("clinicId", "createdAt");
CREATE INDEX IF NOT EXISTS "check_in_attempts_clinicId_outcome_createdAt_idx" ON "check_in_attempts"("clinicId", "outcome", "createdAt");
CREATE INDEX IF NOT EXISTS "check_in_attempts_clinicId_locationId_createdAt_idx" ON "check_in_attempts"("clinicId", "locationId", "createdAt");
CREATE INDEX IF NOT EXISTS "check_in_attempts_appointmentId_idx" ON "check_in_attempts"("appointmentId");

-- 7. Staff invites
CREATE TABLE IF NOT EXISTS "staff_invites" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "name" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "locationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "invitedById" TEXT NOT NULL,
  "acceptedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSentAt" TIMESTAMP(3),
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_invites_tokenHash_key" ON "staff_invites"("tokenHash");
CREATE INDEX IF NOT EXISTS "staff_invites_clinicId_status_idx" ON "staff_invites"("clinicId", "status");

-- 8. Direct dispensing (without / outside a prescription)
CREATE TABLE IF NOT EXISTS "direct_dispenses" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "locationId" TEXT,
  "patientId" TEXT,
  "walkInName" TEXT,
  "walkInPhone" TEXT,
  "prescriptionId" TEXT,
  "dispensedByUserId" TEXT NOT NULL,
  "dispensedByRole" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DISPENSED',
  "undoUntil" TIMESTAMP(3) NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reverseReason" TEXT,
  "invoiceId" TEXT,
  "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "settledAt" TIMESTAMP(3),
  "settledMethod" TEXT,
  "settledById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "direct_dispenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "direct_dispenses_clinicId_createdAt_idx" ON "direct_dispenses"("clinicId", "createdAt");
CREATE INDEX IF NOT EXISTS "direct_dispenses_clinicId_patientId_idx" ON "direct_dispenses"("clinicId", "patientId");
CREATE INDEX IF NOT EXISTS "direct_dispenses_dispensedByUserId_createdAt_idx" ON "direct_dispenses"("dispensedByUserId", "createdAt");

CREATE TABLE IF NOT EXISTS "direct_dispense_items" (
  "id" TEXT NOT NULL,
  "directDispenseId" TEXT NOT NULL,
  "medicineId" TEXT NOT NULL,
  "medicineName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lineAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "batchAllocations" JSONB,
  CONSTRAINT "direct_dispense_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "direct_dispense_items_directDispenseId_idx" ON "direct_dispense_items"("directDispenseId");
CREATE INDEX IF NOT EXISTS "direct_dispense_items_medicineId_idx" ON "direct_dispense_items"("medicineId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_dispense_items_directDispenseId_fkey') THEN
    ALTER TABLE "direct_dispense_items"
      ADD CONSTRAINT "direct_dispense_items_directDispenseId_fkey"
      FOREIGN KEY ("directDispenseId") REFERENCES "direct_dispenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 9. Invoice reminders
CREATE TABLE IF NOT EXISTS "invoice_reminders" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "language" TEXT NOT NULL DEFAULT 'en',
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "scheduledFor" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "sentById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_reminders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "invoice_reminders_clinicId_invoiceId_idx" ON "invoice_reminders"("clinicId", "invoiceId");
CREATE INDEX IF NOT EXISTS "invoice_reminders_status_scheduledFor_idx" ON "invoice_reminders"("status", "scheduledFor");

-- 10. Counter hand-over (QR / OTP verified, undo window)
CREATE TABLE IF NOT EXISTS "dispense_handovers" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "prescriptionId" TEXT NOT NULL,
  "patientId" TEXT,
  "method" TEXT,
  "otpHash" TEXT,
  "otpExpiresAt" TIMESTAMP(3),
  "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "verifiedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "signature" TEXT,
  "itemChecklist" JSONB,
  "handedOverById" TEXT,
  "handedOverAt" TIMESTAMP(3),
  "undoUntil" TIMESTAMP(3),
  "undoneAt" TIMESTAMP(3),
  "undoneById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dispense_handovers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dispense_handovers_clinicId_prescriptionId_idx" ON "dispense_handovers"("clinicId", "prescriptionId");
CREATE INDEX IF NOT EXISTS "dispense_handovers_status_idx" ON "dispense_handovers"("status");

-- 11. Operational audit trail
CREATE TABLE IF NOT EXISTS "clinic_audit_events" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorRole" TEXT,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinic_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "clinic_audit_events_clinicId_entityType_entityId_idx" ON "clinic_audit_events"("clinicId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "clinic_audit_events_clinicId_createdAt_idx" ON "clinic_audit_events"("clinicId", "createdAt");

-- 12. Lab bookings
CREATE TABLE IF NOT EXISTS "lab_bookings" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packageCode" TEXT NOT NULL,
  "packageName" TEXT NOT NULL,
  "tests" JSONB,
  "addressLine" TEXT NOT NULL,
  "city" TEXT,
  "zipCode" TEXT,
  "slotDate" DATE NOT NULL,
  "slotWindow" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "notes" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lab_bookings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lab_bookings_clinicId_status_idx" ON "lab_bookings"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "lab_bookings_patientId_createdAt_idx" ON "lab_bookings"("patientId", "createdAt");

-- 13. Patient help chat
CREATE TABLE IF NOT EXISTS "support_threads" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT,
  "userId" TEXT NOT NULL,
  "subject" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_threads_userId_status_idx" ON "support_threads"("userId", "status");

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "senderType" TEXT NOT NULL,
  "senderId" TEXT,
  "body" TEXT NOT NULL,
  "quickReply" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_messages_threadId_createdAt_idx" ON "support_messages"("threadId", "createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_threadId_fkey') THEN
    ALTER TABLE "support_messages"
      ADD CONSTRAINT "support_messages_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 14. Investigation orders
CREATE TABLE IF NOT EXISTS "investigation_orders" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "visitId" TEXT,
  "appointmentId" TEXT,
  "tests" JSONB NOT NULL,
  "urgency" TEXT NOT NULL DEFAULT 'ROUTINE',
  "labDestination" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ORDERED',
  "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "investigation_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "investigation_orders_clinicId_status_idx" ON "investigation_orders"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "investigation_orders_patientId_orderedAt_idx" ON "investigation_orders"("patientId", "orderedAt");

-- 15. Per-account doctor / assistant favourites
CREATE TABLE IF NOT EXISTS "doctor_favourites" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clinicId" TEXT,
  "kind" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "payload" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "doctor_favourites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_favourites_userId_kind_itemKey_key" ON "doctor_favourites"("userId", "kind", "itemKey");
CREATE INDEX IF NOT EXISTS "doctor_favourites_userId_kind_sortOrder_idx" ON "doctor_favourites"("userId", "kind", "sortOrder");

-- 16. Durable in-person tokens (audit P0-1 / P0-2). One series per clinic location per IST
-- visit day, allocated in the check-in transaction:
--   INSERT INTO "location_token_counters" (...) VALUES (..., 1, now())
--   ON CONFLICT ("clinicId", "locationId", "day")
--   DO UPDATE SET "lastValue" = "location_token_counters"."lastValue" + 1 RETURNING "lastValue";
-- The allocated number + label is stored on the appointment, so the live queue (Dragonfly) can be
-- rebuilt from the database and a re-check-in returns the same token.
CREATE TABLE IF NOT EXISTS "location_token_counters" (
  "clinicId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_token_counters_pkey" PRIMARY KEY ("clinicId", "locationId", "day")
);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "tokenNumber" INTEGER;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "tokenLabel" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "tokenDay" DATE;
-- Duplicate guard: NULL tokens never conflict (Postgres NULLs are distinct in a unique index).
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_location_token_day_key"
  ON "Appointment" ("clinicId", "locationId", "tokenDay", "tokenNumber");

-- 17. Hot-list indexes (audit P1 #13, Payment indexes live in 20261021000000). On large prod tables
-- prefer running these by hand with CREATE INDEX CONCURRENTLY outside a transaction first; the
-- IF NOT EXISTS below then skips them.
CREATE INDEX IF NOT EXISTS "Prescription_patientId_date_idx" ON "Prescription" ("patientId", "date");
CREATE INDEX IF NOT EXISTS "Prescription_clinicId_status_date_idx" ON "Prescription" ("clinicId", "status", "date");
CREATE INDEX IF NOT EXISTS "Invoice_clinicId_createdAt_idx" ON "Invoice" ("clinicId", "createdAt");
-- Patient identifier "contains" search (findSearchPatientIds: value ILIKE '%x%'). Needs pg_trgm
-- (created by 20261011000002_patient_directory_search_indexes); skipped when it is not installed.
-- SQL only (not in schema.prisma), same as the other trigram indexes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "patient_identifiers_value_trgm_idx"
      ON "patient_identifiers" USING gin ("value" gin_trgm_ops);
  END IF;
END $$;

-- 18. Help chat: which quick-reply chip was tapped (RESCHEDULE | CHECK_IN_HELP | REPORTS | BILLING |
-- PRESCRIPTION | TALK_TO_STAFF). Nullable; the boolean "quickReply" stays for older clients.
ALTER TABLE "support_messages" ADD COLUMN IF NOT EXISTS "quickReplyType" TEXT;
