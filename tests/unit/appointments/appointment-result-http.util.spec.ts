import { describe, expect, it } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  assertAppointmentResultOk,
  assertUnknownAppointmentResultOk,
  httpErrorForFailedResult,
  httpStatusForAppointmentError,
} from '@services/appointments/core/appointment-result-http.util';

function thrown(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('expected a throw');
}

describe('appointment result -> HTTP (M1 booking 201 success:false, M2 cancel 200 refusals)', () => {
  it('a successful result passes through unchanged', () => {
    const ok = { success: true, data: { id: 'a' }, message: 'Appointment created successfully' };
    expect(assertAppointmentResultOk(ok)).toBe(ok);
  });

  it.each([
    ['VALIDATION_ERROR', HttpStatus.BAD_REQUEST],
    ['BUSINESS_RULE_VIOLATION', HttpStatus.BAD_REQUEST],
    ['SCHEDULING_CONFLICT', HttpStatus.CONFLICT],
    ['APPOINTMENT_CONFLICT', HttpStatus.CONFLICT],
    ['CANCELLATION_NOT_ALLOWED', HttpStatus.CONFLICT],
    ['INVALID_STATUS_TRANSITION', HttpStatus.CONFLICT],
    ['APPOINTMENT_NOT_FOUND', HttpStatus.NOT_FOUND],
    ['INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR],
  ])('%s is HTTP %d', (code, status) => {
    expect(httpStatusForAppointmentError(code)).toBe(status);
    const error = thrown(() =>
      assertAppointmentResultOk({ success: false, error: code, message: 'Refused because X' })
    );
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual({ statusCode: status, code, message: 'Refused because X' });
  });

  it('a cancellation refused for its status is a 409 with the core message', () => {
    const error = httpErrorForFailedResult({
      success: false,
      error: 'CANCELLATION_NOT_ALLOWED',
      message: 'Cannot cancel appointment in CONFIRMED status',
    });
    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as { message: string }).message).toBe(
      'Cannot cancel appointment in CONFIRMED status'
    );
  });

  it('an unknown code is the caller request (400) with a default message', () => {
    const error = httpErrorForFailedResult({ success: false });
    expect(error.getStatus()).toBe(400);
    expect((error.getResponse() as { message: string }).message).toBeTruthy();
  });
});

describe('assertUnknownAppointmentResultOk (PATCH /appointments/:id/status)', () => {
  it('passes successes and non-result values through', () => {
    const ok = { success: true, data: { id: 'a' } };
    expect(assertUnknownAppointmentResultOk(ok)).toBe(ok);
    const row = { id: 'a', status: 'CANCELLED' };
    expect(assertUnknownAppointmentResultOk(row)).toBe(row);
    expect(assertUnknownAppointmentResultOk(null)).toBeNull();
    expect(assertUnknownAppointmentResultOk('x')).toBe('x');
  });

  it('a refused cancel of a checked-in visit is a 409 with the inner message', () => {
    const error = thrown(() =>
      assertUnknownAppointmentResultOk({
        success: false,
        error: 'CANCELLATION_NOT_ALLOWED',
        message: 'Cannot cancel appointment in CONFIRMED status',
      })
    );
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toEqual({
      statusCode: HttpStatus.CONFLICT,
      code: 'CANCELLATION_NOT_ALLOWED',
      message: 'Cannot cancel appointment in CONFIRMED status',
    });
  });

  it('a failure without a usable code or message is a 400 with a default message', () => {
    const error = thrown(() => assertUnknownAppointmentResultOk({ success: false, error: 42 }));
    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((error.getResponse() as { message: string }).message).toBeTruthy();
  });
});
