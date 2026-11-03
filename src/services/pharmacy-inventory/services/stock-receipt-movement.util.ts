/**
 * Stock receipt movement builder
 * @module Pharmacy Inventory
 * @description Pure builder for the stock-movement row written when a pharmacist receives a new
 * stock batch directly ("Receive stock"), so the ledger matches the raised on-hand quantity the
 * same way dispense (DISPENSE_OUT) and purchase-order receipt (PURCHASE_IN) rows do.
 */

import { MovementType } from '@core/types/enums.types';

/** referenceType used for movements created by a direct batch receipt. */
export const STOCK_BATCH_RECEIPT_REFERENCE_TYPE = 'STOCK_BATCH';

/** Input for {@link buildBatchReceiptMovement}. */
export interface BatchReceiptMovementInput {
  readonly batchId: string;
  readonly productId: string;
  readonly clinicId: string;
  readonly lotNumber: string;
  readonly quantity: number;
  readonly recordedById: string;
}

/** Data for `stockMovement.create` (positive quantity: stock enters the batch). */
export interface BatchReceiptMovementData {
  readonly productId: string;
  readonly batchId: string;
  readonly clinicId: string;
  readonly movementType: MovementType.PURCHASE_IN;
  readonly quantity: number;
  readonly reason: string;
  readonly referenceId: string;
  readonly referenceType: typeof STOCK_BATCH_RECEIPT_REFERENCE_TYPE;
  readonly recordedById: string;
}

/**
 * Builds the PURCHASE_IN movement for a received batch. The batch itself is the reference, so the
 * movement can be traced back to the receipt that raised the stock.
 */
export function buildBatchReceiptMovement(
  input: BatchReceiptMovementInput
): BatchReceiptMovementData {
  return {
    productId: input.productId,
    batchId: input.batchId,
    clinicId: input.clinicId,
    movementType: MovementType.PURCHASE_IN,
    quantity: Math.abs(input.quantity),
    reason: `Stock received (lot ${input.lotNumber})`,
    referenceId: input.batchId,
    referenceType: STOCK_BATCH_RECEIPT_REFERENCE_TYPE,
    recordedById: input.recordedById,
  };
}
