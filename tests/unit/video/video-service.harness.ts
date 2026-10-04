/// <reference types="jest" />
/**
 * Shared test harness for the VideoService unit specs: an appointment/session factory and a
 * VideoService built from plain mocks (no database, cache, event bus or provider is touched).
 *
 * The specs that import this file must register the same `jest.mock` calls for the heavy
 * transitive modules (billing, queue, rbac, config, cache, events, database, provider factory)
 * BEFORE importing it, exactly like video.service.spec.ts does.
 */

import { VideoService } from '@services/video/video.service';
import type { VideoCallerContext } from '@services/video/video-access.helpers';

type Deps = ConstructorParameters<typeof VideoService>;

export const CLINIC = 'clinic-1';
export const OTHER_CLINIC = 'clinic-2';
export const PATIENT_USER = 'patient-user';
export const DOCTOR_USER = 'doctor-user';
export const FOREIGN_USER = 'foreign-user';

// Appointment is booked for 2026-03-10 10:00 IST.
export const START_MS = new Date('2026-03-10T10:00:00+05:30').getTime();
export const MINUTE = 60_000;

export const RAW_DB_TEXT =
  "Invalid `prisma.appointment.updateMany()` invocation: Can't reach database server at `db.internal.example:5432`";

export function makeAppointment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

export function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

export function createHarness(): {
  service: VideoService;
  provider: Record<string, jest.Mock | string>;
  clients: {
    appointment: Record<string, jest.Mock>;
    review: Record<string, jest.Mock>;
    familyMember: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    videoConsultation: Record<string, jest.Mock>;
  };
  databaseService: Record<string, jest.Mock>;
  cacheService: Record<string, jest.Mock>;
  eventService: { emitEnterprise: jest.Mock };
  loggingService: { log: jest.Mock };
  heldLocks: Set<string>;
} {
  const heldLocks = new Set<string>();

  const provider = {
    providerName: 'daily',
    generateMeetingToken: jest.fn().mockResolvedValue({
      token: 'meeting-token',
      roomName: 'room-1',
      roomId: 'room-1',
      meetingUrl: 'https://meet.example/room-1',
    }),
    startConsultation: jest.fn().mockResolvedValue(makeSession()),
    endConsultation: jest.fn().mockResolvedValue(makeSession({ status: 'COMPLETED' })),
    getConsultationSession: jest.fn().mockResolvedValue(makeSession()),
    terminateRoom: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  const clients = {
    appointment: {
      findUnique: jest.fn().mockResolvedValue(makeAppointment()),
      findFirst: jest.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    review: {
      create: jest.fn().mockResolvedValue({ id: 'review-1' }),
      update: jest.fn().mockResolvedValue({ id: 'review-1' }),
    },
    familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    videoConsultation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'vc-1' }),
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
    executeRawQuery: jest.fn().mockResolvedValue([]),
  };

  const cacheService = {
    acquireLock: jest.fn(async (key: string): Promise<boolean> => {
      if (heldLocks.has(key)) {
        return false;
      }
      heldLocks.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key: string): Promise<boolean> => {
      heldLocks.delete(key);
      return true;
    }),
    invalidateAppointmentCache: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(true),
  };

  // EventService.emitEnterprise never throws: it resolves with { success: false } on failure.
  const eventService = {
    emitEnterprise: jest.fn().mockResolvedValue({ success: true, eventId: 'evt-1' }),
  };
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

  return {
    service,
    provider,
    clients,
    databaseService,
    cacheService,
    eventService,
    loggingService,
    heldLocks,
  };
}

export const USER_INFO = { displayName: 'Test User', email: 'test@example.com' };

export function patientCaller(clinicId: string | undefined = CLINIC): VideoCallerContext {
  return { clinicId, rawRole: 'PATIENT' };
}

export function staffCaller(
  rawRole: string,
  clinicId: string | undefined = CLINIC
): VideoCallerContext {
  return { clinicId, rawRole };
}

export async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

export function mockNow(ms: number): void {
  jest.spyOn(Date, 'now').mockReturnValue(ms);
}
