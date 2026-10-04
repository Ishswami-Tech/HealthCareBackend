/**
 * Pure rules of the generic appointment update: who may change which status, which fields each
 * caller may send, what "paid" means, and the doctor slot rule (video + in-clinic may share a slot,
 * two of a kind may not).
 */
import { describe, it, expect } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@core/types/enums.types';
import {
  COMPLETION_FLOW_MESSAGE,
  CONSULTATION_START_MESSAGE,
  IN_CLINIC_CONFIRMATION_MESSAGE,
  PATIENT_STATUS_CHANGE_MESSAGE,
  SYSTEM_ONLY_EXPIRY_MESSAGE,
  VIDEO_CONFIRMATION_MESSAGE,
  assertUpdateFieldsAllowed,
  buildAppointmentUpdateData,
  getGenericStatusChangeRefusal,
  isValidAppointmentStatusTransition,
} from '@services/appointments/core/appointment-state-contract';
import { isAppointmentPaid } from '@services/appointments/core/appointment-payment.util';
import {
  appointmentSlotKind,
  findConflictingSlotKind,
  slotConflictMessage,
} from '@services/appointments/core/appointment-slot-conflict.util';

const STAFF = [
  Role.RECEPTIONIST,
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.NURSE,
] as const;

function refusal(
  currentStatus: string,
  targetStatus: string,
  role: string,
  appointmentType = 'IN_PERSON'
) {
  return getGenericStatusChangeRefusal({ currentStatus, targetStatus, appointmentType, role });
}

describe('getGenericStatusChangeRefusal', () => {
  describe('the SYSTEM role', () => {
    it.each([
      ['IN_PROGRESS', 'EXPIRED'],
      ['SCHEDULED', 'CONFIRMED'],
      ['CONFIRMED', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'COMPLETED'],
    ])('is bound only by the transition table: %s -> %s is not refused here', (from, to) => {
      expect(refusal(from, to, 'SYSTEM')).toBeNull();
    });

    it('is an exact match: a lower-case "system" is just another unknown role', () => {
      expect(refusal('CONFIRMED', 'EXPIRED', 'system')?.httpStatus).toBe(403);
    });
  });

  it('never refuses a status sent unchanged', () => {
    expect(refusal('SCHEDULED', 'SCHEDULED', Role.PATIENT)).toBeNull();
    expect(refusal('CONFIRMED', 'CONFIRMED', Role.RECEPTIONIST)).toBeNull();
  });

  describe.each([Role.PATIENT, Role.PHARMACIST, Role.LAB_TECHNICIAN, 'USER', ''])(
    'a non-staff role (%p)',
    role => {
      it.each([
        'IN_PROGRESS',
        'COMPLETED',
        'CONFIRMED',
        'NO_SHOW',
        'EXPIRED',
        'CANCELLED',
        'RESCHEDULED',
      ])('gets 403 for %s', target => {
        expect(refusal('SCHEDULED', target, role)).toEqual({
          httpStatus: 403,
          message: PATIENT_STATUS_CHANGE_MESSAGE,
        });
      });
    }
  );

  describe.each(STAFF)('staff (%s)', role => {
    it('cannot expire a consultation in progress: only the system does (403)', () => {
      expect(refusal('IN_PROGRESS', 'EXPIRED', role)).toEqual({
        httpStatus: 403,
        message: SYSTEM_ONLY_EXPIRY_MESSAGE,
      });
    });

    it('cannot complete through the generic update (400): the complete flow does', () => {
      expect(refusal('IN_PROGRESS', 'COMPLETED', role)).toEqual({
        httpStatus: 400,
        message: COMPLETION_FLOW_MESSAGE,
      });
    });

    it('cannot start a consultation through the generic update (400)', () => {
      expect(refusal('CONFIRMED', 'IN_PROGRESS', role)).toEqual({
        httpStatus: 400,
        message: CONSULTATION_START_MESSAGE,
      });
    });

    it.each([
      'SCHEDULED',
      'PENDING',
      'FOLLOW_UP_SCHEDULED',
      'AWAITING_SLOT_CONFIRMATION',
      'RESCHEDULED',
      'TRANSFERRED',
    ])('cannot confirm a %s in-clinic visit (400): check-in does', from => {
      expect(refusal(from, 'CONFIRMED', role)).toEqual({
        httpStatus: 400,
        message: IN_CLINIC_CONFIRMATION_MESSAGE,
      });
    });

    it.each(['SCHEDULED', 'PENDING', 'AWAITING_SLOT_CONFIRMATION'])(
      'cannot confirm a %s video visit (400): payment does',
      from => {
        expect(refusal(from, 'CONFIRMED', role, 'VIDEO_CALL')).toEqual({
          httpStatus: 400,
          message: VIDEO_CONFIRMATION_MESSAGE,
        });
      }
    );

    it.each([
      ['CONFIRMED', 'NO_SHOW'],
      ['SCHEDULED', 'CANCELLED'],
      ['SCHEDULED', 'RESCHEDULED'],
      ['IN_PROGRESS', 'ON_HOLD'],
      ['ON_HOLD', 'SCHEDULED'],
      ['CONFIRMED', 'EXPIRED'],
    ])('keeps %s -> %s as the transition table decides', (from, to) => {
      expect(refusal(from, to, role)).toBeNull();
    });
  });
});

describe('assertUpdateFieldsAllowed', () => {
  const rejected = (dto: object, role: string): string => {
    try {
      assertUpdateFieldsAllowed(dto, role);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).message;
    }
    throw new Error('expected the update to be refused');
  };

  describe('a patient (or any non-staff role)', () => {
    it.each([Role.PATIENT, 'USER', Role.PHARMACIST])('may edit notes only: %s', role => {
      expect(() => assertUpdateFieldsAllowed({ notes: 'running late' }, role)).not.toThrow();
    });

    it('may echo the status back (the status policy decides on it)', () => {
      expect(() =>
        assertUpdateFieldsAllowed({ status: 'SCHEDULED', notes: 'x' }, Role.PATIENT)
      ).not.toThrow();
    });

    it.each([
      ['appointmentDate', '2099-01-06T10:00:00.000Z', 'reschedule'],
      ['duration', 30, 'reschedule'],
      ['doctorId', 'doctor-2', 'reassign'],
      ['clinicId', 'clinic-2', 'fixed once'],
      ['metadata', { rescheduleCount: 0 }, 'managed by the system'],
      ['priority', 'HIGH', ''],
      ['treatmentType', 'GENERAL_CONSULTATION', ''],
      ['symptoms', ['fever'], 'Clinical details'],
      ['diagnosis', 'x', 'Clinical details'],
      ['checkedInAt', new Date(), ''],
      ['patientId', 'patient-2', 'fixed once'],
      ['type', 'VIDEO_CALL', 'fixed once'],
      ['paymentStatus', 'PAID', ''],
    ])('cannot send %s (400, field named)', (field, value, hint) => {
      const message = rejected({ notes: 'ok', [field]: value }, Role.PATIENT);

      expect(message).toContain(`Field "${field}" cannot be changed here.`);
      expect(message).toContain(hint);
    });

    it('ignores a field that is present but undefined', () => {
      expect(() =>
        assertUpdateFieldsAllowed({ notes: 'ok', doctorId: undefined }, Role.PATIENT)
      ).not.toThrow();
    });
  });

  describe('clinic staff', () => {
    it.each(STAFF)('%s may change notes, priority, treatment type and reason', role => {
      expect(() =>
        assertUpdateFieldsAllowed(
          { notes: 'n', priority: 'HIGH', treatmentType: 'FOLLOW_UP', reason: 'r' },
          role
        )
      ).not.toThrow();
    });

    it.each([
      'appointmentDate',
      'duration',
      'doctorId',
      'clinicId',
      'locationId',
      'patientId',
      'type',
      'paymentStatus',
      'checkedInAt',
      'completedAt',
      'startedAt',
      'diagnosis',
      'prescription',
    ])('cannot send %s even as staff', field => {
      expect(rejected({ [field]: 'x' }, Role.CLINIC_ADMIN)).toContain(
        `Field "${field}" cannot be changed here.`
      );
    });

    it('a clinician may merge a consultation draft into the metadata', () => {
      expect(() =>
        assertUpdateFieldsAllowed({ metadata: { consultationDraft: { notes: 'x' } } }, Role.DOCTOR)
      ).not.toThrow();
    });

    it.each([
      { rescheduleCount: 0 },
      { consultationDraft: { notes: 'x' }, rescheduleCount: 0 },
      { consultationDraft: 'not an object' },
      {},
    ])('but any other metadata is refused: %j', metadata => {
      expect(rejected({ metadata }, Role.DOCTOR)).toContain('Field "metadata"');
    });

    it('the front desk does not write clinical drafts', () => {
      expect(rejected({ metadata: { consultationDraft: {} } }, Role.RECEPTIONIST)).toContain(
        'Field "metadata"'
      );
    });
  });

  describe('the SYSTEM role', () => {
    it('may set status, reason and notes: what the schedulers send', () => {
      expect(() =>
        assertUpdateFieldsAllowed({ status: 'EXPIRED', reason: 'r', notes: 'n' }, 'SYSTEM')
      ).not.toThrow();
    });

    it.each(['doctorId', 'clinicId', 'appointmentDate', 'metadata', 'checkedInAt'])(
      'is not a way around the allowlist: %s is refused',
      field => {
        expect(rejected({ [field]: 'x' }, 'SYSTEM')).toContain(`Field "${field}"`);
      }
    );
  });
});

describe('buildAppointmentUpdateData', () => {
  it('copies only the allowlisted fields', () => {
    const data = buildAppointmentUpdateData({
      updateDto: { notes: 'n', priority: 'HIGH', treatmentType: 'FOLLOW_UP' },
      existing: { metadata: {} },
      statusChange: undefined,
    });

    expect(data).toEqual({ notes: 'n', priority: 'HIGH', treatmentType: 'FOLLOW_UP' });
  });

  it('writes the status only when it changes', () => {
    expect(
      buildAppointmentUpdateData({
        updateDto: { status: 'SCHEDULED', notes: 'n' },
        existing: {},
        statusChange: undefined,
      })
    ).toEqual({ notes: 'n' });
    expect(
      buildAppointmentUpdateData({
        updateDto: { status: 'NO_SHOW' },
        existing: {},
        statusChange: 'NO_SHOW',
      })
    ).toEqual({ status: 'NO_SHOW' });
  });

  it.each(['EXPIRED', 'CANCELLED'])('maps the reason of a %s onto cancellationReason', status => {
    expect(
      buildAppointmentUpdateData({
        updateDto: { status, reason: ' because ' },
        existing: {},
        statusChange: status,
      })
    ).toEqual({ status, cancellationReason: 'because' });
  });

  it('maps the reason of any other change onto the notes, unless notes were sent', () => {
    expect(
      buildAppointmentUpdateData({
        updateDto: { reason: 'why' },
        existing: {},
        statusChange: undefined,
      })
    ).toEqual({ notes: 'why' });
    expect(
      buildAppointmentUpdateData({
        updateDto: { reason: 'why', notes: 'kept' },
        existing: {},
        statusChange: undefined,
      })
    ).toEqual({ notes: 'kept' });
  });

  it('merges a consultation draft into the stored metadata and keeps everything else', () => {
    const existing = { metadata: { rescheduleCount: 2, assignedDoctorId: 'doctor-9' } };

    const data = buildAppointmentUpdateData({
      updateDto: { metadata: { consultationDraft: { notes: 'x' } } },
      existing,
      statusChange: undefined,
    });

    expect(data['metadata']).toEqual({
      rescheduleCount: 2,
      assignedDoctorId: 'doctor-9',
      consultationDraft: { notes: 'x' },
    });
    expect(existing.metadata).toEqual({ rescheduleCount: 2, assignedDoctorId: 'doctor-9' });
  });

  it('never passes an unlisted field through, whatever the caller policy let by', () => {
    const data = buildAppointmentUpdateData({
      updateDto: { notes: 'n', doctorId: 'doctor-2', clinicId: 'clinic-2', metadata: { a: 1 } },
      existing: {},
      statusChange: undefined,
    });

    expect(data).toEqual({ notes: 'n' });
  });
});

describe('the state table', () => {
  it('PENDING -> CONFIRMED is not a transition (video is confirmed by payment, never by a status change)', () => {
    expect(isValidAppointmentStatusTransition('PENDING', 'CONFIRMED')).toBe(false);
  });
});

describe('isAppointmentPaid', () => {
  it.each(['PAID', 'COMPLETED', 'SUCCESS', 'CAPTURED', 'paid', ' Completed '])(
    'a payment with status %p is paid',
    status => {
      expect(isAppointmentPaid({ payment: { status } })).toBe(true);
    }
  );

  it('an unpaid payment row is not paid', () => {
    expect(isAppointmentPaid({ payment: { status: 'PENDING' } })).toBe(false);
    expect(isAppointmentPaid({})).toBe(false);
    expect(isAppointmentPaid({ payment: null })).toBe(false);
  });

  it('a PENDING payment row whose invoice is PAID is paid (the union, not first-truthy-wins)', () => {
    expect(isAppointmentPaid({ payment: { status: 'PENDING', invoice: { status: 'PAID' } } })).toBe(
      true
    );
  });

  it('counts the payment-status field, billing, invoice and the boolean flags', () => {
    expect(isAppointmentPaid({ paymentStatus: 'SUCCESS' })).toBe(true);
    expect(isAppointmentPaid({ billing: { status: 'PAID' } })).toBe(true);
    expect(isAppointmentPaid({ billing: { paid: true } })).toBe(true);
    expect(isAppointmentPaid({ invoice: { paymentStatus: 'CAPTURED' } })).toBe(true);
    expect(isAppointmentPaid({ invoice: { paid: true } })).toBe(true);
    expect(isAppointmentPaid({ paymentCompleted: true })).toBe(true);
    expect(isAppointmentPaid({ isPaid: true })).toBe(true);
    expect(isAppointmentPaid({ paid: true })).toBe(true);
  });

  it('accepts a list of payment entries', () => {
    expect(isAppointmentPaid({ payment: [{ status: 'PENDING' }, { status: 'PAID' }] })).toBe(true);
    expect(isAppointmentPaid({ payment: [{ status: 'PENDING' }] })).toBe(false);
  });

  it('a visit covered by a subscription plan is comped', () => {
    expect(isAppointmentPaid({ subscriptionId: 'sub-1', isSubscriptionBased: true })).toBe(true);
    expect(isAppointmentPaid({ subscriptionId: 'sub-1', isSubscriptionBased: false })).toBe(false);
    expect(isAppointmentPaid({ subscriptionId: null, isSubscriptionBased: true })).toBe(false);
  });
});

describe('the doctor slot rule', () => {
  const inClinic = { id: 'a', type: 'IN_PERSON', time: '10:00', duration: 30 };
  const video = { id: 'b', type: 'VIDEO_CALL', time: '10:00', duration: 15 };

  it('treats every non-video type as in-clinic', () => {
    expect(appointmentSlotKind('VIDEO_CALL')).toBe('VIDEO');
    expect(appointmentSlotKind('IN_PERSON')).toBe('IN_CLINIC');
    expect(appointmentSlotKind('HOME_VISIT')).toBe('IN_CLINIC');
    expect(appointmentSlotKind(undefined)).toBe('IN_CLINIC');
  });

  it('lets a video visit share a slot with an in-clinic visit, both ways', () => {
    expect(findConflictingSlotKind([inClinic], { type: 'VIDEO_CALL', time: '10:00' })).toBeNull();
    expect(findConflictingSlotKind([video], { type: 'IN_PERSON', time: '10:00' })).toBeNull();
  });

  it('refuses two video visits in one slot', () => {
    expect(findConflictingSlotKind([video], { type: 'VIDEO_CALL', time: '10:00' })).toBe('VIDEO');
    expect(findConflictingSlotKind([video], { type: 'VIDEO_CALL', time: '10:14' })).toBe('VIDEO');
  });

  it('refuses two in-clinic visits in one slot (home visits count as in-clinic)', () => {
    expect(findConflictingSlotKind([inClinic], { type: 'IN_PERSON', time: '10:00' })).toBe(
      'IN_CLINIC'
    );
    expect(findConflictingSlotKind([inClinic], { type: 'HOME_VISIT', time: '10:29' })).toBe(
      'IN_CLINIC'
    );
  });

  it('is about overlap, not the start time: adjacent slots are free', () => {
    expect(findConflictingSlotKind([video], { type: 'VIDEO_CALL', time: '10:15' })).toBeNull();
    expect(findConflictingSlotKind([video], { type: 'VIDEO_CALL', time: '09:45' })).toBeNull();
    expect(findConflictingSlotKind([inClinic], { type: 'IN_PERSON', time: '10:30' })).toBeNull();
  });

  it('an existing visit without a duration occupies 30 minutes', () => {
    const open = { id: 'c', type: 'IN_PERSON', time: '10:00', duration: null };
    expect(findConflictingSlotKind([open], { type: 'IN_PERSON', time: '10:20' })).toBe('IN_CLINIC');
    expect(findConflictingSlotKind([open], { type: 'IN_PERSON', time: '10:30' })).toBeNull();
  });

  it('has a clear message per kind', () => {
    expect(slotConflictMessage('VIDEO')).toBe('This doctor already has a video visit in that slot');
    expect(slotConflictMessage('IN_CLINIC')).toBe(
      'This doctor already has an in-clinic visit in that slot'
    );
  });
});
