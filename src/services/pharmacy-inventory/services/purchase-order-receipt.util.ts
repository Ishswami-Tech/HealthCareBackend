/**
 * Pure rules of receiving goods against a purchase order: which PO line each received row
 * belongs to, how much is still receivable, and the PO status after the receipt.
 */

export const RECEIVABLE_PO_STATUSES: readonly string[] = ['SENT', 'PARTIALLY_RECEIVED'];

export interface ReceiptPoLine {
  id: string;
  productId: string;
  quantity: number;
  receivedQuantity: number;
}

export interface ReceiptRequestLine {
  itemId?: string | undefined;
  medicineId?: string | undefined;
  quantityReceived: number;
}

export interface ReceiptAllocation<T extends ReceiptRequestLine> {
  line: ReceiptPoLine;
  request: T;
}

/** Thrown as plain Error messages; the service maps them to 400 responses. */
export class PurchaseOrderReceiptError extends Error {}

export function isReceivableStatus(status: string): boolean {
  return RECEIVABLE_PO_STATUSES.includes(status);
}

/**
 * Matches every requested row to one PO line and checks the quantities. Several rows may hit the
 * same line (e.g. two batches of one line); their sum must still fit the line.
 */
export function allocateReceipt<T extends ReceiptRequestLine>(
  poLines: readonly ReceiptPoLine[],
  requests: readonly T[]
): Array<ReceiptAllocation<T>> {
  const pending = new Map<string, number>(poLines.map(l => [l.id, l.receivedQuantity]));
  const allocations: Array<ReceiptAllocation<T>> = [];

  for (const request of requests) {
    if (!Number.isInteger(request.quantityReceived) || request.quantityReceived < 1) {
      throw new PurchaseOrderReceiptError('quantityReceived must be a whole number of at least 1');
    }
    const line = resolveLine(poLines, request);
    const alreadyReceived = pending.get(line.id) ?? 0;
    const remaining = line.quantity - alreadyReceived;
    if (request.quantityReceived > remaining) {
      throw new PurchaseOrderReceiptError(
        `Cannot receive ${request.quantityReceived} of line ${line.id}: only ${Math.max(remaining, 0)} still outstanding (ordered ${line.quantity}, received ${alreadyReceived}).`
      );
    }
    pending.set(line.id, alreadyReceived + request.quantityReceived);
    allocations.push({ line, request });
  }
  return allocations;
}

function resolveLine(
  poLines: readonly ReceiptPoLine[],
  request: ReceiptRequestLine
): ReceiptPoLine {
  if (request.itemId) {
    const byId = poLines.find(l => l.id === request.itemId);
    if (!byId) {
      throw new PurchaseOrderReceiptError(
        `Line ${request.itemId} is not part of this purchase order.`
      );
    }
    if (request.medicineId && request.medicineId !== byId.productId) {
      throw new PurchaseOrderReceiptError(
        `Line ${request.itemId} is not for medicine ${request.medicineId}.`
      );
    }
    return byId;
  }
  if (!request.medicineId) {
    throw new PurchaseOrderReceiptError('Each received row needs an itemId or a medicineId.');
  }
  const matches = poLines.filter(l => l.productId === request.medicineId);
  if (matches.length === 0) {
    throw new PurchaseOrderReceiptError(
      `Medicine ${request.medicineId} is not part of this purchase order.`
    );
  }
  if (matches.length > 1) {
    throw new PurchaseOrderReceiptError(
      `Medicine ${request.medicineId} appears on several lines of this purchase order; send itemId.`
    );
  }
  return matches[0] as ReceiptPoLine;
}

/** PO status once the lines carry their new received quantities. */
export function statusAfterReceipt(
  lines: ReadonlyArray<{ quantity: number; receivedQuantity: number }>
): 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  return lines.every(l => l.receivedQuantity >= l.quantity) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}

/** True for a database unique-constraint violation (Prisma P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
