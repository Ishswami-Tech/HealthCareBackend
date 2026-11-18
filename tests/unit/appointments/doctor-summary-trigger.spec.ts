/**
 * AppointmentsService.triggerScheduledDoctorSummaries (runs every minute) and the window label
 * DoctorSummaryService puts in a window summary. Fixture: the live clinic's shape, video calls
 * 14:00-17:00, clinic 09:00-18:00 Mon-Fri, doctor 09:00-17:00 Mon-Fri; 2026-11-18 is a Wednesday.
 */
import { AppointmentsService } from '@services/appointments/appointments.service';
import { DoctorSummaryService } from '@communication/services/doctor-summary.service';
import { JobType } from '@core/types/queue.types';

const weekdays = (start: string, end: string) => ({
  monday: [{ start, end }],
  tuesday: [{ start, end }],
  wednesday: [{ start, end }],
  thursday: [{ start, end }],
  friday: [{ start, end }],
  saturday: [],
  sunday: [],
});

const istAt = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00+05:30`);

function setup(existing: { state: string } | null = null) {
  const client = {
    doctorClinic: {
      findMany: jest.fn().mockResolvedValue([
        {
          doctorId: 'doc-1',
          clinicId: 'clinic-1',
          locationId: null,
          startTime: null,
          endTime: null,
          doctor: { userId: 'user-1', workingHours: weekdays('09:00', '17:00') },
          location: null,
          clinic: {
            locations: [],
            settings: {
              appointmentSettings: {
                videoCallWindow: { start: '14:00', end: '17:00' },
                operatingWindowsByDay: weekdays('09:00', '18:00'),
              },
            },
          },
        },
      ]),
    },
    doctorDayAvailability: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const job = existing
    ? { getState: jest.fn().mockResolvedValue(existing.state), retry: jest.fn() }
    : null;
  const fake = {
    databaseService: {
      executeHealthcareRead: jest.fn((fn: (c: typeof client) => Promise<unknown>) => fn(client)),
    },
    queueService: {
      getJob: jest.fn().mockResolvedValue(job),
      addJob: jest.fn().mockResolvedValue({ id: 'job' }),
    },
    loggingService: { log: jest.fn().mockResolvedValue(undefined) },
  };
  const trigger = (now: Date) =>
    AppointmentsService.prototype.triggerScheduledDoctorSummaries.call(
      fake as unknown as AppointmentsService,
      now
    );
  return { fake, job, trigger };
}

describe('triggerScheduledDoctorSummaries', () => {
  it('enqueues the video window summary as its own job type, naming the window', async () => {
    const { fake, trigger } = setup();
    await expect(trigger(istAt('13:45'))).resolves.toMatchObject({ due: 1, enqueued: 1 });
    expect(fake.queueService.addJob).toHaveBeenCalledWith(
      JobType.DOCTOR_WINDOW_SUMMARY,
      'send-doctor-window-summary',
      {
        doctorId: 'doc-1',
        doctorUserId: 'user-1',
        clinicId: 'clinic-1',
        triggeredBy: 'window_reminder',
        dateKey: '2026-11-18',
        window: 'video',
        windowStart: '14:00',
        windowEnd: '17:00',
        typeFilter: { in: ['VIDEO_CALL'] },
      },
      expect.objectContaining({
        correlationId: 'doctor-summary-user-1-clinic-1-2026-11-18-video-window',
        attempts: 8,
        backoff: { type: 'fixed', delay: 30_000 },
      })
    );
  });

  it('enqueues the morning summary as a full-day DOCTOR_SUMMARY', async () => {
    const { fake, trigger } = setup();
    await trigger(istAt('07:00'));
    expect(fake.queueService.addJob).toHaveBeenCalledWith(
      JobType.DOCTOR_SUMMARY,
      'send-doctor-daily-summary',
      expect.not.objectContaining({ window: expect.anything() }),
      expect.objectContaining({
        correlationId: 'doctor-summary-user-1-clinic-1-2026-11-18-cron',
        attempts: 3,
      })
    );
  });

  it('retries a summary whose job failed, while it is still due', async () => {
    const { fake, job, trigger } = setup({ state: 'failed' });
    await expect(trigger(istAt('13:50'))).resolves.toMatchObject({ retried: 1, enqueued: 0 });
    expect(job?.retry).toHaveBeenCalledWith('failed');
    expect(fake.queueService.addJob).not.toHaveBeenCalled();
  });

  it('leaves a summary that is queued, running or sent alone', async () => {
    for (const state of ['waiting', 'delayed', 'active', 'completed']) {
      const { fake, job, trigger } = setup({ state });
      await expect(trigger(istAt('13:50'))).resolves.toMatchObject({ alreadyQueued: 1 });
      expect(job?.retry).not.toHaveBeenCalled();
      expect(fake.queueService.addJob).not.toHaveBeenCalled();
    }
  });

  it('enqueues nothing outside every summary span', async () => {
    const { fake, trigger } = setup();
    await expect(trigger(istAt('11:00'))).resolves.toMatchObject({ due: 0 });
    expect(fake.queueService.addJob).not.toHaveBeenCalled();
  });
});

describe('DoctorSummaryService.formatWindowLabel', () => {
  const service = new DoctorSummaryService({} as never, {} as never, {} as never);

  it('names the window with 12-hour times', () => {
    expect(service.formatWindowLabel({ kind: 'video', start: '14:00', end: '17:00' })).toBe(
      'video consultations 2:00 PM - 5:00 PM'
    );
    expect(service.formatWindowLabel({ kind: 'in_person', start: '09:00', end: '12:30' })).toBe(
      'OPD 9:00 AM - 12:30 PM'
    );
    expect(service.formatWindowLabel({ kind: 'in_person', start: '00:05', end: '23:59' })).toBe(
      'OPD 12:05 AM - 11:59 PM'
    );
  });

  it('gives no label for malformed times', () => {
    expect(service.formatWindowLabel({ kind: 'video', start: '25:00', end: '17:00' })).toBeNull();
    expect(service.formatWindowLabel({ kind: 'video', start: '14:00', end: '' })).toBeNull();
  });
});
