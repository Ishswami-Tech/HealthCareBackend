/// <reference types="jest" />
/**
 * Clinic scoping of the per-patient prescription reads.
 *
 * - STAFF of clinic A asking for a patient who also has prescriptions at clinic B must
 *   only get (and enqueue) clinic A rows.
 * - A multi-clinic PATIENT keeps seeing their own prescriptions of every clinic and can
 *   open one of them whichever clinic they are currently using (ownership is the gate).
 *
 * The prescription store is a stateful fake that honours the `where` clause, so these
 * tests fail if the service stops sending the clinic filter.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

interface StoredRx {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  status: string;
  date: Date;
  items: Array<{ id: string; quantity: number; medicineId: string; medicine: { name: string } }>;
  patient: { user: { id: string; name: string; phone: string; email: string } };
  doctor: { user: { id: string; name: string; role: string } };
  location: null;
}

function rx(id: string, clinicId: string, patientId = 'patient-shared'): StoredRx {
  return {
    id,
    clinicId,
    patientId,
    doctorId: 'doctor-1',
    status: 'PENDING',
    date: new Date('2026-03-01T10:00:00Z'),
    items: [{ id: `${id}-item`, quantity: 1, medicineId: 'med-1', medicine: { name: 'Med' } }],
    patient: {
      user: { id: 'user-shared', name: 'Pat', phone: '1', email: 'p@x.io' },
    },
    doctor: { user: { id: 'doc-user', name: 'Doc', role: 'DOCTOR' } },
    location: null,
  };
}

const STORE: StoredRx[] = [rx('rx-a1', CLINIC_A), rx('rx-a2', CLINIC_A), rx('rx-b1', CLINIC_B)];

function createHarness(stored: StoredRx[] = STORE) {
  const client = {
    prescription: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          stored.find(row => row.id === where.id) ?? null
      ),
      findMany: jest.fn(async ({ where }: { where: { patientId: string; clinicId?: string } }) =>
        stored.filter(
          row =>
            row.patientId === where.patientId &&
            (where.clinicId === undefined || row.clinicId === where.clinicId)
        )
      ),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    patient: {
      findUnique: jest.fn().mockResolvedValue({ id: 'patient-shared' }),
      // scope resolution of the calling PATIENT (user-shared -> patient-shared)
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
  const appointmentQueueService = {
    getOperationalQueue: jest.fn().mockResolvedValue([]),
    removeOperationalQueueItem: jest.fn().mockResolvedValue(undefined),
    enqueueOperationalItem: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PharmacyService(
    databaseService as never,
    {} as never,
    { emit: jest.fn() } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    appointmentQueueService as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockReturnValue(null) } as never,
    { invalidateCacheByTag: jest.fn(), del: jest.fn() } as never
  );
  return { service, client, databaseService, appointmentQueueService };
}

function ids(rows: unknown): string[] {
  return (rows as Array<{ id: string }>).map(row => row.id).sort();
}

describe('PharmacyService.findPrescriptionsByPatient: staff are clinic-scoped', () => {
  it.each(['DOCTOR', 'PHARMACIST', 'CLINIC_ADMIN'])(
    '%s of clinic A passing a patient of clinic B only gets clinic A rows',
    async role => {
      const h = createHarness();

      const rows = await h.service.findPrescriptionsByPatient('user-shared', {
        role,
        clinicId: CLINIC_A,
      });

      expect(ids(rows)).toEqual(['rx-a1', 'rx-a2']);
      expect(h.client.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ patientId: 'patient-shared', clinicId: CLINIC_A }),
        })
      );
    }
  );

  it('staff of clinic B only see their own clinic row for the same patient', async () => {
    const h = createHarness();

    const rows = await h.service.findPrescriptionsByPatient('user-shared', {
      role: 'PHARMACIST',
      clinicId: CLINIC_B,
    });

    expect(ids(rows)).toEqual(['rx-b1']);
  });

  it('a clinic that has no prescription for the patient gets an empty list, not another clinic rows', async () => {
    const h = createHarness();

    const rows = await h.service.findPrescriptionsByPatient('user-shared', {
      role: 'DOCTOR',
      clinicId: 'clinic-without-rx',
    });

    expect(rows).toEqual([]);
  });

  it('the medicine-desk sync only enqueues the caller clinic prescriptions', async () => {
    const h = createHarness();

    await h.service.findPrescriptionsByPatient('user-shared', {
      role: 'PHARMACIST',
      clinicId: CLINIC_A,
    });

    const enqueued = h.appointmentQueueService.enqueueOperationalItem.mock.calls.map(
      call => (call[0] as { clinicId: string; entryId: string }).clinicId
    );
    expect(enqueued.length).toBeGreaterThan(0);
    expect(new Set(enqueued)).toEqual(new Set([CLINIC_A]));
    expect(h.appointmentQueueService.getOperationalQueue).not.toHaveBeenCalledWith(
      expect.anything(),
      CLINIC_B,
      expect.anything()
    );
    // payments are loaded for clinic A only
    const paymentWhere = h.client.payment.findMany.mock.calls[0]?.[0] as {
      where: { clinicId: string };
    };
    expect(paymentWhere.where.clinicId).toBe(CLINIC_A);
  });

  it('a staff caller without clinic context is refused before any query runs', async () => {
    const h = createHarness();

    await expect(
      h.service.findPrescriptionsByPatient('user-shared', { role: 'DOCTOR' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.prescription.findMany).not.toHaveBeenCalled();
    expect(h.appointmentQueueService.enqueueOperationalItem).not.toHaveBeenCalled();
  });

  it('a caller without any role is treated as staff (fail closed, no clinic = refused)', async () => {
    const h = createHarness();

    await expect(h.service.findPrescriptionsByPatient('user-shared', {})).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('SUPER_ADMIN without clinic context stays platform-wide', async () => {
    const h = createHarness();

    const rows = await h.service.findPrescriptionsByPatient('user-shared', {
      role: 'SUPER_ADMIN',
    });

    expect(ids(rows)).toEqual(['rx-a1', 'rx-a2', 'rx-b1']);
  });
});

describe('PharmacyService.findPrescriptionsByPatient: PATIENT callers', () => {
  it('see their own prescriptions of every clinic, whichever clinic they are using', async () => {
    const h = createHarness();

    const rows = await h.service.findPrescriptionsByPatient('user-shared', {
      role: 'PATIENT',
      clinicId: CLINIC_A,
    });

    expect(ids(rows)).toEqual(['rx-a1', 'rx-a2', 'rx-b1']);
    const where = (
      h.client.prescription.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    expect(where).not.toHaveProperty('clinicId');
  });
});

describe('PharmacyService.findPrescriptionById: ownership, not request clinic, for PATIENT callers', () => {
  const PATIENT = { userId: 'user-shared', role: 'PATIENT' };

  it('a multi-clinic patient opens their own clinic-B prescription while using clinic A', async () => {
    const h = createHarness();

    await expect(h.service.findPrescriptionById('rx-b1', CLINIC_A, PATIENT)).resolves.toMatchObject(
      { id: 'rx-b1' }
    );
    // payments/queue state come from the prescription clinic (B), not the request clinic (A)
    const paymentWhere = h.client.payment.findMany.mock.calls[0]?.[0] as {
      where: { clinicId: string };
    };
    expect(paymentWhere.where.clinicId).toBe(CLINIC_B);
    expect(h.appointmentQueueService.getOperationalQueue).toHaveBeenCalledWith(
      expect.anything(),
      CLINIC_B,
      expect.anything()
    );
  });

  it('a prescription of someone else is a 404 for a patient, in any clinic', async () => {
    const stranger = rx('rx-stranger', CLINIC_B, 'patient-other');
    const strangerWithOwner: StoredRx = {
      ...stranger,
      patient: { user: { ...stranger.patient.user, id: 'user-other' } },
    };
    const h = createHarness([...STORE, strangerWithOwner]);

    await expect(
      h.service.findPrescriptionById('rx-stranger', CLINIC_B, PATIENT)
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.findPrescriptionById('rx-stranger', CLINIC_A, PATIENT)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('staff keep the clinic gate: a clinic-B prescription is a 400 for clinic-A staff', async () => {
    const h = createHarness();

    await expect(
      h.service.findPrescriptionById('rx-b1', CLINIC_A, { userId: 'doc-1', role: 'DOCTOR' })
    ).rejects.toThrow('Prescription does not belong to this clinic');
  });
});
