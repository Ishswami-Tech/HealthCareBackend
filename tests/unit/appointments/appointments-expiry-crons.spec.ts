/**
 * The cron jobs that end appointments that never happened (finding 12 and the expiry rule):
 * the past-video closure cron, the in-clinic expiry cron, and the 3 AM no-show cron that must leave
 * paid visits to the expiry path. Real service and real core on an in-memory database.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { LogLevel } from '@core/types/logging.types';
import { AppointmentsService } from '@services/appointments/appointments.service';
import type { Row } from './test-helpers';
import { CLINIC, appointmentRow, paidVideoRow } from './appointments-harness';
import { buildRealCoreHarness, type RealCoreHarness } from './appointments-real-core-harness';

const LONG_AGO = new Date('2020-01-06T00:00:00.000+05:30');
const FAR_FUTURE = new Date('2099-01-05T00:00:00.000+05:30');

function pad(value: number, width = 3): string {
  return String(value).padStart(width, '0');
}

function stored(harness: RealCoreHarness, id: string): Row {
  const row = harness.db.rows('appointment').find(candidate => candidate['id'] === id);
  if (!row) {
    throw new Error(`no appointment ${id}`);
  }
  return row;
}

function appointmentWrites(harness: RealCoreHarness) {
  return harness.db.writes.filter(write => write.table === 'appointment');
}

function loggedWarning(harness: RealCoreHarness, fragment: string): boolean {
  return harness.logging.log.mock.calls.some(
    call => call[1] === LogLevel.WARN && String(call[2]).includes(fragment)
  );
}

function runtimeBudget(value: number): () => void {
  const statics = AppointmentsService as unknown as { EXPIRY_MAX_RUNTIME_MS: number };
  const original = statics.EXPIRY_MAX_RUNTIME_MS;
  statics.EXPIRY_MAX_RUNTIME_MS = value;
  return () => {
    statics.EXPIRY_MAX_RUNTIME_MS = original;
  };
}

describe('AppointmentsService.processPastVideoCallClosures', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
  });

  const dueVideo = (id: string, overrides: Row = {}): Row =>
    harness.db.insert(
      'appointment',
      paidVideoRow({ id, status: 'CONFIRMED', checkedInAt: null, date: LONG_AGO, ...overrides })
    );

  describe('pages through every candidate (beyond the first 200)', () => {
    it('closes 450 due visits in three pages with a (date, id) cursor', async () => {
      for (let index = 0; index < 450; index++) {
        dueVideo(`v-${pad(index)}`);
      }
      const updateStatus = jest
        .spyOn(harness.service, 'updateStatus')
        .mockResolvedValue({ success: true });

      const result = await harness.service.processPastVideoCallClosures();

      expect(result.totalChecked).toBe(450);
      expect(result.closed).toBe(450);
      expect(result.failed).toBe(0);
      expect(updateStatus).toHaveBeenCalledTimes(450);
      const queries = harness.db.appointmentQueries;
      expect(queries).toHaveLength(3);
      expect(queries.map(query => query['take'])).toEqual([200, 200, 200]);
      expect(queries[0]?.['orderBy']).toEqual([{ date: 'asc' }, { id: 'asc' }]);
      const secondWhere = queries[1]?.['where'] as Row;
      expect(secondWhere['OR']).toEqual([
        { date: { gt: LONG_AGO } },
        { date: LONG_AGO, id: { gt: 'v-199' } },
      ]);
    });

    it('visits each row once: the cursor moves past rows that stay open', async () => {
      for (let index = 0; index < 205; index++) {
        dueVideo(`v-${pad(index)}`);
      }
      const seen: string[] = [];
      jest.spyOn(harness.service, 'updateStatus').mockImplementation(async id => {
        seen.push(id);
        return { success: true };
      });

      await harness.service.processPastVideoCallClosures();

      expect(new Set(seen).size).toBe(205);
      expect(seen).toHaveLength(205);
    });

    it('a row that cannot be closed does not hold up the ones behind it', async () => {
      dueVideo('v-000');
      dueVideo('v-001');
      dueVideo('v-002');
      jest
        .spyOn(harness.service, 'updateStatus')
        .mockImplementation(async id =>
          id === 'v-000' ? { success: false, message: 'refused' } : { success: true }
        );

      const result = await harness.service.processPastVideoCallClosures();

      expect(result.closed).toBe(2);
      expect(result.failed).toBe(1);
      expect(loggedWarning(harness, 'was not expired')).toBe(true);
    });

    it('skips and logs a row whose time cannot be parsed, at the head or anywhere', async () => {
      dueVideo('v-000', { time: 'not-a-time' });
      dueVideo('v-001');
      dueVideo('v-002');
      const updateStatus = jest
        .spyOn(harness.service, 'updateStatus')
        .mockResolvedValue({ success: true });

      const result = await harness.service.processPastVideoCallClosures();

      expect(updateStatus).toHaveBeenCalledTimes(2);
      expect(result.closed).toBe(2);
      expect(loggedWarning(harness, 'cannot be parsed')).toBe(true);
    });

    it('never selects visits that are not due yet', async () => {
      dueVideo('v-future', { date: FAR_FUTURE });
      dueVideo('v-due');
      const updateStatus = jest
        .spyOn(harness.service, 'updateStatus')
        .mockResolvedValue({ success: true });

      await harness.service.processPastVideoCallClosures();

      expect(updateStatus).toHaveBeenCalledTimes(1);
      expect(updateStatus.mock.calls[0]?.[0]).toBe('v-due');
    });

    it('stops at its time budget and says so (the next tick resumes)', async () => {
      const restore = runtimeBudget(0);
      try {
        dueVideo('v-000');
        const updateStatus = jest
          .spyOn(harness.service, 'updateStatus')
          .mockResolvedValue({ success: true });

        await harness.service.processPastVideoCallClosures();

        expect(updateStatus).not.toHaveBeenCalled();
        expect(loggedWarning(harness, 'time budget')).toBe(true);
      } finally {
        restore();
      }
    });
  });

  describe('the expire write is conditional (a completed visit never becomes EXPIRED)', () => {
    it('closes a CONFIRMED, a SCHEDULED and an IN_PROGRESS visit through the real status flow', async () => {
      dueVideo('v-confirmed', { status: 'CONFIRMED' });
      dueVideo('v-scheduled', { status: 'SCHEDULED' });
      dueVideo('v-progress', { status: 'IN_PROGRESS' });

      const result = await harness.service.processPastVideoCallClosures();

      expect(result.closed).toBe(3);
      for (const id of ['v-confirmed', 'v-scheduled', 'v-progress']) {
        expect(stored(harness, id)['status']).toBe('EXPIRED');
      }
      expect(harness.events.emitEnterprise).toHaveBeenCalledWith(
        'appointment.expired',
        expect.objectContaining({ clinicId: CLINIC })
      );
    });

    it('a doctor completing between the cron read and the write wins: COMPLETED stays COMPLETED', async () => {
      dueVideo('v-1', { status: 'IN_PROGRESS' });
      const original = harness.db.executeHealthcareWrite.getMockImplementation();
      harness.db.executeHealthcareWrite.mockImplementationOnce(async (operation, audit) => {
        stored(harness, 'v-1')['status'] = 'COMPLETED';
        return original ? original(operation, audit) : operation(harness.db.client);
      });

      const result = await harness.service.processPastVideoCallClosures();

      expect(stored(harness, 'v-1')['status']).toBe('COMPLETED');
      expect(result.closed).toBe(0);
      expect(result.failed).toBe(1);
      expect(harness.events.emitEnterprise).not.toHaveBeenCalledWith(
        'appointment.expired',
        expect.anything()
      );
    });

    it('a visit completed before the status flow reads it is refused by the contract', async () => {
      harness.db.insert(
        'appointment',
        paidVideoRow({ id: 'v-2', status: 'COMPLETED', date: LONG_AGO })
      );

      const result = await harness.realCore.updateAppointment(
        'v-2',
        { status: 'EXPIRED' } as never,
        { userId: 'system', role: 'SYSTEM', clinicId: CLINIC }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_STATUS_TRANSITION');
      expect(stored(harness, 'v-2')['status']).toBe('COMPLETED');
    });
  });

  describe('the cron entry point', () => {
    it('logs a WARN when another replica holds the lock, and does not run', async () => {
      harness.cache.heldLocks.add('lock:cron:appointments:past-video-closure');
      const run = jest.spyOn(harness.service, 'processPastVideoCallClosures');

      await harness.service.handlePastVideoCallClosureCron();

      expect(run).not.toHaveBeenCalled();
      expect(loggedWarning(harness, 'lock is held')).toBe(true);
    });

    it('runs when it gets the lock, and does not log a warning', async () => {
      const run = jest
        .spyOn(harness.service, 'processPastVideoCallClosures')
        .mockResolvedValue({ totalChecked: 0, closed: 0, failed: 0, details: [] });

      await harness.service.handlePastVideoCallClosureCron();

      expect(run).toHaveBeenCalledTimes(1);
      expect(loggedWarning(harness, 'lock is held')).toBe(false);
    });
  });
});

describe('AppointmentsService.processExpiredInPersonAppointments', () => {
  let harness: RealCoreHarness;

  beforeEach(() => {
    harness = buildRealCoreHarness();
  });

  const inClinic = (id: string, overrides: Row = {}): Row =>
    harness.db.insert(
      'appointment',
      appointmentRow({
        id,
        status: 'SCHEDULED',
        checkedInAt: null,
        date: LONG_AGO,
        time: '10:00',
        duration: 30,
        payment: { status: 'PAID' },
        ...overrides,
      })
    );

  it('expires a paid SCHEDULED visit nobody arrived for, with a reason, and frees its slot', async () => {
    inClinic('a-1');

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(1);
    expect(stored(harness, 'a-1')['status']).toBe('EXPIRED');
    expect(String(stored(harness, 'a-1')['cancellationReason'])).toContain('not attended');
    expect(harness.events.emitEnterprise).toHaveBeenCalledWith(
      'appointment.expired',
      expect.objectContaining({ clinicId: CLINIC })
    );
  });

  it('leaves an UNPAID visit nobody arrived for to the 3 AM no-show cron', async () => {
    inClinic('a-u1', { payment: null });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(0);
    expect(stored(harness, 'a-u1')['status']).toBe('SCHEDULED');
    expect(appointmentWrites(harness)).toHaveLength(0);
  });

  it('expires a visit covered by a subscription plan like a paid one', async () => {
    inClinic('a-u2', { payment: null, subscriptionId: 'sub-1', isSubscriptionBased: true });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(1);
    expect(stored(harness, 'a-u2')['status']).toBe('EXPIRED');
  });

  it('expires a checked-in visit whatever its payment: it was confirmed, so it is never cancelled', async () => {
    inClinic('a-u3', {
      payment: null,
      status: 'CONFIRMED',
      checkedInAt: new Date('2020-01-05T05:00:00.000Z'),
    });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(1);
    expect(stored(harness, 'a-u3')['status']).toBe('EXPIRED');
  });

  it('expires a checked-in (CONFIRMED) visit that was never started, and removes it from the queue', async () => {
    inClinic('a-2', {
      status: 'CONFIRMED',
      checkedInAt: new Date('2020-01-05T05:00:00.000Z'),
    });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(1);
    expect(stored(harness, 'a-2')['status']).toBe('EXPIRED');
    expect(harness.queue.removePatientFromQueue).toHaveBeenCalledWith(
      'a-2',
      'doctor-1',
      CLINIC,
      'clinic'
    );
  });

  it('leaves the payment exactly as it is: no payment, invoice or refund call at all', async () => {
    inClinic('a-3', { payment: { status: 'COMPLETED' } });
    harness.db.insert('payment', { id: 'pay-1', appointmentId: 'a-3', status: 'COMPLETED' });

    await harness.service.processExpiredInPersonAppointments();

    expect(stored(harness, 'a-3')['status']).toBe('EXPIRED');
    expect(harness.db.rows('payment')).toEqual([
      { id: 'pay-1', appointmentId: 'a-3', status: 'COMPLETED' },
    ]);
    expect(harness.db.writes.every(write => write.table === 'appointment')).toBe(true);
    expect(harness.db.findPaymentsSafe).not.toHaveBeenCalled();
  });

  it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'PENDING'])(
    'never touches a %s visit',
    async status => {
      inClinic('a-4', { status });

      const result = await harness.service.processExpiredInPersonAppointments();

      expect(result.totalChecked).toBe(0);
      expect(stored(harness, 'a-4')['status']).toBe(status);
      expect(appointmentWrites(harness)).toHaveLength(0);
    }
  );

  it('never touches a video visit (its own cron owns those)', async () => {
    harness.db.insert(
      'appointment',
      paidVideoRow({ id: 'a-5', status: 'CONFIRMED', checkedInAt: null, date: LONG_AGO })
    );

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.totalChecked).toBe(0);
    expect(stored(harness, 'a-5')['status']).toBe('CONFIRMED');
  });

  it('does not expire a visit that is not due yet', async () => {
    inClinic('a-6', { date: FAR_FUTURE });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(0);
    expect(stored(harness, 'a-6')['status']).toBe('SCHEDULED');
  });

  it("does not expire today's SCHEDULED visit or a checked-in patient who is still waiting", async () => {
    const today = new Date(
      `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T00:00:00.000+05:30`
    );
    inClinic('a-7', { date: today, time: '23:50', duration: 3 });
    inClinic('a-8', {
      date: today,
      time: '09:00',
      status: 'CONFIRMED',
      checkedInAt: new Date(),
    });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(0);
    expect(stored(harness, 'a-7')['status']).toBe('SCHEDULED');
    expect(stored(harness, 'a-8')['status']).toBe('CONFIRMED');
  });

  it('a visit that was started after the scan read it is left untouched (conditional write)', async () => {
    inClinic('a-9');
    const original = harness.db.executeHealthcareWrite.getMockImplementation();
    harness.db.executeHealthcareWrite.mockImplementationOnce(async (operation, audit) => {
      stored(harness, 'a-9')['status'] = 'IN_PROGRESS';
      return original ? original(operation, audit) : operation(harness.db.client);
    });

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(0);
    expect(result.failed).toBe(0);
    expect(stored(harness, 'a-9')['status']).toBe('IN_PROGRESS');
    expect(harness.queue.removePatientFromQueue).not.toHaveBeenCalled();
    expect(harness.events.emitEnterprise).not.toHaveBeenCalled();
  });

  it('the write only ever matches SCHEDULED or CONFIRMED, in this clinic', async () => {
    inClinic('a-10');

    await harness.service.processExpiredInPersonAppointments();

    const where = appointmentWrites(harness)[0]?.args['where'] as Row;
    expect(where).toEqual({
      id: 'a-10',
      clinicId: CLINIC,
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
    });
  });

  it('processes every candidate beyond the first page', async () => {
    for (let index = 0; index < 250; index++) {
      inClinic(`a-${pad(index)}`);
    }

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.totalChecked).toBe(250);
    expect(result.expired).toBe(250);
    expect(harness.db.rows('appointment').every(row => row['status'] === 'EXPIRED')).toBe(true);
    expect(harness.db.appointmentQueries).toHaveLength(2);
  });

  it('skips and logs a visit whose time cannot be parsed, and keeps going', async () => {
    inClinic('a-000', { time: 'garbage' });
    inClinic('a-001');

    const result = await harness.service.processExpiredInPersonAppointments();

    expect(result.expired).toBe(1);
    expect(stored(harness, 'a-000')['status']).toBe('SCHEDULED');
    expect(stored(harness, 'a-001')['status']).toBe('EXPIRED');
    expect(loggedWarning(harness, 'cannot be parsed')).toBe(true);
  });

  it('logs a WARN when another replica holds the lock', async () => {
    harness.cache.heldLocks.add('lock:cron:appointments:in-person-expiry');
    const run = jest.spyOn(harness.service, 'processExpiredInPersonAppointments');

    await harness.service.handleExpiredInPersonAppointmentsCron();

    expect(run).not.toHaveBeenCalled();
    expect(loggedWarning(harness, 'lock is held')).toBe(true);
  });
});

describe('AppointmentsService.processNoShowCancellations (3 AM): one terminal path per row', () => {
  let harness: RealCoreHarness;
  let cancel: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    harness = buildRealCoreHarness();
    cancel = jest
      .spyOn(harness.service, 'cancelAppointment')
      .mockResolvedValue({ success: true, message: 'cancelled' });
  });

  afterEach(() => {
    cancel.mockRestore();
  });

  const old = (id: string, overrides: Row = {}): Row =>
    harness.db.insert(
      'appointment',
      appointmentRow({
        id,
        status: 'SCHEDULED',
        checkedInAt: null,
        date: LONG_AGO,
        payment: null,
        subscriptionId: null,
        isSubscriptionBased: false,
        ...overrides,
      })
    );

  it('cancels an unpaid, plan-less visit that nobody attended (the old behaviour)', async () => {
    old('n-1');

    const result = await harness.service.processNoShowCancellations();

    expect(result.cancelled).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[0]).toBe('n-1');
  });

  it.each([
    ['a PAID payment', { payment: { status: 'PAID' } }],
    ['a COMPLETED payment', { payment: { status: 'COMPLETED' } }],
    [
      'a PAID invoice behind a pending payment',
      { payment: { status: 'PENDING', invoice: { status: 'PAID' } } },
    ],
    ['a subscription plan', { subscriptionId: 'sub-1', isSubscriptionBased: true }],
  ])(
    'leaves a visit with %s to the expiry path: never cancelled here',
    async (_label, overrides) => {
      old('n-2', overrides);

      const result = await harness.service.processNoShowCancellations();

      expect(result.cancelled).toBe(0);
      expect(cancel).not.toHaveBeenCalled();
      expect(stored(harness, 'n-2')['status']).toBe('SCHEDULED');
    }
  );

  it('only sees SCHEDULED / CONFIRMED rows: an EXPIRED one is never picked up again', async () => {
    old('n-3', { status: 'EXPIRED' });

    const result = await harness.service.processNoShowCancellations();

    expect(result.totalChecked).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('a paid visit ends EXPIRED through the expiry cron, an unpaid one is cancelled here: one path each', async () => {
    old('paid', { payment: { status: 'PAID' } });
    old('unpaid');

    await harness.service.processExpiredInPersonAppointments();
    const noShow = await harness.service.processNoShowCancellations();

    expect(stored(harness, 'paid')['status']).toBe('EXPIRED');
    // Still SCHEDULED after the expiry cron; the mocked cancel flow (spy) does not change it.
    expect(stored(harness, 'unpaid')['status']).toBe('SCHEDULED');
    expect(noShow.cancelled).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[0]).toBe('unpaid');
  });
});
