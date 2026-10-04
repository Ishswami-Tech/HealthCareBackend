/// <reference types="jest" />
/**
 * Unit tests for the video appointment scheduler's open-visit reminders:
 * bounded/ordered candidate query and the reminder lock lifecycle.
 */

import { Logger } from '@nestjs/common';
import { VideoAppointmentSchedulerService } from '@services/appointments/plugins/video/video-scheduler.service';
import { getVideoActiveWindowMinutes } from '@config/video.config';

jest.mock('@infrastructure/database/prisma/generated/client', () => ({
  VideoCallStatus: {
    SCHEDULED: 'SCHEDULED',
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
  },
  VideoParticipantRole: { HOST: 'HOST', PARTICIPANT: 'PARTICIPANT' },
}));
jest.mock('@services/appointments/appointments.service', () => ({
  AppointmentsService: class AppointmentsService {},
}));
jest.mock('@services/video/video-consultation-tracker.service', () => ({
  VideoConsultationTracker: class VideoConsultationTracker {},
}));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));

type Deps = ConstructorParameters<typeof VideoAppointmentSchedulerService>;

const MINUTE = 60_000;
// Visit scheduled for 2026-03-10 10:00 IST; the doctor opened the call five minutes later.
const SCHEDULED_START_MS = new Date('2026-03-10T10:00:00+05:30').getTime();
const STARTED_AT = new Date(SCHEDULED_START_MS + 5 * MINUTE);
const FIRST_DUE_MS = STARTED_AT.getTime() + 45 * MINUTE;

function openVisit(): Record<string, unknown> {
  return {
    id: 'appt-1',
    clinicId: 'clinic-1',
    date: new Date('2026-03-10T00:00:00.000Z'),
    time: '10:00',
    startedAt: STARTED_AT,
    doctor: { userId: 'doctor-user' },
    patient: { user: { name: 'Pat Patient', firstName: null, lastName: null } },
  };
}

function expectedLockKey(nowMs: number): string {
  const expiresAt = SCHEDULED_START_MS + getVideoActiveWindowMinutes() * MINUTE;
  const lastDueAt = expiresAt - 30 * MINUTE;
  return `video:complete-reminder:appt-1:${nowMs >= lastDueAt ? 'last' : 'first'}`;
}

function createScheduler(): {
  scheduler: VideoAppointmentSchedulerService;
  findMany: jest.Mock;
  cacheService: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  eventService: { emitEnterprise: jest.Mock };
} {
  const findMany = jest.fn().mockResolvedValue([openVisit()]);
  const databaseService = {
    executeHealthcareRead: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation({ appointment: { findMany } })
    ),
  };
  const cacheService = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
  };
  const eventService = { emitEnterprise: jest.fn().mockResolvedValue(undefined) };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };

  const scheduler = new VideoAppointmentSchedulerService(
    databaseService as unknown as Deps[0],
    loggingService as unknown as Deps[1],
    {} as unknown as Deps[2],
    {} as unknown as Deps[3],
    {} as unknown as Deps[4],
    cacheService as unknown as Deps[5],
    eventService as unknown as Deps[6]
  );

  return { scheduler, findMany, cacheService, eventService };
}

describe('VideoAppointmentSchedulerService.handleOpenVideoVisitReminders', () => {
  const nowMs = FIRST_DUE_MS + MINUTE;

  beforeEach(() => {
    // Only Date is faked: promises and timers keep working normally.
    jest.useFakeTimers({
      now: nowMs,
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'hrtime',
        'performance',
      ],
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries a bounded, deterministically ordered batch', async () => {
    const { scheduler, findMany } = createScheduler();

    await scheduler.handleOpenVideoVisitReminders();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { date: 'asc' }, take: 200 })
    );
  });

  it('sends the reminder once and keeps the lock held', async () => {
    const { scheduler, cacheService, eventService } = createScheduler();

    await scheduler.handleOpenVideoVisitReminders();

    expect(cacheService.acquireLock).toHaveBeenCalledWith(
      expectedLockKey(nowMs),
      expect.any(Number)
    );
    expect(eventService.emitEnterprise).toHaveBeenCalledTimes(1);
    expect(cacheService.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the reminder lock when the emit throws so the next tick can retry', async () => {
    const { scheduler, cacheService, eventService } = createScheduler();
    eventService.emitEnterprise.mockRejectedValue(new Error('event bus down'));

    await expect(scheduler.handleOpenVideoVisitReminders()).resolves.toBeUndefined();

    expect(cacheService.releaseLock).toHaveBeenCalledWith(expectedLockKey(nowMs));
  });

  it('does not let a failing lock release mask the original failure or crash the cron', async () => {
    const { scheduler, cacheService, eventService } = createScheduler();
    eventService.emitEnterprise.mockRejectedValue(new Error('event bus down'));
    cacheService.releaseLock.mockRejectedValue(new Error('cache down'));

    await expect(scheduler.handleOpenVideoVisitReminders()).resolves.toBeUndefined();

    expect(cacheService.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when another instance already holds the lock', async () => {
    const { scheduler, cacheService, eventService } = createScheduler();
    cacheService.acquireLock.mockResolvedValue(false);

    await scheduler.handleOpenVideoVisitReminders();

    expect(eventService.emitEnterprise).not.toHaveBeenCalled();
    expect(cacheService.releaseLock).not.toHaveBeenCalled();
  });
});
