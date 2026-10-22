/// <reference types="jest" />
/**
 * Payment state of a patient's prescription list when the patient is registered with several
 * clinics: every prescription's payments are matched within ITS clinic (not only the clinic of
 * the first row), in one payment query; staff lists stay on the request clinic.
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

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

function rx(id: string, clinicId: string) {
  return {
    id,
    clinicId,
    patientId: 'patient-shared',
    doctorId: 'doctor-1',
    status: 'PENDING',
    date: new Date('2026-03-01T10:00:00Z'),
    items: [
      { id: `${id}-item`, quantity: 1, medicineId: 'med-1', medicine: { name: 'Med', price: 100 } },
    ],
    patient: { user: { id: 'user-shared', name: 'Pat', phone: '1', email: 'p@x.io' } },
    doctor: { user: { id: 'doc-user', name: 'Doc', role: 'DOCTOR' } },
    location: null,
  };
}

function payment(id: string, clinicId: string, prescriptionId: string) {
  return {
    id,
    clinicId,
    amount: 100,
    status: 'COMPLETED',
    createdAt: new Date('2026-03-01T11:00:00Z'),
    metadata: { paymentFor: 'PRESCRIPTION_DISPENSE', prescriptionId },
  };
}

type PaymentRow = ReturnType<typeof payment>;
type PaymentWhere = {
  clinicId?: string;
  OR?: Array<{ clinicId?: string; metadata: { equals: string } }>;
};

/** Honours the clinic + metadata filters the service sends. */
function matchesPayment(row: PaymentRow, where: PaymentWhere): boolean {
  const clause = (c: { clinicId?: string; metadata: { equals: string } }): boolean =>
    (c.clinicId ?? where.clinicId) === row.clinicId &&
    c.metadata.equals === row.metadata.prescriptionId;
  return (where.OR ?? []).some(clause);
}

function createHarness() {
  const prescriptions = [rx('rx-a1', CLINIC_A), rx('rx-b1', CLINIC_B)];
  // rx-b1 was paid at clinic B; a stray clinic-A row naming rx-b1 must not count.
  const payments = [payment('pay-b1', CLINIC_B, 'rx-b1'), payment('pay-x', CLINIC_A, 'rx-b2')];
  const client = {
    prescription: {
      findMany: jest.fn(async ({ where }: { where: { clinicId?: string } }) =>
        prescriptions.filter(row => where.clinicId === undefined || row.clinicId === where.clinicId)
      ),
    },
    payment: {
      findMany: jest.fn(async ({ where }: { where: PaymentWhere }) =>
        payments.filter(row => matchesPayment(row, where))
      ),
    },
    patient: {
      findUnique: jest.fn().mockResolvedValue({ id: 'patient-shared' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'patient-shared' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    familyMember: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
  };
  const findPrescriptionInvoices = jest.fn(async () => new Map());
  const service = new PharmacyService(
    databaseService as never,
    {} as never,
    { emit: jest.fn() } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {
      getOperationalQueue: jest.fn().mockResolvedValue([]),
      removeOperationalQueueItem: jest.fn().mockResolvedValue(undefined),
      enqueueOperationalItem: jest.fn().mockResolvedValue(undefined),
    } as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockReturnValue({ findPrescriptionInvoices }) } as never,
    { invalidateCacheByTag: jest.fn(), del: jest.fn() } as never
  );
  return { service, client, findPrescriptionInvoices };
}

function statusById(rows: unknown): Record<string, string> {
  return Object.fromEntries(
    (rows as Array<{ id: string; paymentStatus: string }>).map(row => [row.id, row.paymentStatus])
  );
}

describe('PharmacyService.findPrescriptionsByPatient: payment state across clinics', () => {
  it('a PATIENT sees the clinic-B payment of the clinic-B prescription (not only clinic A)', async () => {
    const h = createHarness();

    const rows = await h.service.findPrescriptionsByPatient('user-shared', { role: 'PATIENT' });

    expect(statusById(rows)).toEqual({ 'rx-a1': 'PENDING', 'rx-b1': 'PAID' });
    // One payment query, each prescription paired with its own clinic.
    expect(h.client.payment.findMany).toHaveBeenCalledTimes(1);
    // Invoices are looked up per involved clinic, for that clinic's prescriptions only.
    expect(h.findPrescriptionInvoices).toHaveBeenCalledWith(CLINIC_A, ['rx-a1']);
    expect(h.findPrescriptionInvoices).toHaveBeenCalledWith(CLINIC_B, ['rx-b1']);
  });

  it('staff stay on the request clinic', async () => {
    const h = createHarness();

    const rows = await h.service.findPrescriptionsByPatient('user-shared', {
      role: 'PHARMACIST',
      clinicId: CLINIC_A,
    });

    expect(statusById(rows)).toEqual({ 'rx-a1': 'PENDING' });
    expect(h.findPrescriptionInvoices).toHaveBeenCalledTimes(1);
    expect(h.findPrescriptionInvoices).toHaveBeenCalledWith(CLINIC_A, ['rx-a1']);
  });
});
