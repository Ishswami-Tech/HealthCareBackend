-- Add family member support and appointment linkage
-- This migration matches the Prisma schema change already deployed in code.

-- Store family members linked to a patient profile.
ALTER TABLE "users"
ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "notes" TEXT,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "family_members_patientId_idx"
ON "family_members"("patientId");

CREATE INDEX "family_members_userId_idx"
ON "family_members"("userId");

CREATE INDEX "family_members_createdByUserId_idx"
ON "family_members"("createdByUserId");

ALTER TABLE "family_members"
ADD CONSTRAINT "family_members_patientId_fkey"
FOREIGN KEY ("patientId")
REFERENCES "Patient"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "family_members"
ADD CONSTRAINT "family_members_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "family_members"
ADD CONSTRAINT "family_members_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Track whether an appointment is linked to a family member.
ALTER TABLE "Appointment"
ADD COLUMN "familyMemberId" TEXT;

CREATE INDEX "Appointment_familyMemberId_idx"
ON "Appointment"("familyMemberId");

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_familyMemberId_fkey"
FOREIGN KEY ("familyMemberId")
REFERENCES "family_members"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
