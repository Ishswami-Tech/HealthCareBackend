/**
 * The booking-update doctor summary: after an appointment.confirmed, at most one updated summary
 * per doctor per day, only for bookings dated today, only between the day's first scheduled
 * summary and the end of the doctor's last window (clinic settings), never for check-ins.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DoctorAppointmentEventListener } from '@communication/listeners/doctor-appointment-event.listener';

type ListenerDeps = ConstructorParameters<typeof DoctorAppointmentEventListener>;

const weekdays = (start: string, end: string) => ({
  monday: [{ start, end }],
  tuesday: [{ start, end }],
  wednesday: [{ start, end }],
  thursday: [{ start, end }],
  friday: [{ start, end }],
  saturday: [],
  sunday: [],
});

/** 2026-11-18 (a Wednesday) at HH:MM IST. */
const istAt = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00+05:30`);

function createListener(options: { linked?: boolean; queued?: boolean } = {}) {
  const findManyPairs = jest.fn(async () =>
    options.linked === false
      ? []
      : [
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
        ]
  );
  const database = {
    executeHealthcareRead: jest.fn(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        doctorClinic: { findMany: findManyPairs },
        doctorDayAvailability: { findMany: jest.fn(async () => []) },
      })
    ),
  };
  const queue = {
    getJob: jest.fn(async () => (options.queued ? { id: 'existing' } : null)),
    addJob: jest.fn(async () => ({ id: 'job' })),
  };
  const listener = new DoctorAppointmentEventListener(
    {} as unknown as ListenerDeps[0],
    database as unknown as ListenerDeps[1],
    queue as unknown as ListenerDeps[2],
    {} as unknown as ListenerDeps[3],
    { log: jest.fn() } as unknown as ListenerDeps[4]
  );
  return { listener, queue, findManyPairs };
}

const confirmed = (extra: Record<string, unknown> = {}) => ({
  appointmentId: `apt-${Math.random()}`,
  clinicId: 'clinic-1',
  doctorId: 'doc-1',
  appointment: { date: '2026-11-17T18:30:00.000Z' }, // IST midnight of 18 Nov
  ...extra,
});

describe('DoctorAppointmentEventListener', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues one delayed update for a booking today, inside the summary day', async () => {
    jest.setSystemTime(istAt('10:00'));
    const { listener, queue } = createListener();
    await listener.onAppointmentConfirmed(confirmed());
    expect(queue.addJob).toHaveBeenCalledTimes(1);
    const [, , data, opts] = queue.addJob.mock.calls[0] as unknown as [
      unknown,
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(data).toMatchObject({
      doctorId: 'doc-1',
      doctorUserId: 'user-1',
      clinicId: 'clinic-1',
      triggeredBy: 'appointment_confirmed',
      dateKey: '2026-11-18',
    });
    expect(opts).toMatchObject({
      correlationId: 'doctor-summary-user-1-clinic-1-2026-11-18-event',
    });
  });

  it('coalesces into the day’s existing update', async () => {
    jest.setSystemTime(istAt('10:00'));
    const { listener, queue } = createListener({ queued: true });
    await listener.onAppointmentConfirmed(confirmed());
    expect(queue.addJob).not.toHaveBeenCalled();
  });

  it('ignores the appointment.confirmed that check-in re-emits (no DB read)', async () => {
    jest.setSystemTime(istAt('10:00'));
    const { listener, queue, findManyPairs } = createListener();
    await listener.onAppointmentConfirmed(confirmed({ checkInMethod: 'qr', checkedInAt: 'x' }));
    expect(queue.addJob).not.toHaveBeenCalled();
    expect(findManyPairs).not.toHaveBeenCalled();
  });

  it('ignores a booking for another day (no DB read)', async () => {
    jest.setSystemTime(istAt('10:00'));
    const { listener, queue, findManyPairs } = createListener();
    await listener.onAppointmentConfirmed(
      confirmed({ appointment: { date: '2026-11-18T18:30:00.000Z' } }) // 19 Nov IST
    );
    expect(queue.addJob).not.toHaveBeenCalled();
    expect(findManyPairs).not.toHaveBeenCalled();
  });

  it('skips before the first scheduled summary and after the last window closes', async () => {
    for (const time of ['06:30', '17:30']) {
      jest.setSystemTime(istAt(time));
      const { listener, queue } = createListener();
      await listener.onAppointmentConfirmed(confirmed());
      expect(queue.addJob).not.toHaveBeenCalled();
    }
  });

  it('skips a doctor not linked to an active clinic', async () => {
    jest.setSystemTime(istAt('10:00'));
    const { listener, queue } = createListener({ linked: false });
    await listener.onAppointmentConfirmed(confirmed());
    expect(queue.addJob).not.toHaveBeenCalled();
  });
});
