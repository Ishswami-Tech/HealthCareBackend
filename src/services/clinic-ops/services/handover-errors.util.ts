/**
 * Typed errors of the pharmacy counter hand-over (pure, unit-tested).
 *
 * Every refusal carries a specific ErrorCode (instead of a bare Nest HttpException that the
 * exception filter surfaced without a code), keeping the HTTP status and the desk-facing message
 * the counter screens already show.
 */

import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';

const HANDOVER_ERROR_CONTEXT = 'HandoverService';

/** A hand-over refusal: `message` is shown to the desk / patient as-is. */
export function handoverError(
  code: ErrorCode,
  message: string,
  status: HttpStatus = HttpStatus.BAD_REQUEST
): HealthcareError {
  return new HealthcareError(code, message, status, undefined, HANDOVER_ERROR_CONTEXT);
}

/** 404 of a prescription the clinic does not have. */
export function prescriptionNotFoundError(): HealthcareError {
  return handoverError(
    ErrorCode.PHARMACY_PRESCRIPTION_NOT_FOUND,
    'Prescription not found',
    HttpStatus.NOT_FOUND
  );
}

/** 404 of a hand-over row the clinic does not have. */
export function handoverNotFoundError(): HealthcareError {
  return handoverError(
    ErrorCode.PHARMACY_HANDOVER_NOT_FOUND,
    'Hand-over not found',
    HttpStatus.NOT_FOUND
  );
}

/** 409: not approved, paid (or zero-priced) and dispensed - `message` names what is missing. */
export function handoverNotReadyError(message: string): HealthcareError {
  return handoverError(ErrorCode.PHARMACY_HANDOVER_NOT_READY, message, HttpStatus.CONFLICT);
}

/** A prescription the desk verified already: the patient cannot (re)issue a code on it. */
export function alreadyVerifiedError(): HealthcareError {
  return handoverError(
    ErrorCode.PHARMACY_HANDOVER_ALREADY_HANDLED,
    'This hand-over is already verified at the counter'
  );
}

/** Wrong-try limit reached on every live code of the patient. */
export function codeLockedError(): HealthcareError {
  return handoverError(
    ErrorCode.PHARMACY_HANDOVER_CODE_LOCKED,
    'Too many wrong codes - ask the patient to generate a new code'
  );
}

/**
 * No code may be compared: locked when any still-valid code hit the wrong-try limit, else every
 * code expired.
 */
export function noLiveCodeError(lockedCount: number): HealthcareError {
  return lockedCount > 0
    ? codeLockedError()
    : handoverError(
        ErrorCode.PHARMACY_HANDOVER_CODE_EXPIRED,
        'The code has expired - ask the patient to generate a new one'
      );
}

/** The manual identity check failed (phone last-4 or clinic UHID). */
export function identityMismatchError(identityCheck: string): HealthcareError {
  return handoverError(
    ErrorCode.PHARMACY_HANDOVER_IDENTITY_MISMATCH,
    identityCheck === 'PHONE_LAST4'
      ? "Those digits do not match the patient's phone number"
      : "That UHID does not match the patient's record"
  );
}
