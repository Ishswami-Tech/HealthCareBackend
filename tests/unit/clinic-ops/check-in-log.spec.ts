import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });

import { HttpStatus } from '@nestjs/common';
import { HealthcareError, ErrorCode } from '@core/errors';
import {
  REPLACED_QR_MESSAGE,
  classifyCheckInFailure,
} from '@services/clinic-ops/services/check-in-log.service';
import { LocationQrService } from '@utils/QR/location-qr.service';
import { CHECK_IN_WINDOW_BEFORE_MINUTES } from '@services/appointments/core/check-in-presence.util';

describe('classifyCheckInFailure', () => {
  const err = (code: ErrorCode, metadata?: Record<string, unknown>) =>
    new HealthcareError(code, undefined, HttpStatus.BAD_REQUEST, metadata as never);

  it('maps the check-in error codes', () => {
    expect(classifyCheckInFailure(err(ErrorCode.CHECKIN_NO_APPOINTMENT_FOUND)).reason).toBe(
      'NOT_BOOKED'
    );
    expect(classifyCheckInFailure(err(ErrorCode.CHECKIN_ALREADY_CONFIRMED)).reason).toBe(
      'ALREADY_CHECKED_IN'
    );
    expect(classifyCheckInFailure(err(ErrorCode.CHECKIN_WRONG_LOCATION)).reason).toBe(
      'WRONG_LOCATION'
    );
    expect(classifyCheckInFailure(err(ErrorCode.CHECKIN_INVALID_QR_CODE)).reason).toBe(
      'INVALID_QR'
    );
  });

  it('tells too early from too late using the window metadata', () => {
    const early = err(ErrorCode.CHECKIN_TIME_WINDOW_EXPIRED, {
      appointmentTime: '2026-10-20T10:00:00.000Z',
      currentTime: '2026-10-20T08:00:00.000Z',
    });
    const late = err(ErrorCode.CHECKIN_TIME_WINDOW_EXPIRED, {
      appointmentTime: '2026-10-20T10:00:00.000Z',
      currentTime: '2026-10-20T15:00:00.000Z',
    });
    expect(classifyCheckInFailure(early).reason).toBe('TOO_EARLY');
    expect(classifyCheckInFailure(late).reason).toBe('TOO_LATE');
  });

  it('classifies a replaced poster as EXPIRED_QR and unknown errors as OTHER', () => {
    const replaced = new HealthcareError(
      ErrorCode.VALIDATION_REQUIRED_FIELD,
      REPLACED_QR_MESSAGE,
      HttpStatus.BAD_REQUEST,
      { field: 'qrCode' } as never
    );
    expect(classifyCheckInFailure(replaced).reason).toBe('EXPIRED_QR');
    expect(classifyCheckInFailure(new Error('boom')).reason).toBe('OTHER');
  });
});

describe('check-in window', () => {
  it('opens 20 minutes before the appointment', () => {
    expect(CHECK_IN_WINDOW_BEFORE_MINUTES).toBe(20);
  });
});

describe('LocationQrService poster rotation', () => {
  const config = { getEnv: () => 'test-secret' } as never;
  const qr = new LocationQrService(config);

  it('accepts the current poster and rejects a replaced one as REPLACED', () => {
    const v1 = qr.generateLocationQR('loc-1', 'clinic-1', 1);
    expect(qr.inspectLocationQR(v1, 'loc-1', 'clinic-1', 1)).toBe('VALID');
    expect(qr.inspectLocationQR(v1, 'loc-1', 'clinic-1', 2)).toBe('REPLACED');
    const v2 = qr.generateLocationQR('loc-1', 'clinic-1', 2);
    expect(qr.inspectLocationQR(v2, 'loc-1', 'clinic-1', 2)).toBe('VALID');
  });

  it('rejects forged posters and other clinics as INVALID', () => {
    const v1 = qr.generateLocationQR('loc-1', 'clinic-1', 1);
    const forged = JSON.stringify({ ...(JSON.parse(v1) as object), version: 5 });
    expect(qr.inspectLocationQR(forged, 'loc-1', 'clinic-1', 5)).toBe('INVALID');
    expect(qr.inspectLocationQR(v1, 'loc-1', 'clinic-2', 1)).toBe('INVALID');
    expect(qr.verifyLocationQR('not json', 'loc-1', 'clinic-1')).toBe(false);
  });
});
