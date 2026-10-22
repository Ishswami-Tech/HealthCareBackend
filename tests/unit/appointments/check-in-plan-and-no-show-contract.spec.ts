import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import {
  NO_ACTIVE_PLAN_CODE,
  NoActivePlanError,
  isNoActivePlanError,
  needsPlanLink,
} from '@services/appointments/core/check-in-plan.util';
import { classifyCheckInFailure } from '@services/clinic-ops/services/check-in-log.service';
import {
  BOOKED_NO_SHOW_TOO_EARLY_MESSAGE,
  getGenericStatusChangeRefusal,
  isBookedNoShowTooEarly,
  isValidAppointmentStatusTransition,
} from '@services/appointments/core/appointment-state-contract';

describe('no active plan at check-in (L1, H1)', () => {
  it('every plan refusal carries NO_ACTIVE_PLAN and is logged as such (not OTHER)', () => {
    for (const reason of ['missing', 'notFound', 'notValid', 'ended'] as const) {
      const error = new NoActivePlanError(reason);
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({ code: NO_ACTIVE_PLAN_CODE });
      expect(isNoActivePlanError(error)).toBe(true);
      expect(classifyCheckInFailure(error).reason).toBe('NO_ACTIVE_PLAN');
    }
    expect(classifyCheckInFailure(new BadRequestException('Something else')).reason).toBe('OTHER');
    expect(isNoActivePlanError(new Error('x'))).toBe(false);
  });

  it('the safety net links a plan only to a visit that has none', () => {
    expect(needsPlanLink({ subscriptionId: null, isSubscriptionBased: false })).toBe(true);
    expect(needsPlanLink({ subscriptionId: 's-1', isSubscriptionBased: false })).toBe(true);
    expect(needsPlanLink({ subscriptionId: 's-1', isSubscriptionBased: true })).toBe(false);
  });
});

describe('SCHEDULED -> NO_SHOW after the slot (B5)', () => {
  const now = new Date('2026-10-22T06:00:00Z');
  const past = new Date('2026-10-22T05:00:00Z');
  const future = new Date('2026-10-22T07:00:00Z');

  it('the transition table allows it; other no-show sources are unchanged', () => {
    expect(isValidAppointmentStatusTransition('SCHEDULED', 'NO_SHOW')).toBe(true);
    expect(isValidAppointmentStatusTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
    expect(isValidAppointmentStatusTransition('WAITING', 'NO_SHOW')).toBe(true);
    expect(isValidAppointmentStatusTransition('PENDING', 'NO_SHOW')).toBe(false);
    expect(isValidAppointmentStatusTransition('IN_PROGRESS', 'NO_SHOW')).toBe(false);
  });

  it('only once the slot time has passed (for staff and for the scheduler)', () => {
    expect(
      isBookedNoShowTooEarly({
        currentStatus: 'SCHEDULED',
        targetStatus: 'NO_SHOW',
        slotStartsAt: future,
        now,
      })
    ).toBe(true);
    expect(
      isBookedNoShowTooEarly({
        currentStatus: 'SCHEDULED',
        targetStatus: 'NO_SHOW',
        slotStartsAt: past,
        now,
      })
    ).toBe(false);
    expect(
      isBookedNoShowTooEarly({
        currentStatus: 'SCHEDULED',
        targetStatus: 'NO_SHOW',
        slotStartsAt: null,
        now,
      })
    ).toBe(true);
    expect(
      isBookedNoShowTooEarly({
        currentStatus: 'CONFIRMED',
        targetStatus: 'NO_SHOW',
        slotStartsAt: future,
        now,
      })
    ).toBe(false);

    for (const role of ['RECEPTIONIST', 'SYSTEM']) {
      expect(
        getGenericStatusChangeRefusal({
          currentStatus: 'SCHEDULED',
          targetStatus: 'NO_SHOW',
          role,
          slotStartsAt: future,
          now,
        })
      ).toEqual({ httpStatus: 400, message: BOOKED_NO_SHOW_TOO_EARLY_MESSAGE });
      expect(
        getGenericStatusChangeRefusal({
          currentStatus: 'SCHEDULED',
          targetStatus: 'NO_SHOW',
          role,
          slotStartsAt: past,
          now,
        })
      ).toBeNull();
    }
  });
});
