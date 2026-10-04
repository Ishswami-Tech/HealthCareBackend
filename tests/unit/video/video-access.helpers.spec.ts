/// <reference types="jest" />
/**
 * Unit tests for the video access-control and error-classification helpers.
 */

import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import {
  assertParticipantOrClinicStaff,
  isClinicAdminRole,
  isPatientOwner,
  resolveVideoCompletionActor,
  toVideoCallerRole,
  type VideoAccessAppointment,
} from '@services/video/video-access.helpers';
import { extractErrorMessage } from '@core/errors/error-message.util';
import { isProviderUnavailableError } from '@services/video/video-completion.helpers';

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';

function appointment(overrides: Partial<VideoAccessAppointment> = {}): VideoAccessAppointment {
  return {
    clinicId: CLINIC,
    userId: 'booker-user',
    patient: { userId: 'patient-user' },
    doctor: { userId: 'doctor-user' },
    ...overrides,
  };
}

describe('assertParticipantOrClinicStaff', () => {
  describe('clinic isolation', () => {
    it.each(['patient', 'doctor', 'receptionist', 'clinic_admin'] as const)(
      'answers NotFound to a %s of another clinic',
      role => {
        expect(() =>
          assertParticipantOrClinicStaff(appointment(), {
            userId: role === 'patient' ? 'patient-user' : 'doctor-user',
            role,
            clinicId: OTHER_CLINIC,
          })
        ).toThrow(NotFoundException);
      }
    );

    it('fails closed when the caller has no clinic context', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'patient-user',
          role: 'patient',
        })
      ).toThrow(NotFoundException);
    });

    it('lets a SUPER_ADMIN act without a matching clinic', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'root',
          role: 'clinic_admin',
          rawRole: 'SUPER_ADMIN',
        })
      ).not.toThrow();
    });

    it('does not treat a lowercase look-alike as a SUPER_ADMIN of another clinic', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'root',
          role: 'clinic_admin',
          rawRole: 'clinic_admin',
          clinicId: OTHER_CLINIC,
        })
      ).toThrow(NotFoundException);
    });
  });

  describe('patients', () => {
    it('allows the appointment patient', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'patient-user',
          role: 'patient',
          clinicId: CLINIC,
        })
      ).not.toThrow();
    });

    it('allows the account holder that booked the appointment', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'booker-user',
          role: 'patient',
          clinicId: CLINIC,
        })
      ).not.toThrow();
    });

    it('allows the owner of the family dependent the appointment is for', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'someone-else',
          role: 'patient',
          clinicId: CLINIC,
          ownsFamilyMember: true,
        })
      ).not.toThrow();
    });

    it('rejects a foreign patient of the same clinic with Forbidden', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'foreign-patient',
          role: 'patient',
          clinicId: CLINIC,
        })
      ).toThrow(ForbiddenException);
    });
  });

  describe('doctors', () => {
    it('allows the appointment doctor', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'doctor-user',
          role: 'doctor',
          clinicId: CLINIC,
          rawRole: 'DOCTOR',
        })
      ).not.toThrow();
    });

    it('rejects another doctor of the same clinic', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'other-doctor-user',
          role: 'doctor',
          clinicId: CLINIC,
          rawRole: 'DOCTOR',
        })
      ).toThrow(ForbiddenException);
    });

    it('allows an assistant doctor of the same clinic', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'assistant-user',
          role: 'doctor',
          clinicId: CLINIC,
          rawRole: 'ASSISTANT_DOCTOR',
        })
      ).not.toThrow();
    });

    it('does not extend the assistant rule to therapists or counselors', () => {
      expect(() =>
        assertParticipantOrClinicStaff(appointment(), {
          userId: 'therapist-user',
          role: 'doctor',
          clinicId: CLINIC,
          rawRole: 'THERAPIST',
        })
      ).toThrow(ForbiddenException);
    });
  });

  describe('clinic staff', () => {
    it.each(['receptionist', 'clinic_admin'] as const)(
      'allows a %s of the appointment clinic',
      role => {
        expect(() =>
          assertParticipantOrClinicStaff(appointment(), {
            userId: 'staff-user',
            role,
            clinicId: CLINIC,
          })
        ).not.toThrow();
      }
    );
  });
});

describe('isPatientOwner', () => {
  it('never matches an empty user id', () => {
    expect(isPatientOwner(appointment({ patient: { userId: '' }, userId: '' }), '')).toBe(false);
  });
});

describe('isProviderUnavailableError', () => {
  it('recognises aborted and timed-out requests', () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';

    expect(isProviderUnavailableError(abort)).toBe(true);
    expect(isProviderUnavailableError(timeout)).toBe(true);
  });

  it('recognises network failures reported by undici', () => {
    const fetchFailed = new TypeError('fetch failed');
    const refused = Object.assign(new Error('connect failed'), {
      cause: { code: 'ECONNREFUSED' },
    });

    expect(isProviderUnavailableError(fetchFailed)).toBe(true);
    expect(isProviderUnavailableError(refused)).toBe(true);
  });

  it('recognises provider 429 and 5xx responses but not 4xx', () => {
    expect(isProviderUnavailableError(new Error('Daily room lookup failed with status 503'))).toBe(
      true
    );
    expect(
      isProviderUnavailableError(new Error('Cloudflare meeting create failed with status 429'))
    ).toBe(true);
    expect(isProviderUnavailableError(new Error('Daily room create failed with status 401'))).toBe(
      false
    );
  });

  it('recognises the service unavailable error codes only', () => {
    expect(
      isProviderUnavailableError(
        new HealthcareError(ErrorCode.SERVICE_UNAVAILABLE, 'down', 503, {}, 'ctx')
      )
    ).toBe(true);
    expect(
      isProviderUnavailableError(
        new HealthcareError(ErrorCode.DATABASE_QUERY_FAILED, 'db', 500, {}, 'ctx')
      )
    ).toBe(false);
  });

  it('does not treat arbitrary errors or HTTP exceptions as provider outages', () => {
    expect(isProviderUnavailableError(new Error('Record not found'))).toBe(false);
    expect(isProviderUnavailableError(new TypeError('Cannot read properties of undefined'))).toBe(
      false
    );
    expect(isProviderUnavailableError(new HttpException('bad', 400))).toBe(false);
    expect(isProviderUnavailableError('boom')).toBe(false);
  });

  it('treats a plain 503 or 504 HTTP exception as an outage', () => {
    expect(isProviderUnavailableError(new HttpException('down', 503))).toBe(true);
    expect(isProviderUnavailableError(new HttpException('slow', 504))).toBe(true);
    expect(isProviderUnavailableError(new HttpException('boom', 500))).toBe(false);
  });
});

describe('error text for logs (extractErrorMessage with the video layer fallback)', () => {
  const describeError = (error: unknown): string => extractErrorMessage(error) ?? 'Unknown error';

  it('returns the message of errors, the value of strings and a placeholder otherwise', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    // Plain SDK error objects are now serialised instead of collapsing to the placeholder.
    expect(describeError({ a: 1 })).toBe('{"a":1}');
    expect(describeError(undefined)).toBe('Unknown error');
  });
});

describe('toVideoCallerRole', () => {
  it.each([
    ['PATIENT', 'patient'],
    ['DOCTOR', 'doctor'],
    ['ASSISTANT_DOCTOR', 'doctor'],
    ['THERAPIST', 'doctor'],
    ['COUNSELOR', 'doctor'],
    ['NURSE', 'receptionist'],
    ['RECEPTIONIST', 'receptionist'],
    ['CLINIC_ADMIN', 'clinic_admin'],
    ['SUPER_ADMIN', 'clinic_admin'],
  ])('maps %s to %s', (platformRole, videoRole) => {
    expect(toVideoCallerRole(platformRole)).toBe(videoRole);
  });

  it('is case and whitespace tolerant', () => {
    expect(toVideoCallerRole(' patient ')).toBe('patient');
    expect(toVideoCallerRole('clinic_admin')).toBe('clinic_admin');
  });

  it.each([
    'PHARMACIST',
    'FINANCE_BILLING',
    'LAB_TECHNICIAN',
    'SUPPORT_STAFF',
    'bogus',
    '',
    null,
    undefined,
  ])('gives %p no video role', role => {
    expect(toVideoCallerRole(role)).toBeNull();
  });
});

describe('isClinicAdminRole', () => {
  it('is true for CLINIC_ADMIN only, never for SUPER_ADMIN', () => {
    expect(isClinicAdminRole('CLINIC_ADMIN')).toBe(true);
    expect(isClinicAdminRole('clinic_admin')).toBe(true);
    expect(isClinicAdminRole('SUPER_ADMIN')).toBe(false);
    expect(isClinicAdminRole('DOCTOR')).toBe(false);
    expect(isClinicAdminRole(undefined)).toBe(false);
  });
});

describe('resolveVideoCompletionActor', () => {
  it("lets the appointment's own doctor complete the visit", () => {
    expect(
      resolveVideoCompletionActor(appointment(), {
        userId: 'doctor-user',
        role: 'doctor',
        rawRole: 'DOCTOR',
      })
    ).toBe('doctor');
  });

  it('lets a CLINIC_ADMIN complete the visit', () => {
    expect(
      resolveVideoCompletionActor(appointment(), {
        userId: 'admin-user',
        role: 'clinic_admin',
        rawRole: 'CLINIC_ADMIN',
      })
    ).toBe('clinic_admin');
  });

  it.each([
    ['an assistant doctor', 'assistant-user', 'doctor', 'ASSISTANT_DOCTOR'],
    ['a therapist who is not the appointment doctor', 'other-user', 'doctor', 'THERAPIST'],
    ['a SUPER_ADMIN', 'root-user', 'clinic_admin', 'SUPER_ADMIN'],
    ['a nurse', 'nurse-user', 'receptionist', 'NURSE'],
    ['a receptionist', 'desk-user', 'receptionist', 'RECEPTIONIST'],
    ['the patient', 'patient-user', 'patient', 'PATIENT'],
    ['a clinic_admin with no platform role', 'x-user', 'clinic_admin', undefined],
  ] as const)('refuses %s', (_label, userId, role, rawRole) => {
    expect(resolveVideoCompletionActor(appointment(), { userId, role, rawRole })).toBeNull();
  });
});
