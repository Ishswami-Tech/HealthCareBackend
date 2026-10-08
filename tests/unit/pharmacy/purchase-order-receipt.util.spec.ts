import { describe, it, expect } from '@jest/globals';
import {
  PurchaseOrderReceiptError,
  allocateReceipt,
  isReceivableStatus,
  statusAfterReceipt,
} from '@services/pharmacy-inventory/services/purchase-order-receipt.util';

const lines = [
  { id: 'l1', productId: 'm1', quantity: 100, receivedQuantity: 40 },
  { id: 'l2', productId: 'm2', quantity: 10, receivedQuantity: 0 },
  { id: 'l3', productId: 'm2', quantity: 5, receivedQuantity: 0 },
];

describe('purchase order receipt rules', () => {
  it('only SENT and PARTIALLY_RECEIVED orders are receivable', () => {
    expect(
      ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].filter(isReceivableStatus)
    ).toEqual(['SENT', 'PARTIALLY_RECEIVED']);
  });

  it('matches by itemId and by medicineId', () => {
    const result = allocateReceipt(lines, [
      { itemId: 'l2', quantityReceived: 4 },
      { medicineId: 'm1', quantityReceived: 60 },
    ]);
    expect(result.map(r => r.line.id)).toEqual(['l2', 'l1']);
  });

  it('refuses over-receiving, including across rows for the same line', () => {
    expect(() => allocateReceipt(lines, [{ itemId: 'l1', quantityReceived: 61 }])).toThrow(
      PurchaseOrderReceiptError
    );
    expect(() =>
      allocateReceipt(lines, [
        { itemId: 'l1', quantityReceived: 30 },
        { itemId: 'l1', quantityReceived: 31 },
      ])
    ).toThrow(/only 30 still outstanding/);
  });

  it('refuses unknown, ambiguous and missing references and bad quantities', () => {
    expect(() => allocateReceipt(lines, [{ itemId: 'zzz', quantityReceived: 1 }])).toThrow(
      /not part/
    );
    expect(() => allocateReceipt(lines, [{ medicineId: 'm2', quantityReceived: 1 }])).toThrow(
      /several lines/
    );
    expect(() => allocateReceipt(lines, [{ medicineId: 'nope', quantityReceived: 1 }])).toThrow(
      /not part/
    );
    expect(() => allocateReceipt(lines, [{ quantityReceived: 1 }])).toThrow(
      /itemId or a medicineId/
    );
    expect(() =>
      allocateReceipt(lines, [{ itemId: 'l2', medicineId: 'm1', quantityReceived: 1 }])
    ).toThrow(/not for medicine/);
    expect(() => allocateReceipt(lines, [{ itemId: 'l2', quantityReceived: 0 }])).toThrow(
      /at least 1/
    );
    expect(() => allocateReceipt(lines, [{ itemId: 'l2', quantityReceived: 1.5 }])).toThrow(
      /whole number/
    );
  });

  it('is RECEIVED only when every line is complete', () => {
    expect(
      statusAfterReceipt([
        { quantity: 5, receivedQuantity: 5 },
        { quantity: 2, receivedQuantity: 2 },
      ])
    ).toBe('RECEIVED');
    expect(
      statusAfterReceipt([
        { quantity: 5, receivedQuantity: 5 },
        { quantity: 2, receivedQuantity: 1 },
      ])
    ).toBe('PARTIALLY_RECEIVED');
  });
});
