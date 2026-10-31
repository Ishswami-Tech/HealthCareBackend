import { describe, expect, it } from '@jest/globals';
import { MovementType } from '../../../src/libs/core/types/enums.types';
import {
  STOCK_BATCH_RECEIPT_REFERENCE_TYPE,
  buildBatchReceiptMovement,
} from '../../../src/services/pharmacy-inventory/services/stock-receipt-movement.util';

describe('buildBatchReceiptMovement', () => {
  const input = {
    batchId: 'batch-1',
    productId: 'med-1',
    clinicId: 'clinic-1',
    lotNumber: 'LOT-42',
    quantity: 12,
    recordedById: 'pharmacist-1',
  };

  it('writes a positive PURCHASE_IN movement referencing the received batch', () => {
    expect(buildBatchReceiptMovement(input)).toEqual({
      productId: 'med-1',
      batchId: 'batch-1',
      clinicId: 'clinic-1',
      movementType: MovementType.PURCHASE_IN,
      quantity: 12,
      reason: 'Stock received (lot LOT-42)',
      referenceId: 'batch-1',
      referenceType: STOCK_BATCH_RECEIPT_REFERENCE_TYPE,
      recordedById: 'pharmacist-1',
    });
  });

  it('keeps the quantity positive (stock enters the batch)', () => {
    expect(buildBatchReceiptMovement({ ...input, quantity: -3 }).quantity).toBe(3);
  });
});
