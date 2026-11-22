/// <reference types="jest" />
/**
 * The legacy paid-appointment reconcile runs once per hour across the cluster (worker-only
 * scheduled task), not on every start of every copy. With 3 API + 3 worker copies the boot-time
 * run scanned all completed payments six times per deploy, and each run re-announced
 * payment.completed for the same appointments.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class {} }));
jest.mock('@services/billing/invoice-pdf.service', () => ({ InvoicePDFService: class {} }));

import { BillingService } from '@services/billing/billing.service';
import { createBillingService } from './billing-test-harness';

describe('legacy paid-appointment reconcile', () => {
  it('is not started when a BillingService instance starts', () => {
    expect('onModuleInit' in BillingService.prototype).toBe(false);

    const { service } = createBillingService();
    const reconcile = jest.spyOn(service, 'reconcileLegacyPaidAppointments');
    (service as unknown as { onModuleInit?: () => void }).onModuleInit?.();

    expect(reconcile).not.toHaveBeenCalled();
  });
});
