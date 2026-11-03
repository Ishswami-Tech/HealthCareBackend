import { describe, expect, it } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import {
  alreadyVerifiedError,
  handoverError,
  handoverNotFoundError,
  handoverNotReadyError,
  identityMismatchError,
  noLiveCodeError,
  prescriptionNotFoundError,
} from '@services/clinic-ops/services/handover-errors.util';

const shapeOf = (error: HealthcareError): { code: ErrorCode; status: number; message: string } => ({
  code: error.code,
  status: error.getStatus(),
  message: error.message,
});

describe('handover errors', () => {
  it('carries a specific code, keeps the message and defaults to 400', () => {
    const error = handoverError(
      ErrorCode.PHARMACY_HANDOVER_CODE_NOT_ISSUED,
      'The patient has not generated a hand-over code yet'
    );
    expect(error).toBeInstanceOf(HealthcareError);
    expect(shapeOf(error)).toEqual({
      code: ErrorCode.PHARMACY_HANDOVER_CODE_NOT_ISSUED,
      status: HttpStatus.BAD_REQUEST,
      message: 'The patient has not generated a hand-over code yet',
    });
  });

  it('keeps the 403 / 404 / 409 statuses of the old Nest exceptions', () => {
    expect(
      handoverError(ErrorCode.PHARMACY_HANDOVER_FORBIDDEN, 'no', HttpStatus.FORBIDDEN).getStatus()
    ).toBe(403);
    expect(shapeOf(prescriptionNotFoundError())).toEqual({
      code: ErrorCode.PHARMACY_PRESCRIPTION_NOT_FOUND,
      status: 404,
      message: 'Prescription not found',
    });
    expect(shapeOf(handoverNotFoundError())).toEqual({
      code: ErrorCode.PHARMACY_HANDOVER_NOT_FOUND,
      status: 404,
      message: 'Hand-over not found',
    });
    expect(shapeOf(handoverNotReadyError('Collect the payment first'))).toEqual({
      code: ErrorCode.PHARMACY_HANDOVER_NOT_READY,
      status: 409,
      message: 'Collect the payment first',
    });
  });

  it('tells a locked code from an expired one', () => {
    expect(shapeOf(noLiveCodeError(1))).toEqual({
      code: ErrorCode.PHARMACY_HANDOVER_CODE_LOCKED,
      status: 400,
      message: 'Too many wrong codes - ask the patient to generate a new code',
    });
    expect(shapeOf(noLiveCodeError(0))).toEqual({
      code: ErrorCode.PHARMACY_HANDOVER_CODE_EXPIRED,
      status: 400,
      message: 'The code has expired - ask the patient to generate a new one',
    });
  });

  it('names the identity check that failed', () => {
    expect(identityMismatchError('PHONE_LAST4').message).toBe(
      "Those digits do not match the patient's phone number"
    );
    expect(identityMismatchError('UHID').message).toBe(
      "That UHID does not match the patient's record"
    );
    expect(identityMismatchError('UHID').code).toBe(ErrorCode.PHARMACY_HANDOVER_IDENTITY_MISMATCH);
    expect(alreadyVerifiedError().code).toBe(ErrorCode.PHARMACY_HANDOVER_ALREADY_HANDLED);
  });
});
