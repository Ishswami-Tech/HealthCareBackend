-- WB1 pharmacy: medicine edit/soft-delete fields, prescription number + appointment
-- link, and the PurchaseOrder / PurchaseOrderItem tables.
-- Idempotent: every statement is guarded (IF NOT EXISTS / DO blocks), safe to re-run.

-- 1. Medicine: dosage form, unit, batch, notes, soft delete
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "batchNumber" TEXT;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- 2. Prescription: appointment link + per-clinic number
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "prescriptionNumber" TEXT;

-- Deterministic backfill, identical to buildPrescriptionNumber() in pharmacy.service.ts:
-- RX-<IST yyyymmdd>-<first 8 hex chars of the id, upper case>
UPDATE "Prescription"
SET "prescriptionNumber" = 'RX-'
  || to_char("date" AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD')
  || '-' || upper(substr(replace("id", '-', ''), 1, 8))
WHERE "prescriptionNumber" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Prescription_clinicId_prescriptionNumber_key"
  ON "Prescription"("clinicId", "prescriptionNumber");
CREATE INDEX IF NOT EXISTS "Prescription_appointmentId_idx" ON "Prescription"("appointmentId");

-- 3. Purchase orders
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseOrderStatus') THEN
    CREATE TYPE "PurchaseOrderStatus" AS ENUM
      ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "expectedDeliveryDate" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" INTEGER NOT NULL,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "unitPrice" DOUBLE PRECISION,
  "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_clinicId_poNumber_key"
  ON "PurchaseOrder"("clinicId", "poNumber");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_clinicId_status_idx" ON "PurchaseOrder"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderItem_purchaseOrderId_fkey') THEN
    ALTER TABLE "PurchaseOrderItem"
      ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
