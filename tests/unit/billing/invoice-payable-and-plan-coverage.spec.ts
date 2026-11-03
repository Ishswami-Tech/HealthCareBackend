import { describe, expect, it } from '@jest/globals';
import {
  INVOICE_NOT_PAYABLE_MESSAGE,
  checkInvoicePayable,
} from '../../../src/services/billing/invoice-amount.util';
import {
  effectivePlanAppointmentTypes,
  isPlanCoverableAppointmentType,
} from '../../../src/services/billing/subscription-coverage.util';

describe('checkInvoicePayable', () => {
  it('lets a PENDING invoice of a live visit be paid', () => {
    expect(checkInvoicePayable('PENDING', 'SCHEDULED')).toBeNull();
    expect(checkInvoicePayable('pending', null)).toBeNull();
  });

  it('refuses a PAID invoice with a 400', () => {
    expect(checkInvoicePayable('PAID', 'CONFIRMED')).toEqual({
      status: 400,
      message: 'Invoice is already paid',
    });
  });

  it('refuses a VOID invoice with a 409', () => {
    expect(checkInvoicePayable('VOID')).toEqual({
      status: 409,
      message: INVOICE_NOT_PAYABLE_MESSAGE,
    });
  });

  it.each(['EXPIRED', 'CANCELLED', 'NO_SHOW', 'expired'])(
    'refuses a still-PENDING invoice whose visit is %s with a 409',
    appointmentStatus => {
      expect(checkInvoicePayable('PENDING', appointmentStatus)).toEqual({
        status: 409,
        message: INVOICE_NOT_PAYABLE_MESSAGE,
      });
    }
  );
});

describe('plan coverage rule (in-person only)', () => {
  it('covers IN_PERSON only', () => {
    expect(isPlanCoverableAppointmentType('IN_PERSON')).toBe(true);
    expect(isPlanCoverableAppointmentType('in_person')).toBe(true);
    expect(isPlanCoverableAppointmentType('VIDEO_CALL')).toBe(false);
    expect(isPlanCoverableAppointmentType('HOME_VISIT')).toBe(false);
    expect(isPlanCoverableAppointmentType(undefined)).toBe(false);
  });

  it('never keeps VIDEO_CALL covered, whatever the plan row says', () => {
    expect(effectivePlanAppointmentTypes({ IN_PERSON: true, VIDEO_CALL: true })).toEqual({
      IN_PERSON: true,
      VIDEO_CALL: false,
    });
    expect(effectivePlanAppointmentTypes({ IN_PERSON: false })).toEqual({ IN_PERSON: false });
    expect(effectivePlanAppointmentTypes(null)).toEqual({});
    expect(effectivePlanAppointmentTypes(['VIDEO_CALL'])).toEqual({});
  });
});
