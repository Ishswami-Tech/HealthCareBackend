/// <reference types="jest" />
/**
 * Unit tests for the per-appointment authorisation that guards every video endpoint addressed by an
 * appointment id or a consultation id, the status endpoint's payment-required reason, the
 * clinic-scoped admin session list, and the lifecycle events (started / ended / appointment.completed)
 * that drive patient notifications and payout readiness.
 *
 * All collaborators are plain mocks; no database, cache or provider is touched.
 */

import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';

import { VideoService } from '@services/video/video.service';
import { HealthcareError } from '@core/errors';
import type { VideoCallerContext, VideoCallerRole } from '@services/video/video-access.helpers';

jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class QueueService {} }));
jest.mock('@core/rbac/rbac.service', () => ({ RbacService: class RbacService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@services/video/providers/video-provider.factory', () => ({
  VideoProviderFactory: class VideoProviderFactory {},
}));

type Deps = ConstructorParameters<typeof VideoService>;

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';
const PATIENT_USER = 'patient-user';
const BOOKER_USER = 'booker-user';
const DOCTOR_USER = 'doctor-user';
const START_MS = new Date('2026-03-10T10:00:00+05:30').getTime();

function makeAppointment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    userId: PATIENT_USER,
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    familyMemberId: null,
    type: 'VIDEO_CALL',
    status: 'CONFIRMED',
    date: new Date('2026-03-10T00:00:00.000Z'),
    time: '10:00',
    duration: 30,
    startedAt: null,
    completedAt: null,
    proposedSlots: [],
    confirmedSlotIndex: 0,
    metadata: {},
    payment: { status: 'COMPLETED' },
    patient: { id: 'patient-1', userId: PATIENT_USER },
    doctor: { id: 'doctor-1', userId: DOCTOR_USER },
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'vc-1',
    appointmentId: 'appt-1',
    roomId: 'room-1',
    roomName: 'room-1',
    meetingUrl: 'https://meet.example/room-1',
    status: 'ACTIVE',
    startTime: new Date('2026-03-10T04:30:00.000Z'),
    endTime: new Date('2026-03-10T05:00:00.000Z'),
    participants: [],
    recordingEnabled: false,
    screenSharingEnabled: true,
    chatEnabled: true,
    waitingRoomEnabled: true,
    ...overrides,
  };
}

function createHarness(): {
  service: VideoService;
  provider: Record<string, jest.Mock | string>;
  clients: {
    appointment: Record<string, jest.Mock>;
    familyMember: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    videoConsultation: Record<string, jest.Mock>;
  };
  databaseService: Record<string, jest.Mock>;
  eventService: { emitEnterprise: jest.Mock };
  loggingService: { log: jest.Mock };
} {
  const provider = {
    providerName: 'daily',
    generateMeetingToken: jest.fn(),
    startConsultation: jest.fn().mockResolvedValue(makeSession()),
    endConsultation: jest.fn().mockResolvedValue(makeSession({ status: 'COMPLETED' })),
    getConsultationSession: jest.fn().mockResolvedValue(makeSession()),
    listActiveSessions: jest.fn().mockResolvedValue([]),
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  const clients = {
    appointment: {
      findUnique: jest.fn().mockResolvedValue(makeAppointment()),
      findFirst: jest.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
    // The booking account is only told about the visit when it is a PATIENT-role user (or owns the
    // family dependent); see resolveVideoBookerUserId.
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'PATIENT' }) },
    videoConsultation: {
      // By default the id is not a consultation: it is taken as the appointment id itself.
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const databaseService = {
    findAppointmentByIdSafe: jest.fn().mockResolvedValue(makeAppointment()),
    executeRead: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation(clients)
    ),
    executeHealthcareRead: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation(clients)
    ),
    executeHealthcareWrite: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation(clients)
    ),
  };

  const cacheService = {
    invalidateAppointmentCache: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(true),
  };
  const eventService = { emitEnterprise: jest.fn().mockResolvedValue(undefined) };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const configService = {
    isVideoNoShowEnabled: jest.fn().mockReturnValue(false),
    getEnvBoolean: jest.fn().mockReturnValue(false),
  };
  const providerFactory = {
    getProvidersInOrder: jest.fn().mockReturnValue([provider]),
    getProviderWithFallback: jest.fn().mockResolvedValue(provider),
    getFallbackProvider: jest.fn().mockReturnValue(provider),
  };

  const service = new VideoService(
    configService as unknown as Deps[0],
    providerFactory as unknown as Deps[1],
    cacheService as unknown as Deps[2],
    databaseService as unknown as Deps[3],
    loggingService as unknown as Deps[4],
    eventService as unknown as Deps[5],
    {} as unknown as Deps[6],
    {} as unknown as Deps[7]
  );

  return { service, provider, clients, databaseService, eventService, loggingService };
}

function caller(rawRole: string, clinicId: string | undefined = CLINIC): VideoCallerContext {
  return { clinicId, rawRole };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

describe('VideoService.authorizeConsultationAccess', () => {
  it('lets the appointment patient in when addressed by a consultation id', async () => {
    const { service, clients, databaseService } = createHarness();
    clients.videoConsultation['findFirst']?.mockResolvedValue({
      id: 'vc-1',
      appointmentId: 'appt-1',
    });

    const result = await service.authorizeConsultationAccess(
      'vc-1',
      PATIENT_USER,
      'patient',
      caller('PATIENT')
    );

    expect(result).toEqual({ appointmentId: 'appt-1', consultationId: 'vc-1' });
    expect(databaseService['findAppointmentByIdSafe']).toHaveBeenCalledWith('appt-1');
  });

  it('treats an id without a consultation row as the appointment id', async () => {
    const { service, databaseService } = createHarness();

    const result = await service.authorizeConsultationAccess(
      'appt-1',
      PATIENT_USER,
      'patient',
      caller('PATIENT')
    );

    expect(result).toEqual({ appointmentId: 'appt-1', consultationId: null });
    expect(databaseService['findAppointmentByIdSafe']).toHaveBeenCalledWith('appt-1');
  });

  it('accepts the video-session-<id> form clients derive from an appointment', async () => {
    const { service, clients } = createHarness();

    await service.authorizeConsultationAccess(
      'video-session-appt-1',
      DOCTOR_USER,
      'doctor',
      caller('DOCTOR')
    );

    const where = clients.videoConsultation['findFirst']?.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, string>> };
    };
    expect(where.where.OR).toEqual([{ id: 'appt-1' }, { appointmentId: 'appt-1' }]);
  });

  it('answers 403 to a patient of the same clinic who is not a participant', async () => {
    const { service } = createHarness();

    const error = await captureError(
      service.authorizeConsultationAccess('appt-1', 'someone-else', 'patient', caller('PATIENT'))
    );

    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('answers 403 to a doctor who is not the appointment doctor', async () => {
    const { service } = createHarness();

    const error = await captureError(
      service.authorizeConsultationAccess('appt-1', 'other-doctor', 'doctor', caller('DOCTOR'))
    );

    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it.each<[VideoCallerRole, string]>([
    ['patient', 'PATIENT'],
    ['doctor', 'DOCTOR'],
    ['receptionist', 'NURSE'],
    ['clinic_admin', 'CLINIC_ADMIN'],
  ])('answers 404 to a %s (%s) acting in another clinic', async (role, rawRole) => {
    const { service } = createHarness();

    const error = await captureError(
      service.authorizeConsultationAccess(
        'appt-1',
        role === 'doctor' ? DOCTOR_USER : PATIENT_USER,
        role,
        caller(rawRole, OTHER_CLINIC)
      )
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('fails closed (404) when the request carries no clinic', async () => {
    const { service } = createHarness();

    const error = await captureError(
      service.authorizeConsultationAccess('appt-1', 'staff', 'receptionist')
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('lets same-clinic staff and the appointment doctor in', async () => {
    const { service } = createHarness();

    await expect(
      service.authorizeConsultationAccess('appt-1', 'nurse-user', 'receptionist', caller('NURSE'))
    ).resolves.toMatchObject({ appointmentId: 'appt-1' });
    await expect(
      service.authorizeConsultationAccess('appt-1', DOCTOR_USER, 'doctor', caller('DOCTOR'))
    ).resolves.toMatchObject({ appointmentId: 'appt-1' });
  });

  it('lets a SUPER_ADMIN in from outside the appointment clinic', async () => {
    const { service } = createHarness();

    await expect(
      service.authorizeConsultationAccess(
        'appt-1',
        'root',
        'clinic_admin',
        caller('SUPER_ADMIN', undefined)
      )
    ).resolves.toMatchObject({ appointmentId: 'appt-1' });
  });

  it('lets the account that booked the visit in as the patient', async () => {
    const { service, databaseService } = createHarness();
    databaseService['findAppointmentByIdSafe']?.mockResolvedValue(
      makeAppointment({ userId: BOOKER_USER })
    );

    await expect(
      service.authorizeConsultationAccess('appt-1', BOOKER_USER, 'patient', caller('PATIENT'))
    ).resolves.toMatchObject({ appointmentId: 'appt-1' });
  });

  it('answers 404 when no appointment can be resolved', async () => {
    const { service, databaseService } = createHarness();
    databaseService['findAppointmentByIdSafe']?.mockResolvedValue(null);

    const error = await captureError(
      service.authorizeConsultationAccess('missing', PATIENT_USER, 'patient', caller('PATIENT'))
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('answers 404 to an empty id without touching the database', async () => {
    const { service, databaseService } = createHarness();

    const error = await captureError(
      service.authorizeConsultationAccess('', PATIENT_USER, 'patient', caller('PATIENT'))
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(databaseService['executeHealthcareRead']).not.toHaveBeenCalled();
  });

  it('maps an unexpected failure to a fixed 500 and keeps the cause in the log only', async () => {
    const { service, databaseService, loggingService } = createHarness();
    databaseService['findAppointmentByIdSafe']?.mockRejectedValue(
      new Error("Can't reach database server at `db.internal.example:5432`")
    );

    const error = await captureError(
      service.authorizeConsultationAccess('appt-1', PATIENT_USER, 'patient', caller('PATIENT'))
    );

    expect(error).toBeInstanceOf(HealthcareError);
    expect((error as HttpException).getStatus()).toBe(500);
    expect((error as HttpException).message).toBe(
      'Could not verify access to the video consultation'
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('db.internal.example'),
      'VideoService.authorizeConsultationAccess',
      expect.any(Object)
    );
  });
});

describe('VideoService.getConsultationAccessState payment reason', () => {
  const unpaid = (): Record<string, unknown> =>
    makeAppointment({ payment: { status: 'PENDING' }, status: 'SCHEDULED' });

  it('blocks an unpaid patient when the controller passes the platform role "PATIENT"', async () => {
    const { service, databaseService } = createHarness();
    databaseService['findAppointmentByIdSafe']?.mockResolvedValue(unpaid());

    const state = await service.getConsultationAccessState('appt-1', {
      userId: PATIENT_USER,
      userRole: 'PATIENT',
    });

    expect(state.paymentRequired).toBe(true);
    expect(state.canJoin).toBe(false);
    expect(state.joinBlockedReason).toBe(
      'Payment is required before joining this video appointment.'
    );
  });

  it('keeps working for the lower-case role the lifecycle code uses', async () => {
    const { service, databaseService } = createHarness();
    databaseService['findAppointmentByIdSafe']?.mockResolvedValue(unpaid());

    const state = await service.getConsultationAccessState('appt-1', {
      userId: PATIENT_USER,
      userRole: 'patient',
    });

    expect(state.joinBlockedReason).toBe(
      'Payment is required before joining this video appointment.'
    );
  });

  it('does not report the patient payment reason to a doctor', async () => {
    const { service, databaseService } = createHarness();
    databaseService['findAppointmentByIdSafe']?.mockResolvedValue(unpaid());

    const state = await service.getConsultationAccessState('appt-1', {
      userId: DOCTOR_USER,
      userRole: 'DOCTOR',
    });

    expect(state.joinBlockedReason).not.toBe(
      'Payment is required before joining this video appointment.'
    );
  });
});

describe('VideoService.listAllActiveSessions', () => {
  it('returns every clinic for an unscoped (SUPER_ADMIN) call', async () => {
    const { service, provider, clients } = createHarness();
    const sessions = [
      makeSession({ id: 'a', appointmentId: 'appt-a' }),
      makeSession({ id: 'b', appointmentId: 'appt-b' }),
    ];
    (provider['listActiveSessions'] as jest.Mock).mockResolvedValue(sessions);

    const result = await service.listAllActiveSessions();

    expect(result).toHaveLength(2);
    expect(clients.appointment['findMany']).not.toHaveBeenCalled();
  });

  it('keeps only the sessions of the caller clinic for a clinic-scoped call', async () => {
    const { service, provider, clients } = createHarness();
    (provider['listActiveSessions'] as jest.Mock).mockResolvedValue([
      makeSession({ id: 'a', appointmentId: 'appt-a' }),
      makeSession({ id: 'b', appointmentId: 'appt-b' }),
    ]);
    clients.appointment['findMany']?.mockResolvedValue([{ id: 'appt-a' }]);

    const result = await service.listAllActiveSessions(CLINIC);

    expect(result.map(session => session.id)).toEqual(['a']);
    expect(clients.appointment['findMany']).toHaveBeenCalledWith({
      where: { id: { in: ['appt-a', 'appt-b'] }, clinicId: CLINIC },
      select: { id: true },
    });
  });

  it('fails closed (empty list) when the clinic lookup fails', async () => {
    const { service, provider, clients } = createHarness();
    (provider['listActiveSessions'] as jest.Mock).mockResolvedValue([makeSession()]);
    clients.appointment['findMany']?.mockRejectedValue(new Error('db down'));

    await expect(service.listAllActiveSessions(CLINIC)).resolves.toEqual([]);
  });
});

describe('VideoService lifecycle events', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(START_MS);
  });

  const startedEnvelope = (eventService: {
    emitEnterprise: jest.Mock;
  }): Record<string, unknown> => {
    const call = eventService.emitEnterprise.mock.calls.find(
      (args: unknown[]) => args[0] === 'video.consultation.started'
    );
    return (call?.[1] ?? {}) as Record<string, unknown>;
  };

  it('puts the patient and the doctor start in the started envelope (first doctor start)', async () => {
    const { service, clients, eventService } = createHarness();
    clients.appointment['findUnique']?.mockResolvedValue(
      makeAppointment({ userId: BOOKER_USER, startedAt: null })
    );

    await service.startConsultation('appt-1', DOCTOR_USER, 'doctor', caller('DOCTOR'));

    const envelope = startedEnvelope(eventService);
    expect(envelope['userId']).toBe(PATIENT_USER);
    expect(envelope['clinicId']).toBe(CLINIC);
    expect(envelope['metadata']).toEqual({
      appointmentId: 'appt-1',
      bookerUserId: BOOKER_USER,
      actorRole: 'doctor',
      firstStart: true,
    });
    // The legacy payload is unchanged for any other consumer.
    expect(envelope['payload']).toMatchObject({ appointmentId: 'appt-1', userId: DOCTOR_USER });
  });

  it('marks a doctor rejoin as not the first start', async () => {
    const { service, clients, eventService } = createHarness();
    clients.appointment['findUnique']?.mockResolvedValue(
      makeAppointment({ status: 'IN_PROGRESS', startedAt: new Date('2026-03-10T04:31:00Z') })
    );

    await service.startConsultation('appt-1', DOCTOR_USER, 'doctor', caller('DOCTOR'));

    expect(startedEnvelope(eventService)['metadata']).toMatchObject({
      actorRole: 'doctor',
      firstStart: false,
    });
  });

  it('marks a patient opening the room as a patient start', async () => {
    const { service, eventService } = createHarness();

    await service.startConsultation('appt-1', PATIENT_USER, 'patient', caller('PATIENT'));

    expect(startedEnvelope(eventService)['metadata']).toMatchObject({
      actorRole: 'patient',
      firstStart: false,
    });
  });

  describe('ending a consultation', () => {
    const doctorEnd = (service: VideoService): Promise<unknown> =>
      service.endConsultation('appt-1', DOCTOR_USER, 'doctor', undefined, caller('DOCTOR'));

    const emitted = (eventService: { emitEnterprise: jest.Mock }, name: string): unknown[][] =>
      eventService.emitEnterprise.mock.calls.filter((args: unknown[]) => args[0] === name);

    it('routes the ended event to the patient and the booker', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS', userId: BOOKER_USER })
      );

      await doctorEnd(service);

      const ended = emitted(eventService, 'video.consultation.ended')[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(ended['userId']).toBe(PATIENT_USER);
      expect(ended['clinicId']).toBe(CLINIC);
      expect(ended['metadata']).toEqual({
        appointmentId: 'appt-1',
        bookerUserId: BOOKER_USER,
        actorRole: 'doctor',
      });
    });

    it('emits appointment.completed once, only after this call won the status write', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );

      await doctorEnd(service);

      const completed = emitted(eventService, 'appointment.completed');
      expect(completed).toHaveLength(1);
      const envelope = completed[0]?.[1] as Record<string, unknown>;
      expect(envelope).toMatchObject({
        eventType: 'appointment.completed',
        clinicId: CLINIC,
        // Same convention as AppointmentsService: the patient profile id.
        userId: 'patient-1',
        payload: {
          appointmentId: 'appt-1',
          clinicId: CLINIC,
          completedBy: DOCTOR_USER,
          status: 'COMPLETED',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          appointment: { id: 'appt-1', status: 'COMPLETED', type: 'VIDEO_CALL' },
        },
      });
      // Compact summary: no payment records or profile rows on the event bus.
      const summary = (envelope['payload'] as { appointment: Record<string, unknown> }).appointment;
      expect(summary).not.toHaveProperty('payment');
      expect(summary).not.toHaveProperty('patient');
      // The status write happened before the announcement.
      expect(clients.appointment['updateMany']).toHaveBeenCalledTimes(1);
    });

    it('does not emit appointment.completed for an already COMPLETED appointment', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'COMPLETED', completedAt: new Date('2026-03-10T05:00:00Z') })
      );

      await doctorEnd(service);

      expect(emitted(eventService, 'appointment.completed')).toHaveLength(0);
    });

    it('does not emit appointment.completed when another request won the completion race', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      clients.appointment['updateMany']?.mockResolvedValue({ count: 0 });
      clients.appointment['findFirst']?.mockResolvedValue({ status: 'COMPLETED' });

      await doctorEnd(service);

      expect(emitted(eventService, 'appointment.completed')).toHaveLength(0);
      expect(emitted(eventService, 'video.consultation.ended')).toHaveLength(0);
    });

    it('does not emit appointment.completed when the appointment was cancelled meanwhile', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      clients.appointment['updateMany']?.mockResolvedValue({ count: 0 });
      clients.appointment['findFirst']?.mockResolvedValue({ status: 'CANCELLED' });

      await captureError(doctorEnd(service));

      expect(emitted(eventService, 'appointment.completed')).toHaveLength(0);
    });

    it('does not emit appointment.completed when a patient leaves the call', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );

      await service.endConsultation(
        'appt-1',
        PATIENT_USER,
        'patient',
        undefined,
        caller('PATIENT')
      );

      expect(emitted(eventService, 'appointment.completed')).toHaveLength(0);
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('still reports success when announcing the completion fails (the write is committed)', async () => {
      const { service, clients, eventService, loggingService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      eventService.emitEnterprise.mockImplementation(async (name: string) => {
        if (name === 'appointment.completed') {
          throw new Error('bus down');
        }
      });

      const session = (await doctorEnd(service)) as { id: string };

      expect(session.id).toBe('vc-1');
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('bus down'),
        'VideoService.emitAppointmentCompleted',
        expect.any(Object)
      );
    });
  });
});
