CREATE TABLE "AssistantDoctorCoverageAssignment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "assistantDoctorId" TEXT NOT NULL,
    "primaryDoctorId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantDoctorCoverageAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantDoctorCoverageAssignment_clinicId_assistantDoctorId_pr_key"
ON "AssistantDoctorCoverageAssignment"("clinicId", "assistantDoctorId", "primaryDoctorId");

CREATE INDEX "AssistantDoctorCoverageAssignment_clinicId_idx"
ON "AssistantDoctorCoverageAssignment"("clinicId");

CREATE INDEX "AssistantDoctorCoverageAssignment_assistantDoctorId_idx"
ON "AssistantDoctorCoverageAssignment"("assistantDoctorId");

CREATE INDEX "AssistantDoctorCoverageAssignment_primaryDoctorId_idx"
ON "AssistantDoctorCoverageAssignment"("primaryDoctorId");

CREATE INDEX "AssistantDoctorCoverageAssignment_clinicId_isActive_idx"
ON "AssistantDoctorCoverageAssignment"("clinicId", "isActive");

ALTER TABLE "AssistantDoctorCoverageAssignment"
ADD CONSTRAINT "AssistantDoctorCoverageAssignment_clinicId_fkey"
FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantDoctorCoverageAssignment"
ADD CONSTRAINT "AssistantDoctorCoverageAssignment_assistantDoctorId_fkey"
FOREIGN KEY ("assistantDoctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantDoctorCoverageAssignment"
ADD CONSTRAINT "AssistantDoctorCoverageAssignment_primaryDoctorId_fkey"
FOREIGN KEY ("primaryDoctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
