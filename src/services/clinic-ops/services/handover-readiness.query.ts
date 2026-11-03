/**
 * Loads what the hand-over readiness rule needs (prescription status + items, COMPLETED payments
 * linked to it, its PHARMACY invoice) and applies checkHandoverReadiness. Null when the
 * prescription does not exist in the clinic.
 */

import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import {
  checkHandoverReadiness,
  type HandoverReadiness,
} from '@services/clinic-ops/services/handover-readiness.util';
import { sharedDelegates } from '../clinic-ops.types';
import type { OpsDbService } from './ops-db.service';

export async function loadHandoverReadiness(
  ops: OpsDbService,
  prescriptionId: string,
  clinicId: string
): Promise<HandoverReadiness | null> {
  const state = await ops.read(async client => {
    const shared = sharedDelegates(client);
    const prescription = (await shared.prescription.findFirst({
      where: { id: prescriptionId, clinicId } as PrismaDelegateArgs,
      select: {
        status: true,
        items: {
          select: {
            quantity: true,
            dispensedQuantity: true,
            medicine: { select: { price: true } },
          },
        },
      } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as unknown as {
      status: string;
      items?: Array<{
        quantity: number | null;
        dispensedQuantity: number | null;
        medicine?: { price: number | null } | null;
      }>;
    } | null;
    if (!prescription) return null;
    const [payments, invoice] = await Promise.all([
      shared.payment.findMany({
        where: {
          clinicId,
          status: 'COMPLETED',
          metadata: { path: ['prescriptionId'], equals: prescriptionId },
        } as PrismaDelegateArgs,
        select: { amount: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs) as unknown as Promise<Array<{ amount: number | null }>>,
      client.invoice.findFirst({
        where: { clinicId, billType: 'PHARMACY', prescriptionId },
        select: { status: true },
      }),
    ]);
    return { prescription, payments, invoice };
  });
  if (!state) return null;
  return checkHandoverReadiness({
    status: state.prescription.status,
    items: (state.prescription.items ?? []).map(item => ({
      quantity: item.quantity,
      dispensedQuantity: item.dispensedQuantity,
      unitPrice: item.medicine?.price ?? 0,
    })),
    paidAmount: state.payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
    invoiceStatus: state.invoice?.status ?? null,
  });
}
