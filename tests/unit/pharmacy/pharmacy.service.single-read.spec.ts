/**
 * Unit tests for the medicine-desk queue sync and payment lookup in PharmacyService.
 *
 * A single-prescription read used to pass a ONE-element list into the sync step,
 * which then REMOVED every other queue entry of the clinic and loaded every payment
 * the clinic ever took.
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

const CLINIC = 'clinic-1';
const QUEUE_OWNER = `medicine-desk:${CLINIC}`;
const DOMAIN = 'medicine-desk';

function prescription(id: string, status = 'PENDING') {
  return {
    id,
    clinicId: CLINIC,
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    status,
    date: new Date('2026-03-01T10:00:00Z'),
    items: [
      { id: `${id}-item`, quantity: 2, medicineId: 'med-1', medicine: { name: 'Med', price: 10 } },
    ],
    patient: { user: { id: 'user-1', name: 'Pat', phone: '1', email: 'p@x.io' } },
    doctor: { user: { id: 'doc-user', name: 'Doc', role: 'DOCTOR' } },
    location: null,
  };
}

function createHarness(options: { prescriptions?: Array<ReturnType<typeof prescription>> } = {}) {
  const stored = options.prescriptions ?? [prescription('rx-1')];
  const client = {
    prescription: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          stored.find(rx => rx.id === where.id) ?? null
      ),
      findMany: jest.fn().mockResolvedValue(stored),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    patient: { findUnique: jest.fn().mockResolvedValue({ id: 'patient-1' }) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
  };
  // Existing queue: rx-1 plus entries belonging to OTHER prescriptions of the clinic.
  const appointmentQueueService = {
    getOperationalQueue: jest.fn().mockResolvedValue([
      { entryId: 'rx-other-1', position: 1 },
      { entryId: 'rx-1', position: 2 },
      { entryId: 'rx-other-2', position: 3 },
    ]),
    removeOperationalQueueItem: jest.fn().mockResolvedValue(undefined),
    enqueueOperationalItem: jest.fn().mockResolvedValue(undefined),
  };
  const moduleRef = { get: jest.fn().mockReturnValue(null) };

  const service = new PharmacyService(
    databaseService as never,
    {} as never,
    { emit: jest.fn() } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    appointmentQueueService as never,
    {} as never,
    {} as never,
    moduleRef as never,
    { invalidateCacheByTag: jest.fn(), del: jest.fn() } as never
  );
  return { service, client, databaseService, appointmentQueueService };
}

const PHARMACIST = { userId: 'pharm-1', role: 'PHARMACIST' };

describe('PharmacyService.findPrescriptionById (single read)', () => {
  it('does not remove any other queue entry of the clinic', async () => {
    const h = createHarness();

    const result = (await h.service.findPrescriptionById(
      'rx-1',
      CLINIC,
      PHARMACIST
    )) as unknown as {
      id: string;
      queuePosition: number | null;
    };

    expect(result.id).toBe('rx-1');
    expect(result.queuePosition).toBe(2);
    expect(h.appointmentQueueService.removeOperationalQueueItem).not.toHaveBeenCalled();
  });

  it('still keeps the read prescription queued (additive)', async () => {
    const h = createHarness();

    await h.service.findPrescriptionById('rx-1', CLINIC, PHARMACIST);

    expect(h.appointmentQueueService.enqueueOperationalItem).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: 'rx-1', clinicId: CLINIC, queueOwnerId: QUEUE_OWNER }),
      DOMAIN
    );
  });

  it('removes only the read prescription own entry once it is FILLED or CANCELLED', async () => {
    for (const status of ['FILLED', 'CANCELLED']) {
      const h = createHarness({ prescriptions: [prescription('rx-1', status)] });

      await h.service.findPrescriptionById('rx-1', CLINIC, PHARMACIST);

      expect(h.appointmentQueueService.removeOperationalQueueItem).toHaveBeenCalledTimes(1);
      expect(h.appointmentQueueService.removeOperationalQueueItem).toHaveBeenCalledWith(
        'rx-1',
        QUEUE_OWNER,
        CLINIC,
        DOMAIN
      );
      expect(h.appointmentQueueService.enqueueOperationalItem).not.toHaveBeenCalled();
    }
  });

  it('loads only the payments of that prescription instead of every clinic payment', async () => {
    const h = createHarness();

    await h.service.findPrescriptionById('rx-1', CLINIC, PHARMACIST);

    expect(h.databaseService.findPaymentsSafe).not.toHaveBeenCalled();
    expect(h.client.payment.findMany).toHaveBeenCalledTimes(1);
    const args = h.client.payment.findMany.mock.calls[0]?.[0] as {
      where: { clinicId: string; OR: Array<{ metadata: { path: string[]; equals: string } }> };
    };
    expect(args.where.clinicId).toBe(CLINIC);
    expect(args.where.OR).toEqual([{ metadata: { path: ['prescriptionId'], equals: 'rx-1' } }]);
  });

  it('computes the payment state from the scoped payments', async () => {
    const h = createHarness();
    h.client.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        amount: 20,
        status: 'COMPLETED',
        metadata: { paymentFor: 'PRESCRIPTION_DISPENSE', prescriptionId: 'rx-1' },
      },
    ]);

    const result = (await h.service.findPrescriptionById(
      'rx-1',
      CLINIC,
      PHARMACIST
    )) as unknown as {
      paymentStatus: string;
      paidAmount: number;
      pendingAmount: number;
    };

    expect(result).toMatchObject({ paymentStatus: 'PAID', paidAmount: 20, pendingAmount: 0 });
  });
});

describe('PharmacyService list reads', () => {
  it('a per-patient list never prunes other entries and scopes payments to its prescriptions', async () => {
    const h = createHarness({ prescriptions: [prescription('rx-1'), prescription('rx-3')] });

    await h.service.findPrescriptionsByPatient('user-1', { role: 'PATIENT' });

    expect(h.appointmentQueueService.removeOperationalQueueItem).not.toHaveBeenCalled();
    expect(h.databaseService.findPaymentsSafe).not.toHaveBeenCalled();
    const args = h.client.payment.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<{ metadata: { equals: string } }> };
    };
    expect(args.where.OR.map(clause => clause.metadata.equals)).toEqual(['rx-1', 'rx-3']);
  });

  it('the clinic-wide list (complete set) still prunes stale queue entries', async () => {
    const h = createHarness({ prescriptions: [prescription('rx-1')] });

    await h.service.findAllPrescriptions(CLINIC);

    const removed = h.appointmentQueueService.removeOperationalQueueItem.mock.calls.map(
      call => call[0]
    );
    expect(removed.sort()).toEqual(['rx-other-1', 'rx-other-2']);
    expect(h.databaseService.findPaymentsSafe).toHaveBeenCalledWith({ clinicId: CLINIC });
    expect(h.client.payment.findMany).not.toHaveBeenCalled();
  });
});
