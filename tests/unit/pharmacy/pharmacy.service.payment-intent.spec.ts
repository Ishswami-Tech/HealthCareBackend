/// <reference types="jest" />
/**
 * POST /pharmacy/prescriptions/:id/process-payment: the response carries the clinic
 * (top level and on the invoice) so the mobile payment callback screen has its context.
 */

import { PharmacyService } from '@services/pharmacy/services/pharmacy.service';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/queue', () => ({
  AppointmentQueueService: class AppointmentQueueService {},
}));
jest.mock('@payment/payment.service', () => ({ PaymentService: class PaymentService {} }));
jest.mock('@services/pharmacy-inventory/services/inventory.service', () => ({
  InventoryService: class InventoryService {},
}));
jest.mock('@services/pharmacy-inventory/services/expiry-alert.service', () => ({
  ExpiryAlertService: class ExpiryAlertService {},
}));

const CLINIC = 'clinic-b';

const PRESCRIPTION = {
  id: 'rx-1',
  clinicId: CLINIC,
  patientId: 'patient-1',
  doctorId: 'doctor-1',
  status: 'PENDING',
  date: new Date('2026-03-01T10:00:00Z'),
  items: [{ id: 'i-1', quantity: 2, medicineId: 'med-1', medicine: { name: 'Med', price: 50 } }],
  patient: { user: { id: 'user-1', name: 'Pat', phone: '1', email: 'p@x.io' } },
  doctor: { user: { id: 'doc-user', name: 'Doc', role: 'DOCTOR' } },
  location: null,
};

function createHarness(options: { withInvoice: boolean }) {
  const client = {
    prescription: { findUnique: jest.fn().mockResolvedValue(PRESCRIPTION) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
    createPaymentSafe: jest.fn().mockResolvedValue({ id: 'pay-1' }),
  };
  const paymentService = {
    createPaymentIntent: jest.fn().mockResolvedValue({ orderId: 'order-1', metadata: {} }),
  };
  const billing = {
    ensurePrescriptionInvoice: jest.fn().mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      status: 'PENDING',
    }),
    findPrescriptionInvoices: jest.fn().mockResolvedValue(new Map()),
  };
  const moduleRef = { get: jest.fn().mockReturnValue(options.withInvoice ? billing : null) };
  const service = new PharmacyService(
    databaseService as never,
    paymentService as never,
    { emit: jest.fn() } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    moduleRef as never,
    { invalidateCacheByTag: jest.fn(), del: jest.fn() } as never
  );
  return { service };
}

const PATIENT = { userId: 'user-1', role: 'PATIENT' };

describe('PharmacyService.createPrescriptionPaymentIntent response', () => {
  it('carries the clinic at the top level and on the invoice', async () => {
    const h = createHarness({ withInvoice: true });

    const result = await h.service.createPrescriptionPaymentIntent('rx-1', CLINIC, PATIENT);

    expect(result).toMatchObject({
      prescriptionId: 'rx-1',
      clinicId: CLINIC,
      paymentId: 'pay-1',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1',
      invoice: { id: 'inv-1', invoiceNumber: 'INV-1', clinicId: CLINIC },
    });
  });

  it('still carries the clinic when no invoice could be created', async () => {
    const h = createHarness({ withInvoice: false });

    const result = (await h.service.createPrescriptionPaymentIntent(
      'rx-1',
      CLINIC,
      PATIENT
    )) as unknown as Record<string, unknown>;

    expect(result['clinicId']).toBe(CLINIC);
    expect(result).not.toHaveProperty('invoice');
  });
});
