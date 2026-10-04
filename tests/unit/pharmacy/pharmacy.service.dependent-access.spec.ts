/// <reference types="jest" />
/**
 * A PATIENT may read the prescriptions of an ACTIVE dependent (User.id or Patient.id,
 * via the shared patient access scope) in addition to their own. Strangers and
 * inactive / deleted dependents stay out; payment actions stay own-record only.
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

const CLINIC = 'clinic-1';

interface RxOptions {
  id: string;
  ownerUserId: string | null;
  ownerPatientId: string;
}

function prescription({ id, ownerUserId, ownerPatientId }: RxOptions) {
  return {
    id,
    clinicId: CLINIC,
    patientId: ownerPatientId,
    doctorId: 'doctor-1',
    status: 'PENDING',
    date: new Date('2026-03-01T10:00:00Z'),
    items: [
      { id: `${id}-item`, quantity: 1, medicineId: 'med-1', medicine: { name: 'Med', price: 10 } },
    ],
    patient: ownerUserId
      ? { user: { id: ownerUserId, name: 'Pat', phone: '1', email: 'p@x.io' } }
      : null,
    doctor: { user: { id: 'doc-user', name: 'Doc', role: 'DOCTOR' } },
    location: null,
  };
}

const OWN_RX = prescription({
  id: 'rx-own',
  ownerUserId: 'user-self',
  ownerPatientId: 'patient-self',
});
const CHILD_RX = prescription({
  id: 'rx-child',
  ownerUserId: 'user-child',
  ownerPatientId: 'patient-child',
});
/** Patient row without a loaded user: only the Patient.id identifies the owner. */
const CHILD_RX_NO_USER = prescription({
  id: 'rx-child-2',
  ownerUserId: null,
  ownerPatientId: 'patient-child',
});
const STRANGER_RX = prescription({
  id: 'rx-other',
  ownerUserId: 'user-other',
  ownerPatientId: 'patient-other',
});

interface HarnessOptions {
  /** The calling patient has an ACTIVE dependent (user-child / patient-child). */
  withDependent?: boolean;
  /** The caller has no Patient row. */
  noOwnPatient?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const stored = [OWN_RX, CHILD_RX, CHILD_RX_NO_USER, STRANGER_RX];
  const client = {
    prescription: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          stored.find(rx => rx.id === where.id) ?? null
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    // Scope resolution for the calling PATIENT (user-self -> patient-self [+ child])
    patient: {
      findFirst: jest.fn().mockResolvedValue(options.noOwnPatient ? null : { id: 'patient-self' }),
      findMany: jest
        .fn()
        .mockResolvedValue(
          options.withDependent ? [{ id: 'patient-child', userId: 'user-child' }] : []
        ),
    },
    familyMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.withDependent ? [{ userId: 'user-child' }] : []),
    },
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

const PATIENT = { userId: 'user-self', role: 'PATIENT' };

describe('PharmacyService.findPrescriptionById access for PATIENT callers', () => {
  it('own prescription: allowed without any family lookup', async () => {
    const h = createHarness();

    await expect(h.service.findPrescriptionById('rx-own', CLINIC, PATIENT)).resolves.toMatchObject({
      id: 'rx-own',
    });
    expect(h.client.patient.findFirst).not.toHaveBeenCalled();
    expect(h.client.familyMember.findMany).not.toHaveBeenCalled();
  });

  it('ACTIVE dependent prescription (owner User.id): allowed', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.findPrescriptionById('rx-child', CLINIC, PATIENT)
    ).resolves.toMatchObject({
      id: 'rx-child',
    });
  });

  it('ACTIVE dependent prescription identified only by Patient.id: allowed', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.findPrescriptionById('rx-child-2', CLINIC, PATIENT)
    ).resolves.toMatchObject({ id: 'rx-child-2' });
  });

  it('a stranger prescription is 404 (ownership, not clinic) and nothing is enqueued or enriched', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.findPrescriptionById('rx-other', CLINIC, PATIENT)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.appointmentQueueService.enqueueOperationalItem).not.toHaveBeenCalled();
    expect(h.appointmentQueueService.getOperationalQueue).not.toHaveBeenCalled();
  });

  it('an INACTIVE or soft-deleted dependent grants nothing: only active, non-deleted links are queried', async () => {
    // The link query filters inactive / deleted links out, so none comes back.
    const h = createHarness({ withDependent: false });

    await expect(
      h.service.findPrescriptionById('rx-child', CLINIC, PATIENT)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-self', isActive: true, deletedAt: null },
      })
    );
  });

  it('a caller without a Patient row can only read their own prescriptions', async () => {
    const h = createHarness({ noOwnPatient: true });

    await expect(
      h.service.findPrescriptionById('rx-child', CLINIC, PATIENT)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a PATIENT actor without a user id is denied (never matches an ownerless prescription)', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.findPrescriptionById('rx-child-2', CLINIC, { role: 'PATIENT' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('staff are unchanged: no patient-scope lookup, clinic scoping only', async () => {
    const h = createHarness();

    await expect(
      h.service.findPrescriptionById('rx-other', CLINIC, { userId: 'pharm-1', role: 'PHARMACIST' })
    ).resolves.toMatchObject({ id: 'rx-other' });
    expect(h.client.patient.findFirst).not.toHaveBeenCalled();
    expect(h.client.familyMember.findMany).not.toHaveBeenCalled();
  });
});

describe('PharmacyService payment actions stay own-record only', () => {
  it('a guardian cannot read the payment summary of a dependent prescription', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.getPrescriptionPaymentSummary('rx-child', CLINIC, PATIENT)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.databaseService.findPaymentsSafe).not.toHaveBeenCalled();
  });

  it('a guardian cannot start a payment for a dependent prescription', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.createPrescriptionPaymentIntent('rx-child', CLINIC, PATIENT)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.databaseService.findPaymentsSafe).not.toHaveBeenCalled();
  });

  it('a patient can still see the payment summary of their own prescription', async () => {
    const h = createHarness({ withDependent: true });

    await expect(
      h.service.getPrescriptionPaymentSummary('rx-own', CLINIC, PATIENT)
    ).resolves.toMatchObject({ prescriptionId: 'rx-own' });
  });
});
