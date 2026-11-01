/**
 * Registering a user whose mobile number already has an account.
 *
 * `users.phone` is unique, so a second account for one number used to surface as a Prisma P2002 →
 * 500 "Write operation failed after 2 attempts" at the reception desk (clinic-day run 2026-10-31:
 * 18 walk-in registrations). The desk needs a 409 with a clear reason and, when the number belongs
 * to a patient this clinic may serve, that patient's id so it can continue with the existing record.
 */
import { authPhoneLookupCandidates } from '@services/auth/core/phone-normalizer.util';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { Role } from '@core/types/enums.types';

/** The account that already holds the phone number, as far as the conflict decision needs it. */
export interface ExistingPhoneOwner {
  userId: string;
  role: string;
  primaryClinicId: string | null;
  patientId: string | null;
  /** Has an identifier (UHID...) or an appointment at the registering clinic. */
  linkedToClinic: boolean;
}

export interface PhoneConflictMetadata {
  reason: 'PHONE_ALREADY_REGISTERED';
  field: 'phone';
  existingRole: string;
  /** True when the desk can continue with the existing patient instead of registering one. */
  canUseExisting: boolean;
  existingUserId?: string;
  existingPatientId?: string;
}

export interface PhoneConflict {
  code: ErrorCode;
  message: string;
  metadata: PhoneConflictMetadata;
}

export const PHONE_REGISTERED_PATIENT_MESSAGE =
  'A patient with this phone number is already registered';
export const PHONE_REGISTERED_OTHER_CLINIC_MESSAGE =
  'A patient with this phone number is already registered with another clinic';
export const PHONE_REGISTERED_STAFF_MESSAGE =
  'This phone number already belongs to another account';

/** Stored roles are plain strings; compare against the enum's value. */
const PATIENT_ROLE: string = Role.PATIENT;
const INDIAN_NATIONAL_MOBILE = /^\+91(\d{10})$/;

/**
 * Every stored form of the same number: `+919876543210` (E.164, what registration writes),
 * `9876543210` (imported registers / seed) and `919876543210`.
 */
export function phoneConflictLookupCandidates(phone: string | undefined | null): string[] {
  const trimmed = phone?.trim() ?? '';
  if (!trimmed) return [];
  const candidates = authPhoneLookupCandidates(trimmed);
  const national = INDIAN_NATIONAL_MOBILE.exec(candidates[0] ?? '');
  return national?.[1] ? Array.from(new Set([...candidates, `91${national[1]}`])) : candidates;
}

/** A patient the registering clinic may serve: theirs, linked to it, or not tied to any clinic. */
function isUsableHere(owner: ExistingPhoneOwner, clinicId: string): boolean {
  return (
    owner.primaryClinicId === null || owner.primaryClinicId === clinicId || owner.linkedToClinic
  );
}

/** Decide the 409 the caller gets for a number that is already taken. */
export function describePhoneConflict(owner: ExistingPhoneOwner, clinicId: string): PhoneConflict {
  const base = {
    reason: 'PHONE_ALREADY_REGISTERED' as const,
    field: 'phone' as const,
    existingRole: owner.role,
  };
  if (owner.role !== PATIENT_ROLE) {
    return {
      code: ErrorCode.USER_PHONE_ALREADY_EXISTS,
      message: PHONE_REGISTERED_STAFF_MESSAGE,
      metadata: { ...base, canUseExisting: false },
    };
  }
  if (!isUsableHere(owner, clinicId)) {
    return {
      code: ErrorCode.USER_PHONE_ALREADY_EXISTS,
      message: PHONE_REGISTERED_OTHER_CLINIC_MESSAGE,
      metadata: { ...base, canUseExisting: false },
    };
  }
  return {
    code: ErrorCode.USER_PHONE_ALREADY_EXISTS,
    message: PHONE_REGISTERED_PATIENT_MESSAGE,
    metadata: {
      ...base,
      canUseExisting: true,
      existingUserId: owner.userId,
      ...(owner.patientId ? { existingPatientId: owner.patientId } : {}),
    },
  };
}
