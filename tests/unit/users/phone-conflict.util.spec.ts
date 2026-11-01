import { describe, expect, it } from '@jest/globals';
import { ErrorCode } from '../../../src/libs/core/errors/error-codes.enum';
import {
  PHONE_REGISTERED_OTHER_CLINIC_MESSAGE,
  PHONE_REGISTERED_PATIENT_MESSAGE,
  PHONE_REGISTERED_STAFF_MESSAGE,
  describePhoneConflict,
  phoneConflictLookupCandidates,
  type ExistingPhoneOwner,
} from '../../../src/services/users/phone-conflict.util';

const CLINIC = 'clinic-a';

function owner(overrides: Partial<ExistingPhoneOwner> = {}): ExistingPhoneOwner {
  return {
    userId: 'user-1',
    role: 'PATIENT',
    primaryClinicId: CLINIC,
    patientId: 'patient-1',
    linkedToClinic: false,
    ...overrides,
  };
}

describe('phoneConflictLookupCandidates', () => {
  it('covers every stored form of an Indian mobile however it was typed', () => {
    const expected = ['+919000000001', '9000000001', '919000000001'];
    expect(phoneConflictLookupCandidates('9000000001')).toEqual(expected);
    expect(phoneConflictLookupCandidates('+91 90000-00001')).toEqual(expected);
  });

  it('returns nothing for an empty phone', () => {
    expect(phoneConflictLookupCandidates('')).toEqual([]);
    expect(phoneConflictLookupCandidates(undefined)).toEqual([]);
    expect(phoneConflictLookupCandidates('   ')).toEqual([]);
  });
});

describe('describePhoneConflict', () => {
  it('offers the existing patient of the same clinic so the desk can continue the walk-in', () => {
    const conflict = describePhoneConflict(owner(), CLINIC);
    expect(conflict.code).toBe(ErrorCode.USER_PHONE_ALREADY_EXISTS);
    expect(conflict.message).toBe(PHONE_REGISTERED_PATIENT_MESSAGE);
    expect(conflict.metadata).toEqual({
      reason: 'PHONE_ALREADY_REGISTERED',
      field: 'phone',
      existingRole: 'PATIENT',
      canUseExisting: true,
      existingUserId: 'user-1',
      existingPatientId: 'patient-1',
    });
  });

  it('offers a patient of another primary clinic who already visited this one', () => {
    const conflict = describePhoneConflict(
      owner({ primaryClinicId: 'clinic-b', linkedToClinic: true }),
      CLINIC
    );
    expect(conflict.metadata.canUseExisting).toBe(true);
    expect(conflict.metadata.existingUserId).toBe('user-1');
  });

  it('offers a patient not tied to any clinic yet', () => {
    const conflict = describePhoneConflict(owner({ primaryClinicId: null }), CLINIC);
    expect(conflict.metadata.canUseExisting).toBe(true);
  });

  it('does not reveal a patient who belongs only to another clinic', () => {
    const conflict = describePhoneConflict(owner({ primaryClinicId: 'clinic-b' }), CLINIC);
    expect(conflict.message).toBe(PHONE_REGISTERED_OTHER_CLINIC_MESSAGE);
    expect(conflict.metadata.canUseExisting).toBe(false);
    expect(conflict.metadata.existingUserId).toBeUndefined();
  });

  it('does not offer a staff account as a patient', () => {
    const conflict = describePhoneConflict(owner({ role: 'DOCTOR', patientId: null }), CLINIC);
    expect(conflict.message).toBe(PHONE_REGISTERED_STAFF_MESSAGE);
    expect(conflict.metadata.canUseExisting).toBe(false);
    expect(conflict.metadata.existingUserId).toBeUndefined();
  });
});
