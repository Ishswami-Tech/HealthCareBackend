/**
 * Check-in timing. The live queue is keyed by today's IST date, so no caller may check in an
 * appointment that is not on today's IST date; a patient must also be inside the window
 * (30 min before .. 3 h after the appointment time). Staff may check in outside the window, on
 * the same IST day only.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { BadRequestException, HttpException } from '@nestjs/common';
import {
  CHECK_IN_NOT_TODAY_CODE,
  CHECK_IN_NOT_TODAY_MESSAGE,
  CHECK_IN_WINDOW_CLOSED_CODE,
  CHECK_IN_WINDOW_CLOSED_MESSAGE,
  assessCheckInTiming,
} from '@services/appointments/core/check-in-presence.util';
import type { ProcessCheckInOptions } from '@core/types/appointment.types';
import {
  DOCTOR_ACTOR,
  PATIENT_ACTOR,
  RECEPTIONIST_ACTOR,
  buildCheckInServiceWorld,
  checkInInput,
  inPersonRow,
  northOfClinic,
  type CheckInServiceWorld,
} from './check-in-service-world';
import {
  PINNED_NOW,
  istSlot,
  istSlotOnOtherDay,
  pinClock,
  unpinClock,
} from './check-in-time-helpers';

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

describe('assessCheckInTiming', () => {
  const at = (iso: string): Date => new Date(iso);
  // Appointment on 2026-10-05 at 12:00 IST = 06:30Z, stored as the IST day's midnight (UTC) value.
  const date = new Date('2026-10-05T00:00:00.000Z');

  it.each([
    ['30 minutes before (boundary)', '2026-10-05T06:00:00.000Z', true],
    ['31 minutes before', '2026-10-05T05:59:00.000Z', false],
    ['exactly at the time', '2026-10-05T06:30:00.000Z', true],
    ['3 hours after (boundary)', '2026-10-05T09:30:00.000Z', true],
    ['3 hours 1 minute after', '2026-10-05T09:31:00.000Z', false],
  ])('%s: within window = %s', (_label, nowIso, expected) => {
    const timing = assessCheckInTiming(date, '12:00', at(nowIso));

    expect(timing?.isWithinWindow).toBe(expected);
    expect(timing?.isSameIstDay).toBe(true);
  });

  it('combines the IST day and the IST wall clock (12:00 IST is 06:30Z, not 12:00Z)', () => {
    const timing = assessCheckInTiming(date, '12:00', at('2026-10-05T06:30:00.000Z'));

    expect(timing?.appointmentAt.toISOString()).toBe('2026-10-05T06:30:00.000Z');
  });

  it('is not the same IST day the moment the IST date rolls over, even inside the window', () => {
    // Appointment 23:50 IST on Oct 5; now is 00:10 IST on Oct 6 (Oct 5 18:40Z): 20 minutes late.
    const timing = assessCheckInTiming(date, '23:50', at('2026-10-05T18:40:00.000Z'));

    expect(timing?.isWithinWindow).toBe(true);
    expect(timing?.isSameIstDay).toBe(false);
  });

  it('judges the day in IST, not UTC (00:40 IST is still the previous UTC day)', () => {
    const early = new Date('2026-10-06T00:00:00.000Z');
    const timing = assessCheckInTiming(early, '01:00', at('2026-10-05T19:10:00.000Z'));

    expect(timing?.isSameIstDay).toBe(true);
    expect(timing?.isWithinWindow).toBe(true);
  });

  it.each([
    ['no date', null, '12:00'],
    ['no time', new Date('2026-10-05T00:00:00.000Z'), null],
    ['blank time', new Date('2026-10-05T00:00:00.000Z'), '   '],
    ['garbage time', new Date('2026-10-05T00:00:00.000Z'), 'noon'],
    ['invalid date', new Date('not a date'), '12:00'],
  ])('returns null (callers fail closed) for %s', (_label, value, time) => {
    expect(assessCheckInTiming(value as Date | null, time as string | null)).toBeNull();
  });
});

describe('CheckInLocationService.processCheckIn timing gate', () => {
  let w: CheckInServiceWorld;

  beforeEach(() => {
    pinClock();
    w = buildCheckInServiceWorld();
  });

  afterEach(() => {
    unpinClock();
  });

  const checkIn = (options: ProcessCheckInOptions, extra: Record<string, unknown> = {}) =>
    w.service.processCheckIn(checkInInput(extra), 'clinic-1', options);

  const patientForce: ProcessCheckInOptions = { actor: PATIENT_ACTOR, presence: 'required' };
  const patientScan: ProcessCheckInOptions = { actor: PATIENT_ACTOR, presence: 'if-supplied' };
  const reception: ProcessCheckInOptions = { actor: RECEPTIONIST_ACTOR, presence: 'skip' };
  const doctor: ProcessCheckInOptions = { actor: DOCTOR_ACTOR, presence: 'skip' };

  function expectNothingRecorded(): void {
    expect(w.db.rows('checkIn')).toHaveLength(0);
    expect(w.db.rows('appointment')[0]?.['status']).toBe('SCHEDULED');
    expect(w.db.rows('appointment')[0]?.['checkedInAt']).toBeNull();
    expect(w.queue.checkIn).not.toHaveBeenCalled();
  }

  function expectWindowClosed(error: HttpException): void {
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: CHECK_IN_WINDOW_CLOSED_CODE,
      message: CHECK_IN_WINDOW_CLOSED_MESSAGE,
    });
  }

  function expectNotToday(error: HttpException): void {
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: CHECK_IN_NOT_TODAY_CODE,
      message: CHECK_IN_NOT_TODAY_MESSAGE,
    });
  }

  describe('PATIENT force check-in (within 200 m)', () => {
    const here = northOfClinic(10);

    it.each([
      ['starting now', 0],
      ['30 minutes from now (window opens)', 30],
      ['3 hours ago (window closes)', -180],
    ])('an appointment %s is checked in: CONFIRMED + queued', async (_label, offset) => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(offset) }));

      const result = await checkIn(patientForce, { coordinates: here });

      expect(result.alreadyCheckedIn).toBeUndefined();
      expect(w.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(w.queue.checkIn).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['31 minutes before it starts', 31],
      ['3 hours 1 minute after it started', -181],
    ])('%s: 400 window closed, nothing recorded', async (_label, offset) => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(offset) }));

      expectWindowClosed(await rejection(checkIn(patientForce, { coordinates: here })));
      expectNothingRecorded();
    });

    it('an appointment next week is refused even though the patient stands on the clinic', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(7) }));

      expectNotToday(await rejection(checkIn(patientForce, { coordinates: here })));
      expectNothingRecorded();
    });

    it("yesterday's appointment is refused too (it would be CONFIRMED into today's queue)", async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(-1) }));

      expectNotToday(await rejection(checkIn(patientForce, { coordinates: here })));
      expectNothingRecorded();
    });

    it('an appointment tomorrow morning is refused (not today, whatever the clock says)', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(14 * 60) }));

      expectNotToday(await rejection(checkIn(patientForce, { coordinates: here })));
      expectNothingRecorded();
    });

    it('the window is checked before presence: a far-away patient outside the window gets the window error', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(-300) }));

      expectWindowClosed(
        await rejection(checkIn(patientForce, { coordinates: northOfClinic(900) }))
      );
    });
  });

  describe('PATIENT QR / manual code', () => {
    it('is bound by the same window and day rule inside processCheckIn', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(-200) }));

      expectWindowClosed(await rejection(checkIn(patientScan)));
      expectNothingRecorded();
    });

    it('refuses another day for a QR scan too', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(3) }));

      expectNotToday(await rejection(checkIn(patientScan)));
      expectNothingRecorded();
    });

    it('an already recorded arrival is not re-queued once the window has closed', async () => {
      w.db.insert('appointment', inPersonRow());
      await checkIn(patientScan);
      w.queue.checkIn.mockClear();
      // Time passes: the window closed at 15:00 IST, it is 15:05 now.
      pinClock(new Date(PINNED_NOW.getTime() + 3 * 60 * 60_000 + 5 * 60_000));

      expectWindowClosed(await rejection(checkIn(patientScan)));
      expect(w.queue.checkIn).not.toHaveBeenCalled();
    });
  });

  describe('staff (reception desk / clinical roles)', () => {
    it.each([
      ['a receptionist, 4 hours early', reception, 240],
      ['a receptionist, 5 hours late', reception, -300],
      ['a doctor, 2 hours early', doctor, 120],
    ])('%s: same IST day, outside the window is accepted', async (_label, options, offset) => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(offset) }));

      const result = await checkIn(options);

      expect(result.alreadyCheckedIn).toBeUndefined();
      expect(w.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
      expect(w.queue.checkIn).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a receptionist', reception],
      ['a doctor', doctor],
    ])(
      '%s cannot queue another day into today (next week): 400 not today',
      async (_label, options) => {
        w.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(7) }));

        expectNotToday(await rejection(checkIn(options)));
        expectNothingRecorded();
      }
    );

    it("yesterday's appointment is refused for staff too", async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(-1) }));

      expectNotToday(await rejection(checkIn(doctor)));
      expectNothingRecorded();
    });

    it('a clinic admin acting as staff gets the staff rule (same day, any hour)', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(-240) }));

      const result = await checkIn({
        actor: { userId: 'user-admin', role: 'CLINIC_ADMIN' },
        presence: 'skip',
      });

      expect(result.alreadyCheckedIn).toBeUndefined();
    });
  });

  describe('caller that does not identify itself', () => {
    it('is treated like a patient for the window (fail closed)', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlot(-240) }));

      expectWindowClosed(await rejection(checkIn({ presence: 'skip' })));
      expectNothingRecorded();
    });

    it('is refused for another day', async () => {
      w.db.insert('appointment', inPersonRow({ ...istSlotOnOtherDay(2) }));

      expectNotToday(await rejection(checkIn({})));
    });
  });

  describe('unreadable appointment time', () => {
    it.each([
      ['no time', { time: null }],
      ['garbage time', { time: 'noon' }],
      ['no date', { date: null }],
    ])('%s: 400 and nothing recorded, for staff and patients alike', async (_label, overrides) => {
      w.db.insert('appointment', inPersonRow(overrides));

      const patientError = await rejection(checkIn(patientScan));
      const staffError = await rejection(checkIn(doctor));

      for (const error of [patientError, staffError]) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toBe('Unable to determine appointment time');
      }
      expectNothingRecorded();
    });
  });
});
