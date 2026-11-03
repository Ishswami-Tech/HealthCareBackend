import { describe, expect, it } from '@jest/globals';
import { LogLevel } from '@core/types/logging.types';
import { httpStatusOf, isClientError, logLevelForError } from '@core/errors/error-severity.util';

/** Duck-typed stand-ins for HttpException / HealthcareError (no Nest import needed). */
const httpError = (status: number): { getStatus: () => number; message: string } => ({
  getStatus: () => status,
  message: `status ${status}`,
});

describe('logLevelForError', () => {
  it('logs expected 4xx refusals at WARN', () => {
    expect(logLevelForError(httpError(400))).toBe(LogLevel.WARN); // too far from clinic
    expect(logLevelForError(httpError(404))).toBe(LogLevel.WARN); // unknown QR code
    expect(logLevelForError(httpError(409))).toBe(LogLevel.WARN); // slot being booked
    expect(logLevelForError(httpError(429))).toBe(LogLevel.WARN); // OTP rate limit
    expect(logLevelForError({ status: 403 })).toBe(LogLevel.WARN);
    expect(logLevelForError({ statusCode: 422 })).toBe(LogLevel.WARN);
  });

  it('keeps server failures and unknown errors at ERROR', () => {
    expect(logLevelForError(httpError(500))).toBe(LogLevel.ERROR);
    expect(logLevelForError(httpError(503))).toBe(LogLevel.ERROR);
    expect(logLevelForError(new Error('db down'))).toBe(LogLevel.ERROR);
    expect(logLevelForError('string failure')).toBe(LogLevel.ERROR);
    expect(logLevelForError(null)).toBe(LogLevel.ERROR);
    expect(logLevelForError({ status: '404' })).toBe(LogLevel.ERROR);
  });
});

describe('httpStatusOf / isClientError', () => {
  it('prefers getStatus(), then status, then statusCode', () => {
    expect(httpStatusOf({ getStatus: () => 409, status: 500 })).toBe(409);
    expect(httpStatusOf({ status: 401, statusCode: 500 })).toBe(401);
    expect(httpStatusOf({ statusCode: 502 })).toBe(502);
    expect(httpStatusOf({})).toBeUndefined();
  });

  it('is a client error only for 400-499', () => {
    expect(isClientError(httpError(399))).toBe(false);
    expect(isClientError(httpError(400))).toBe(true);
    expect(isClientError(httpError(499))).toBe(true);
    expect(isClientError(httpError(500))).toBe(false);
  });
});
