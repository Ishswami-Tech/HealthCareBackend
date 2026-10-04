/**
 * Plugin confirmation / check-in / completion act inside the clinic the request was validated
 * for: a clinic A admin cannot confirm, check in or complete clinic B's appointment. Confirming an
 * in-person appointment goes through the one check-in implementation (atomic, queued), and a
 * video appointment is never confirmed by the clinic (payment confirms it).
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/ehr/ehr.service', () => ({ EHRService: class EHRService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@utils/QR', () => ({
  QrService: class QrService {},
  LocationQrService: class LocationQrService {},
}));

import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import {
  AppointmentConfirmationService,
  VIDEO_CONFIRMATION_REJECTION_MESSAGE,
} from '@services/appointments/plugins/confirmation/appointment-confirmation.service';
import { ClinicConfirmationPlugin } from '@services/appointments/plugins/confirmation/clinic-confirmation.plugin';
import { CHECK_IN_NOT_TODAY_CODE } from '@services/appointments/core/check-in-presence.util';
import { createLoggingStub, type Row } from './test-helpers';
import {
  CLINIC,
  OTHER_CLINIC,
  buildCheckInServiceWorld,
  inPersonRow,
  type CheckInServiceWorld,
} from './check-in-service-world';
import { istSlot, istSlotOnOtherDay, pinClock, unpinClock } from './check-in-time-helpers';

const ADMIN_A = { clinicId: CLINIC, caller: { userId: 'admin-a', role: 'CLINIC_ADMIN' } };

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

function build() {
  const world: CheckInServiceWorld = buildCheckInServiceWorld();
  const logging = createLoggingStub();
  const ehr = { createPrescription: jest.fn(async (..._args: unknown[]) => undefined) };
  const config = { getEnv: jest.fn((_key: string, fallback: string) => fallback) };
  const qr = { generateQR: jest.fn(async (..._args: unknown[]) => 'data:image/png;base64,AAAA') };
  const cache = {
    get: jest.fn(async (..._args: unknown[]) => null),
    set: jest.fn(async (..._args: unknown[]) => undefined),
    del: jest.fn(async (..._args: unknown[]) => 1),
    invalidateByPattern: jest.fn(async (..._args: unknown[]) => 0),
  };
  const service = new AppointmentConfirmationService(
    config as never,
    cache as never,
    logging as never,
    world.db as never,
    qr as never,
    ehr as never,
    world.service as never
  );
  const plugin = new ClinicConfirmationPlugin(service, logging as never);
  return { world, service, plugin, ehr, cache };
}

describe('plugin confirmation / completion clinic isolation', () => {
  let h: ReturnType<typeof build>;

  beforeEach(() => {
    pinClock();
    h = build();
    h.world.db.insert('clinicLocation', {
      id: 'loc-b',
      clinicId: OTHER_CLINIC,
      isActive: true,
      deletedAt: null,
    });
    h.world.db.insert('checkInLocation', {
      id: 'cil-b',
      clinicId: OTHER_CLINIC,
      locationId: 'loc-b',
      locationName: 'Clinic B reception',
      isActive: true,
      qrCode: 'CHK-B',
      coordinates: { lat: 19.076, lng: 72.8777 },
      radius: 300,
    });
    // Each clinic's appointments are covered by that clinic's own plan.
    h.world.db.findSubscriptionByIdSafe.mockImplementation(async (id: string) => ({
      id,
      clinicId: id === 'sub-b' ? OTHER_CLINIC : CLINIC,
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    }));
  });

  afterEach(() => {
    unpinClock();
  });

  const seedClinicB = (overrides: Row = {}): Row =>
    h.world.db.insert(
      'appointment',
      inPersonRow({
        id: 'appt-b',
        clinicId: OTHER_CLINIC,
        locationId: 'loc-b',
        subscriptionId: 'sub-b',
        ...overrides,
      })
    );

  function expectUntouched(id: string, status: string): void {
    const row = h.world.db.rows('appointment').find(candidate => candidate['id'] === id);
    expect(row?.['status']).toBe(status);
    expect(h.world.db.rows('checkIn')).toHaveLength(0);
    expect(h.world.queue.checkIn).not.toHaveBeenCalled();
    expect(h.world.db.writes).toHaveLength(0);
  }

  describe('a clinic A admin against clinic B', () => {
    it("cannot confirm clinic B's appointment (404): no status change, no CheckIn row, no queue entry", async () => {
      seedClinicB();

      const error = await rejection(h.service.confirmAppointment('appt-b', 'clinic', ADMIN_A));

      expect(error).toBeInstanceOf(NotFoundException);
      expectUntouched('appt-b', 'SCHEDULED');
    });

    it("cannot complete clinic B's appointment: no write, no prescription in clinic B", async () => {
      seedClinicB({ status: 'IN_PROGRESS' });

      const error = await rejection(
        h.service.markAppointmentCompleted('appt-b', 'doctor-1', 'clinic', {
          clinicId: CLINIC,
          userId: 'user-patient',
          diagnosis: 'x',
        })
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expectUntouched('appt-b', 'IN_PROGRESS');
      expect(h.ehr.createPrescription).not.toHaveBeenCalled();
    });

    it("cannot check in clinic B's appointment through the QR operation", async () => {
      seedClinicB();
      const qr = (await h.service.generateCheckInQR('appt-b', 'clinic', {
        clinicId: OTHER_CLINIC,
      })) as { qrCode: string };

      const error = await rejection(
        h.service.processCheckIn(qr.qrCode, 'appt-b', 'clinic', ADMIN_A)
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(h.world.db.rows('checkIn')).toHaveLength(0);
      expect(h.world.queue.checkIn).not.toHaveBeenCalled();
    });

    it.each([
      ['generateCheckInQR', (id: string) => h.service.generateCheckInQR(id, 'clinic', ADMIN_A)],
      [
        'generateConfirmationQR',
        (id: string) => h.service.generateConfirmationQR(id, 'clinic', ADMIN_A),
      ],
      ['invalidateQRCache', (id: string) => h.service.invalidateQRCache(id, ADMIN_A)],
    ])("%s does not touch clinic B's appointment (404)", async (_label, run) => {
      seedClinicB();

      const error = await rejection(run('appt-b'));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(h.cache.set).not.toHaveBeenCalled();
    });

    it('a cached confirmation of clinic B is never served to clinic A (the result is not cached)', async () => {
      seedClinicB();
      await h.service.confirmAppointment('appt-b', 'clinic', { clinicId: OTHER_CLINIC });
      h.cache.get.mockResolvedValue(
        JSON.stringify({ success: true, clinicId: OTHER_CLINIC }) as never
      );

      const error = await rejection(h.service.confirmAppointment('appt-b', 'clinic', ADMIN_A));

      expect(error).toBeInstanceOf(NotFoundException);
    });
  });

  describe('through the plugin (the shape POST /appointments/plugins/execute hands over)', () => {
    it("confirmAppointment with clinic A's validated clinicId cannot reach clinic B", async () => {
      seedClinicB();

      await expect(
        h.plugin.process({
          operation: 'confirmAppointment',
          appointmentId: 'appt-b',
          clinicId: CLINIC,
          caller: ADMIN_A.caller,
        })
      ).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched('appt-b', 'SCHEDULED');
    });

    it("markAppointmentCompleted with clinic A's validated clinicId cannot reach clinic B", async () => {
      seedClinicB({ status: 'IN_PROGRESS' });

      await expect(
        h.plugin.process({
          operation: 'markAppointmentCompleted',
          appointmentId: 'appt-b',
          doctorId: 'doctor-1',
          clinicId: CLINIC,
          userId: 'user-patient',
          caller: ADMIN_A.caller,
        })
      ).rejects.toBeInstanceOf(NotFoundException);
      expectUntouched('appt-b', 'IN_PROGRESS');
      expect(h.ehr.createPrescription).not.toHaveBeenCalled();
    });

    it('the clinic admin of clinic B can, of course, act on clinic B', async () => {
      seedClinicB();

      const result = (await h.plugin.process({
        operation: 'confirmAppointment',
        appointmentId: 'appt-b',
        clinicId: OTHER_CLINIC,
        caller: { userId: 'admin-b', role: 'CLINIC_ADMIN' },
      })) as { success: boolean; clinicId: string };

      expect(result).toMatchObject({ success: true, clinicId: OTHER_CLINIC });
    });
  });

  describe('confirming an IN-PERSON appointment is the same check-in as a scan', () => {
    it('SCHEDULED -> CONFIRMED with checkedInAt, a CheckIn row AND an entry in the doctor queue', async () => {
      h.world.db.insert('appointment', inPersonRow());

      const result = (await h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A)) as {
        success: boolean;
      };

      const row = h.world.db.rows('appointment')[0];
      expect(result.success).toBe(true);
      expect(row?.['status']).toBe('CONFIRMED');
      expect(row?.['checkedInAt']).toBeInstanceOf(Date);
      expect(h.world.db.rows('checkIn')).toHaveLength(1);
      expect(h.world.queued.has('appt-1')).toBe(true);
      expect(h.world.queue.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: 'appt-1',
          doctorId: 'doctor-1',
          clinicId: CLINIC,
        }),
        'clinic'
      );
    });

    it('the QR check-in operation does the same', async () => {
      h.world.db.insert('appointment', inPersonRow());
      const qr = (await h.service.generateCheckInQR('appt-1', 'clinic', ADMIN_A)) as {
        qrCode: string;
      };

      await h.service.processCheckIn(qr.qrCode, 'appt-1', 'clinic', ADMIN_A);

      expect(h.world.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(h.world.db.rows('checkIn')).toHaveLength(1);
      expect(h.world.queued.has('appt-1')).toBe(true);
    });

    it('is idempotent: confirming twice is one CheckIn row and one queue entry', async () => {
      h.world.db.insert('appointment', inPersonRow());

      await h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A);
      await h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A);

      expect(h.world.db.rows('checkIn')).toHaveLength(1);
      expect(h.world.queued.size).toBe(1);
    });

    it('keeps the staff time rule: a clinic admin may confirm outside the window on the same day', async () => {
      h.world.db.insert('appointment', inPersonRow({ ...istSlot(240) }));

      const result = (await h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A)) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
    });

    it("but never another day (it would be queued into today's queue)", async () => {
      h.world.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(5) }));

      const error = await rejection(h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A));

      expect(error.getResponse()).toMatchObject({ code: CHECK_IN_NOT_TODAY_CODE });
      expectUntouched('appt-1', 'SCHEDULED');
    });

    it('a call that carries no authenticated caller gets the patient window (fail closed)', async () => {
      h.world.db.insert('appointment', inPersonRow({ ...istSlot(240) }));

      const error = await rejection(
        h.service.confirmAppointment('appt-1', 'clinic', { clinicId: CLINIC })
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expectUntouched('appt-1', 'SCHEDULED');
    });

    it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED', 'IN_PROGRESS', 'PENDING'])(
      'a %s appointment is not confirmed: 400, nothing written',
      async status => {
        h.world.db.insert('appointment', inPersonRow({ status }));

        const error = await rejection(h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A));

        expect(error).toBeInstanceOf(BadRequestException);
        expectUntouched('appt-1', status);
      }
    );

    it('an appointment without a clinic location cannot be checked in: 400', async () => {
      h.world.db.insert('appointment', inPersonRow({ locationId: null }));

      const error = await rejection(h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A));

      expect(error).toBeInstanceOf(BadRequestException);
      expectUntouched('appt-1', 'SCHEDULED');
    });

    it('global scope (SUPER_ADMIN without a clinic header) keeps working across clinics', async () => {
      seedClinicB();

      const result = (await h.service.confirmAppointment('appt-b', 'clinic', {
        caller: { userId: 'root', role: 'SUPER_ADMIN' },
      })) as { success: boolean; clinicId: string };

      expect(result).toMatchObject({ success: true, clinicId: OTHER_CLINIC });
    });
  });

  describe('a VIDEO appointment is never confirmed through the plugin (payment confirms it)', () => {
    const video = (overrides: Row = {}): Row =>
      h.world.db.insert(
        'appointment',
        inPersonRow({ type: 'VIDEO_CALL', locationId: null, status: 'PENDING', ...overrides })
      );

    it.each(['confirmAppointment', 'processCheckIn'])(
      '%s is refused with 400 and nothing is written',
      async operation => {
        video();
        const qr = (await h.service.generateCheckInQR('appt-1', 'clinic', ADMIN_A)) as {
          qrCode: string;
        };

        const error = await rejection(
          operation === 'confirmAppointment'
            ? h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A)
            : h.service.processCheckIn(qr.qrCode, 'appt-1', 'clinic', ADMIN_A)
        );

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toBe(VIDEO_CONFIRMATION_REJECTION_MESSAGE);
        expectUntouched('appt-1', 'PENDING');
      }
    );

    it('also when the video appointment is already CONFIRMED or SCHEDULED', async () => {
      video({ status: 'SCHEDULED' });

      const error = await rejection(h.service.confirmAppointment('appt-1', 'clinic', ADMIN_A));

      expect(error.message).toBe(VIDEO_CONFIRMATION_REJECTION_MESSAGE);
      expectUntouched('appt-1', 'SCHEDULED');
    });
  });

  describe('completion', () => {
    const complete = (overrides: Record<string, unknown> = {}) =>
      h.service.markAppointmentCompleted('appt-1', 'doctor-1', 'clinic', {
        clinicId: CLINIC,
        userId: 'user-patient',
        diagnosis: 'flu',
        caller: ADMIN_A.caller,
        ...overrides,
      });

    it("completes an in-progress appointment of the caller's clinic, filtered by clinic AND status", async () => {
      h.world.db.insert('appointment', inPersonRow({ status: 'IN_PROGRESS' }));

      const result = (await complete()) as { success: boolean; clinicId: string };

      expect(result).toMatchObject({ success: true, clinicId: CLINIC });
      expect(h.world.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
      expect(h.world.db.rows('appointment')[0]?.['completedAt']).toBeInstanceOf(Date);
      const write = h.world.db.writes.find(entry => entry.op === 'updateMany');
      expect(write?.args['where']).toEqual({
        id: 'appt-1',
        clinicId: CLINIC,
        status: 'IN_PROGRESS',
      });
      expect(h.ehr.createPrescription).toHaveBeenCalledTimes(1);
    });

    it('an appointment that is already COMPLETED (the completion flow claimed it) still gets its EHR side effects, with no second write', async () => {
      h.world.db.insert('appointment', inPersonRow({ status: 'COMPLETED' }));

      const result = (await complete()) as { success: boolean };

      expect(result.success).toBe(true);
      expect(h.ehr.createPrescription).toHaveBeenCalledTimes(1);
      expect(h.world.db.rows('appointment')[0]?.['status']).toBe('COMPLETED');
    });

    it.each(['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'PENDING'])(
      'a %s appointment cannot be completed through the plugin: 400, no write, no prescription',
      async status => {
        h.world.db.insert('appointment', inPersonRow({ status }));

        const error = await rejection(complete());

        expect(error).toBeInstanceOf(BadRequestException);
        expectUntouched('appt-1', status);
        expect(h.ehr.createPrescription).not.toHaveBeenCalled();
      }
    );

    it('an in-progress VIDEO visit is not completed through the plugin (the completion flow owns its rules)', async () => {
      h.world.db.insert(
        'appointment',
        inPersonRow({ type: 'VIDEO_CALL', locationId: null, status: 'IN_PROGRESS' })
      );

      const error = await rejection(complete());

      expect(error).toBeInstanceOf(BadRequestException);
      expectUntouched('appt-1', 'IN_PROGRESS');
      expect(h.ehr.createPrescription).not.toHaveBeenCalled();
    });

    it('a completed VIDEO visit still gets its EHR side effects (that is how the completion flow uses this)', async () => {
      h.world.db.insert(
        'appointment',
        inPersonRow({ type: 'VIDEO_CALL', locationId: null, status: 'COMPLETED' })
      );

      const result = (await complete()) as { success: boolean };

      expect(result.success).toBe(true);
      expect(h.ehr.createPrescription).toHaveBeenCalledTimes(1);
    });
  });
});
