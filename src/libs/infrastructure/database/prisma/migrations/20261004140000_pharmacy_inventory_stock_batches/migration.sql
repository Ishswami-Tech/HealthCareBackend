-- WB5 pharmacy-inventory: the batch level stock tables the pharmacy-inventory
-- module (FEFO dispense, expiry alerts, reorder rules, inter-clinic transfers)
-- has always queried but that no earlier migration created.
-- Idempotent: every statement is guarded (IF NOT EXISTS / DO blocks), safe to re-run.
-- Medicine.stock stays the total on-hand (batched + legacy un-batched units);
-- StockBatch is the FEFO breakdown of that total.

CREATE TABLE IF NOT EXISTS "StockBatch" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "lotNumber" TEXT NOT NULL,
  "manufactureDate" TIMESTAMP(3) NOT NULL,
  "expiryDate" TIMESTAMP(3) NOT NULL,
  "quantityReceived" INTEGER NOT NULL,
  "quantityOnHand" INTEGER NOT NULL,
  "costPrice" DOUBLE PRECISION,
  "medicineName" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "movementType" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" TEXT,
  "referenceId" TEXT,
  "referenceType" TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockTransfer" (
  "id" TEXT NOT NULL,
  "sourceClinicId" TEXT NOT NULL,
  "destinationClinicId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "dispatchedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "receivedById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockTransferItem" (
  "id" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sourceBatchId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReorderRule" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "reorderPoint" INTEGER NOT NULL,
  "orderQuantity" INTEGER,
  "minLevel" INTEGER,
  "maxLevel" INTEGER,
  "preferredSupplier" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReorderRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockAlert" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "alertType" TEXT NOT NULL,
  "batchId" TEXT,
  "message" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "StockBatch_clinicId_productId_lotNumber_key"
  ON "StockBatch"("clinicId", "productId", "lotNumber");
CREATE INDEX IF NOT EXISTS "StockBatch_clinicId_productId_expiryDate_idx"
  ON "StockBatch"("clinicId", "productId", "expiryDate");
CREATE INDEX IF NOT EXISTS "StockBatch_clinicId_expiryDate_idx"
  ON "StockBatch"("clinicId", "expiryDate");
CREATE INDEX IF NOT EXISTS "StockMovement_clinicId_productId_createdAt_idx"
  ON "StockMovement"("clinicId", "productId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_batchId_idx" ON "StockMovement"("batchId");
CREATE INDEX IF NOT EXISTS "StockMovement_clinicId_referenceType_referenceId_idx"
  ON "StockMovement"("clinicId", "referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "StockTransfer_sourceClinicId_status_idx"
  ON "StockTransfer"("sourceClinicId", "status");
CREATE INDEX IF NOT EXISTS "StockTransfer_destinationClinicId_status_idx"
  ON "StockTransfer"("destinationClinicId", "status");
CREATE INDEX IF NOT EXISTS "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");
CREATE INDEX IF NOT EXISTS "ReorderRule_clinicId_productId_isActive_idx"
  ON "ReorderRule"("clinicId", "productId", "isActive");
CREATE INDEX IF NOT EXISTS "StockAlert_clinicId_resolvedAt_createdAt_idx"
  ON "StockAlert"("clinicId", "resolvedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "StockAlert_clinicId_productId_alertType_idx"
  ON "StockAlert"("clinicId", "productId", "alertType");

-- Foreign keys + the non-negative stock guard
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockBatch_productId_fkey') THEN
    ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockBatch_clinicId_fkey') THEN
    ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockBatch_quantityOnHand_nonneg_chk') THEN
    ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_quantityOnHand_nonneg_chk"
      CHECK ("quantityOnHand" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_batchId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockTransfer_sourceClinicId_fkey') THEN
    ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceClinicId_fkey"
      FOREIGN KEY ("sourceClinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockTransfer_destinationClinicId_fkey') THEN
    ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destinationClinicId_fkey"
      FOREIGN KEY ("destinationClinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockTransferItem_transferId_fkey') THEN
    ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey"
      FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
