/**
 * Hand-over readiness: a prescription may be handed over at the counter only
 * once it is
 *  - approved by the doctor (not DRAFT / RETURNED) and not CANCELLED,
 *  - paid in full (or priced at zero), and
 *  - dispensed: FILLED, or PARTIAL with at least one unit actually dispensed
 *    (a partly out-of-stock prescription hands over what was dispensed).
 *
 * Pure so the rule is unit-tested without the database.
 */

export interface HandoverReadinessItem {
  quantity: number | null | undefined;
  dispensedQuantity: number | null | undefined;
  unitPrice: number | null | undefined;
}

export interface HandoverReadinessInput {
  status: string;
  items: readonly HandoverReadinessItem[];
  /** Sum of COMPLETED payments linked to the prescription. */
  paidAmount: number;
  /** Status of the PHARMACY invoice, when one exists. */
  invoiceStatus?: string | null | undefined;
}

export type HandoverReadiness = { ok: true } | { ok: false; message: string };

const toPaise = (value: number): number => Math.round(value * 100);

export function prescriptionTotalPaise(items: readonly HandoverReadinessItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum + Math.round(Number(item.quantity ?? 0) * toPaise(Number(item.unitPrice ?? 0))),
    0
  );
}

export function checkHandoverReadiness(input: HandoverReadinessInput): HandoverReadiness {
  const status = String(input.status).toUpperCase();
  if (status === 'DRAFT' || status === 'RETURNED') {
    return { ok: false, message: "This prescription is still awaiting the doctor's approval" };
  }
  if (status === 'CANCELLED') {
    return { ok: false, message: 'This prescription was cancelled' };
  }

  const totalPaise = prescriptionTotalPaise(input.items);
  const invoicePaid = String(input.invoiceStatus ?? '').toUpperCase() === 'PAID';
  const paid = totalPaise <= 0 || invoicePaid || toPaise(input.paidAmount) >= totalPaise;
  if (!paid) {
    return { ok: false, message: 'Collect the payment before handing over the medicines' };
  }

  const dispensedUnits = input.items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.dispensedQuantity ?? 0)),
    0
  );
  const dispensed = status === 'FILLED' || (status === 'PARTIAL' && dispensedUnits > 0);
  if (!dispensed) {
    return { ok: false, message: 'Dispense the medicines before handing them over' };
  }
  return { ok: true };
}
