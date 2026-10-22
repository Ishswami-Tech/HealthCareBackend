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

function createHarness(options: {
  withInvoice: boolean;
  payments?: Array<Record<string, unknown>>;
  status?: string;
  lockFree?: boolean;
  gatewaySuccess?: boolean;
}) {
  const client = {
    prescription: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ...PRESCRIPTION, status: options.status ?? 'PENDING' }),
    },
    payment: { findMany: jest.fn().mockResolvedValue(options.payments ?? []) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
    createPaymentSafe: jest.fn().mockResolvedValue({ id: 'pay-1' }),
  };
  const paymentService = {
    createPaymentIntent: jest.fn().mockResolvedValue({
      success: options.gatewaySuccess ?? true,
      orderId: 'order-1',
      provider: 'cashfree',
      amount: 100,
      currency: 'INR',
      status: 'pending',
      metadata: { paymentSessionId: 'session-1' },
      ...(options.gatewaySuccess === false ? { error: 'Gateway down' } : {}),
    }),
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
    {
      invalidateCacheByTag: jest.fn(),
      del: jest.fn(),
      acquireLock: jest.fn().mockResolvedValue(options.lockFree ?? true),
      releaseLock: jest.fn().mockResolvedValue(true),
    } as never
  );
  return { service, databaseService, paymentService };
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

describe('PharmacyService.createPrescriptionPaymentIntent idempotency (B13) and drafts (B5)', () => {
  it('reuses the live open attempt instead of opening a second gateway order', async () => {
    const h = createHarness({
      withInvoice: true,
      payments: [
        {
          id: 'pay-open',
          status: 'PENDING',
          amount: 100,
          createdAt: new Date(),
          metadata: {
            paymentFor: 'PRESCRIPTION_DISPENSE',
            prescriptionId: 'rx-1',
            checkout: { orderId: 'order-0', provider: 'cashfree', metadata: { s: 'x' } },
          },
        },
      ],
    });

    const result = (await h.service.createPrescriptionPaymentIntent(
      'rx-1',
      CLINIC,
      PATIENT
    )) as unknown as Record<string, unknown>;

    expect(result['paymentId']).toBe('pay-open');
    expect(result['reused']).toBe(true);
    expect(h.paymentService.createPaymentIntent).not.toHaveBeenCalled();
    expect(h.databaseService.createPaymentSafe).not.toHaveBeenCalled();
  });

  it('answers a concurrent second press with 409 and opens nothing', async () => {
    const h = createHarness({ withInvoice: true, lockFree: false });

    await expect(
      h.service.createPrescriptionPaymentIntent('rx-1', CLINIC, PATIENT)
    ).rejects.toMatchObject({ status: 409 });
    expect(h.paymentService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('records no attempt when the gateway did not open the order', async () => {
    const h = createHarness({ withInvoice: true, gatewaySuccess: false });

    await expect(
      h.service.createPrescriptionPaymentIntent('rx-1', CLINIC, PATIENT)
    ).rejects.toMatchObject({ status: 400 });
    expect(h.databaseService.createPaymentSafe).not.toHaveBeenCalled();
  });

  it('hides a draft from the patient (404) and refuses it for staff (409)', async () => {
    for (const status of ['DRAFT', 'RETURNED']) {
      const h = createHarness({ withInvoice: true, status });
      await expect(
        h.service.createPrescriptionPaymentIntent('rx-1', CLINIC, PATIENT)
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        h.service.getPrescriptionPaymentSummary('rx-1', CLINIC, {
          userId: 'rx-desk',
          role: 'RECEPTIONIST',
        })
      ).rejects.toMatchObject({ status: 409 });
    }
  });
});
