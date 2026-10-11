import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';

/**
 * The errors the compliance services raise, as HealthcareError (the repo's error type) with an
 * ErrorCode and the HTTP status the API has always returned for them.
 */
const CONTEXT = 'Compliance';

const build = (code: ErrorCode, message: string, status: HttpStatus): HealthcareError =>
  new HealthcareError(code, message, status, undefined, CONTEXT);

export const complianceErrors = {
  invalid: (message: string): HealthcareError =>
    build(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST),

  patientNotFound: (message: string): HealthcareError =>
    build(ErrorCode.PATIENT_NOT_FOUND, message, HttpStatus.NOT_FOUND),

  forbidden: (message: string): HealthcareError =>
    build(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message, HttpStatus.FORBIDDEN),

  clinicContextRequired: (): HealthcareError =>
    build(ErrorCode.CLINIC_ID_REQUIRED, 'Clinic context required', HttpStatus.FORBIDDEN),

  identifierConflict: (message: string): HealthcareError =>
    build(ErrorCode.PATIENT_IDENTIFIER_CONFLICT, message, HttpStatus.CONFLICT),

  consentConflict: (message: string): HealthcareError =>
    build(ErrorCode.PATIENT_CONSENT_CONFLICT, message, HttpStatus.CONFLICT),

  uhidAllocation: (message: string): HealthcareError =>
    build(ErrorCode.UHID_ALLOCATION_FAILED, message, HttpStatus.CONFLICT),
} as const;

const CONFLICT_STATUS: number = HttpStatus.CONFLICT;

/** True for a HealthcareError that carries HTTP 409 (a conflict the caller may retry). */
export function isConflictError(error: unknown): boolean {
  return error instanceof HealthcareError && error.getStatus() === CONFLICT_STATUS;
}
