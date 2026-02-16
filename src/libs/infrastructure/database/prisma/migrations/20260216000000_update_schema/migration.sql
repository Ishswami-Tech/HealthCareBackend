-- AlterTable: LabReport
ALTER TABLE "LabReport" ADD COLUMN IF NOT EXISTS "fileUrl" TEXT;
ALTER TABLE "LabReport" ADD COLUMN IF NOT EXISTS "fileKey" TEXT;

-- AlterTable: Prescription
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

-- AlterTable: PrescriptionItem
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: Medicine
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMP(3);
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "minStockThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

-- CreateTable: Medication
CREATE TABLE IF NOT EXISTS "Medication" (
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

-- CreateTable: Insurance
CREATE TABLE IF NOT EXISTS "Insurance" (
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

-- CreateTable: DietaryRestriction
CREATE TABLE IF NOT EXISTS "DietaryRestriction" (
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

-- CreateTable: EmergencyContact
CREATE TABLE IF NOT EXISTS "EmergencyContact" (
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

-- CreateTable: Supplier
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "clinicId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "Prescription_locationId_idx" ON "Prescription"("locationId");
CREATE INDEX IF NOT EXISTS "Medicine_locationId_idx" ON "Medicine"("locationId");
CREATE INDEX IF NOT EXISTS "Medicine_supplierId_idx" ON "Medicine"("supplierId");
CREATE INDEX IF NOT EXISTS "Medication_userId_idx" ON "Medication"("userId");
CREATE INDEX IF NOT EXISTS "Medication_clinicId_idx" ON "Medication"("clinicId");
CREATE INDEX IF NOT EXISTS "Medication_doctorId_idx" ON "Medication"("doctorId");
CREATE INDEX IF NOT EXISTS "Insurance_userId_idx" ON "Insurance"("userId");
CREATE INDEX IF NOT EXISTS "DietaryRestriction_userId_idx" ON "DietaryRestriction"("userId");
CREATE INDEX IF NOT EXISTS "EmergencyContact_userId_idx" ON "EmergencyContact"("userId");
CREATE INDEX IF NOT EXISTS "Supplier_clinicId_idx" ON "Supplier"("clinicId");

-- AddForeignKeys
DO $$ BEGIN
    -- Prescription
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Prescription_locationId_fkey') THEN
        ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    
    -- Medicine
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Medicine_locationId_fkey') THEN
        ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "clinic_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Medicine_supplierId_fkey') THEN
        ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- Medication
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Medication_userId_fkey') THEN
        ALTER TABLE "Medication" ADD CONSTRAINT "Medication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- Insurance
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Insurance_patientId_fkey') THEN
        ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Insurance_userId_fkey') THEN
        ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- DietaryRestriction
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DietaryRestriction_userId_fkey') THEN
        ALTER TABLE "DietaryRestriction" ADD CONSTRAINT "DietaryRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- EmergencyContact
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmergencyContact_userId_fkey') THEN
        ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- Supplier
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_clinicId_fkey') THEN
        ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
