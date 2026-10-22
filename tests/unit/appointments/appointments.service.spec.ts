/**
 * Unit tests for the AppointmentsService entry points that wrap CoreAppointmentService:
 * the single-doctor resolution, create / list / detail / cancel plumbing (RBAC gate, clinic
 * context taken from the request, cache scoping) and the reception video-booking rule.
 *
 * The deeper state rules (complete, reschedule, status guards, check-in) have their own
 * suites (appointments-security, appointments-completion-rules, appointments-status-guards,
 * appointments-reschedule-and-slots, appointments-checkin-recovery).
 */
import { ForbiddenException, BadRequestException, HttpException } from '@nestjs/common';
import { AppointmentsService } from '@services/appointments/appointments.service';
import { Role } from '@core/types/enums.types';
import type { CreateAppointmentDto, AppointmentFilterDto } from '@dtos/appointment.dto';
import { createErrors } from './test-helpers';

type Row = Record<string, unknown>;

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';

function buildService() {
  const client = {
    doctorClinic: { findMany: jest.fn().mockResolvedValue([{ doctorId: 'doctor-1' }]) },
    patient: { findFirst: jest.fn().mockResolvedValue({ id: 'patient-1', userId: 'user-p' }) },
    appointment: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const db = {
    executeHealthcareRead: jest.fn((fn: (c: typeof client) => Promise<unknown>) => fn(client)),
    executeHealthcareWrite: jest.fn((fn: (c: typeof client) => Promise<unknown>) => fn(client)),
    findAppointmentByIdSafe: jest.fn().mockResolvedValue(null),
  };
  const core = {
    createAppointment: jest.fn().mockResolvedValue({
      success: true,
      data: { id: 'appt-1', status: 'PENDING', userId: 'user-p' },
    }),
    getAppointments: jest.fn().mockResolvedValue({ success: true, data: { appointments: [] } }),
    cancelAppointment: jest.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'appt-1',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        patient: { user: { firstName: 'Asha', lastName: 'Rao' } },
        doctor: { user: { name: 'Dr. Mehta' } },
      },
    }),
  };
  const cache = {
    cache: jest.fn((_key: string, loader: () => Promise<unknown>) => loader()),
    getKeyFactory: jest.fn(() => ({
      appointment: (id: string, scope: string) => `appointment:${id}:${scope}`,
      fromTemplate: (template: string, values: Record<string, string>) =>
        template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? ''),
    })),
    invalidateAppointmentCache: jest.fn().mockResolvedValue(0),
    invalidateCacheByTag: jest.fn().mockResolvedValue(0),
    invalidateCollectionTags: jest.fn().mockResolvedValue(0),
  };
  const rbac = { checkPermission: jest.fn().mockResolvedValue({ hasPermission: true }) };
  const events = { emit: jest.fn(), emitEnterprise: jest.fn().mockResolvedValue(undefined) };
  const reminders = {
    scheduleReminder: jest.fn().mockResolvedValue({ success: true, reminderId: 'r-1' }),
    cancelAppointmentReminder: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { getClinicQueue: jest.fn().mockResolvedValue([]) };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const config = { getEnv: jest.fn((_key: string, fallback: string) => fallback) };
  const billing = { bookAppointmentWithSubscription: jest.fn() };

  const noop = {} as never;
  const service = new AppointmentsService(
    core as never,
    noop, // conflictResolutionService
    noop, // workflowEngine
    noop, // businessRules
    noop, // pluginRegistry
    noop, // pluginManager
    noop, // clinicCheckInPlugin
    noop, // checkInService
    noop, // clinicNotificationPlugin
    noop, // clinicConfirmationPlugin
    noop, // clinicLocationPlugin
    noop, // clinicFollowUpPlugin
    reminders as never,
    noop, // clinicVideoPlugin
    logging as never,
    cache as never,
    noop, // queueService
    queue as never,
    events as never,
    config as never,
    db as never,
    noop, // qrService
    noop, // authService
    noop, // whatsAppService
    noop, // notificationPreferenceService
    createErrors(),
    rbac as never,
    billing as never
  );

  return { service, client, db, core, cache, rbac, events, reminders };
}

async function httpRejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

function videoBooking(overrides: Partial<CreateAppointmentDto> = {}): CreateAppointmentDto {
  return {
    patientId: 'patient-1',
    type: 'VIDEO_CALL',
    appointmentDate: '2026-11-02',
    time: '10:00',
    duration: 30,
    ...overrides,
  } as unknown as CreateAppointmentDto;
}

describe('AppointmentsService', () => {
  describe('resolveSingleDoctorId', () => {
    it("returns the clinic's one active doctor", async () => {
      const { service, client } = buildService();

      await expect(service.resolveSingleDoctorId(CLINIC)).resolves.toBe('doctor-1');
      expect(client.doctorClinic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clinicId: CLINIC, doctor: { user: { role: Role.DOCTOR, isActive: true } } },
        })
      );
    });

    it('is a 400 when the clinic has no doctor', async () => {
      const { service, client } = buildService();
      client.doctorClinic.findMany.mockResolvedValue([]);

      await expect(service.resolveSingleDoctorId(CLINIC)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('is a 400 asking for a doctorId when the clinic has several doctors', async () => {
      const { service, client } = buildService();
      client.doctorClinic.findMany.mockResolvedValue([{ doctorId: 'd1' }, { doctorId: 'd2' }]);

      await expect(service.resolveSingleDoctorId(CLINIC)).rejects.toThrow('doctorId is required');
    });
  });

  describe('createAppointment', () => {
    it('fills in the single doctor and books in the clinic of the request context', async () => {
      const { service, core, events, reminders } = buildService();

      const result = await service.createAppointment(
        videoBooking({ clinicId: OTHER_CLINIC } as Partial<CreateAppointmentDto>),
        'user-admin',
        CLINIC,
        Role.CLINIC_ADMIN
      );

      expect(result.success).toBe(true);
      expect(core.createAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doctor-1', patientId: 'patient-1' }),
        expect.objectContaining({ clinicId: CLINIC, userId: 'user-admin', doctorId: 'doctor-1' })
      );
      expect(reminders.scheduleReminder).toHaveBeenCalled();
      expect(events.emitEnterprise).toHaveBeenCalledWith(
        'appointment.created',
        expect.objectContaining({ clinicId: CLINIC })
      );
    });

    it('keeps an explicit doctorId without looking up the clinic doctor', async () => {
      const { service, core, client } = buildService();

      await service.createAppointment(
        videoBooking({ doctorId: 'doctor-9' }),
        'user-admin',
        CLINIC,
        Role.CLINIC_ADMIN
      );

      expect(client.doctorClinic.findMany).not.toHaveBeenCalled();
      expect(core.createAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doctor-9' }),
        expect.anything()
      );
    });

    it('refuses with 403 when RBAC denies create, and books nothing', async () => {
      const { service, core, rbac } = buildService();
      rbac.checkPermission.mockResolvedValue({ hasPermission: false });

      const error = await httpRejection(
        service.createAppointment(videoBooking(), 'user-admin', CLINIC, Role.CLINIC_ADMIN)
      );

      expect(error.getStatus()).toBe(403);
      expect(core.createAppointment).not.toHaveBeenCalled();
    });

    it('does not let the reception desk book a video visit', async () => {
      const { service, core } = buildService();

      await expect(
        service.createAppointment(videoBooking(), 'user-desk', CLINIC, Role.RECEPTIONIST)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(core.createAppointment).not.toHaveBeenCalled();
    });

    it('emits nothing when the core create fails', async () => {
      const { service, core, events } = buildService();
      core.createAppointment.mockResolvedValue({ success: false, error: 'slot taken' });

      const result = await service.createAppointment(
        videoBooking(),
        'user-admin',
        CLINIC,
        Role.CLINIC_ADMIN
      );

      expect(result.success).toBe(false);
      expect(events.emitEnterprise).not.toHaveBeenCalled();
    });
  });

  describe('getAppointments', () => {
    const filters = {} as AppointmentFilterDto;

    it('refuses with 403 when RBAC denies read', async () => {
      const { service, rbac, core } = buildService();
      rbac.checkPermission.mockResolvedValue({ hasPermission: false });

      const error = await httpRejection(
        service.getAppointments(filters, 'user-p', CLINIC, Role.PATIENT)
      );

      expect(error.getStatus()).toBe(403);
      expect(core.getAppointments).not.toHaveBeenCalled();
    });

    it('pins a patient to their own patient record, ignoring a patientId filter', async () => {
      const { service, core } = buildService();

      await service.getAppointments(
        { patientId: 'someone-else' } as AppointmentFilterDto,
        'user-p',
        CLINIC,
        Role.PATIENT
      );

      const context = core.getAppointments.mock.calls[0][1] as Row;
      expect(context).toEqual(
        expect.objectContaining({ clinicId: CLINIC, patientId: 'patient-1', role: Role.PATIENT })
      );
    });

    it('lets staff filter by patient and caches the list under a clinic-scoped key', async () => {
      const { service, core, cache } = buildService();

      await service.getAppointments(
        { patientId: 'patient-7' } as AppointmentFilterDto,
        'user-admin',
        CLINIC,
        Role.CLINIC_ADMIN,
        2,
        10
      );

      expect(core.getAppointments).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ clinicId: CLINIC, patientId: 'patient-7' }),
        2,
        10
      );
      const [key, , options] = cache.cache.mock.calls[0] as unknown as [string, unknown, Row];
      expect(key).toContain(`clinic:${CLINIC}:appointments:list:user-admin`);
      expect(options['tags']).toEqual(expect.arrayContaining([`clinic:${CLINIC}`]));
    });
  });

  describe('getAppointmentById', () => {
    it('returns the appointment of the caller clinic', async () => {
      const { service, db } = buildService();
      db.findAppointmentByIdSafe.mockResolvedValue({ id: 'appt-1', clinicId: CLINIC });

      const result = (await service.getAppointmentById('appt-1', CLINIC)) as Row;

      expect(result['id']).toBe('appt-1');
    });

    it("is a 404 for another clinic's appointment", async () => {
      const { service, db } = buildService();
      db.findAppointmentByIdSafe.mockResolvedValue({ id: 'appt-1', clinicId: OTHER_CLINIC });

      const error = await httpRejection(service.getAppointmentById('appt-1', CLINIC));

      expect(error.getStatus()).toBe(404);
    });

    it('is a 404 when a cached entry belongs to another clinic', async () => {
      const { service, cache } = buildService();
      cache.cache.mockResolvedValue({ id: 'appt-1', clinicId: OTHER_CLINIC });

      const error = await httpRejection(service.getAppointmentById('appt-1', CLINIC));

      expect(error.getStatus()).toBe(404);
    });
  });

  describe('cancelAppointment', () => {
    it('cancels through the core service, clears the reminder and broadcasts the names', async () => {
      const { service, core, reminders, events, cache } = buildService();

      const result = await service.cancelAppointment(
        'appt-1',
        'patient asked',
        'user-admin',
        CLINIC,
        Role.CLINIC_ADMIN
      );

      expect(result.success).toBe(true);
      expect(core.cancelAppointment).toHaveBeenCalledWith(
        'appt-1',
        'patient asked',
        expect.objectContaining({ clinicId: CLINIC, userId: 'user-admin' })
      );
      expect(cache.invalidateAppointmentCache).toHaveBeenCalledWith(
        'appt-1',
        'patient-1',
        'doctor-1',
        CLINIC
      );
      expect(reminders.cancelAppointmentReminder).toHaveBeenCalledWith(
        'appt-1',
        'appointment_reminder'
      );
      expect(events.emitEnterprise).toHaveBeenCalledWith(
        'appointment.cancelled',
        expect.objectContaining({
          payload: expect.objectContaining({
            patientName: 'Asha Rao',
            doctorName: 'Dr. Mehta',
            reason: 'patient asked',
          }),
        })
      );
    });

    it('refuses with 403 when RBAC denies the update', async () => {
      const { service, rbac, core } = buildService();
      rbac.checkPermission.mockResolvedValue({ hasPermission: false });

      const error = await httpRejection(
        service.cancelAppointment('appt-1', 'x', 'user-p', CLINIC, Role.PATIENT)
      );

      expect(error.getStatus()).toBe(403);
      expect(core.cancelAppointment).not.toHaveBeenCalled();
    });

    it('lets the SYSTEM role (schedulers) cancel without an RBAC check', async () => {
      const { service, rbac, core } = buildService();

      await service.cancelAppointment('appt-1', 'no-show', 'system', CLINIC, 'SYSTEM');

      expect(rbac.checkPermission).not.toHaveBeenCalled();
      expect(core.cancelAppointment).toHaveBeenCalled();
    });

    it('still cancels when clearing the queued reminder fails', async () => {
      const { service, reminders } = buildService();
      reminders.cancelAppointmentReminder.mockRejectedValue(new Error('queue down'));

      const result = await service.cancelAppointment(
        'appt-1',
        'x',
        'user-admin',
        CLINIC,
        Role.CLINIC_ADMIN
      );

      expect(result.success).toBe(true);
    });
  });
});
