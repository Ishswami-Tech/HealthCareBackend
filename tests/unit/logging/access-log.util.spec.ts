import { describe, expect, it } from '@jest/globals';
import {
  SLOW_REQUEST_THRESHOLD_MS,
  accessLogSeverity,
  formatAccessLogLine,
  isSlowRequest,
  resolveRequestId,
  toDurationMs,
} from '@infrastructure/logging/access-log.util';

const generated = (): string => 'generated-id';

describe('resolveRequestId', () => {
  it('reuses a sane incoming x-request-id', () => {
    expect(resolveRequestId('2f1c9a7e-1b2c-4d5e-8f90-123456789abc', generated)).toBe(
      '2f1c9a7e-1b2c-4d5e-8f90-123456789abc'
    );
    expect(resolveRequestId(['trace.abc:123-xyz', 'second'], generated)).toBe('trace.abc:123-xyz');
    expect(resolveRequestId('  padded-request-id  ', generated)).toBe('padded-request-id');
  });

  it('generates a fresh id for missing, short, oversized or forged values', () => {
    expect(resolveRequestId(undefined, generated)).toBe('generated-id');
    expect(resolveRequestId('', generated)).toBe('generated-id');
    expect(resolveRequestId('short', generated)).toBe('generated-id');
    expect(resolveRequestId('a'.repeat(129), generated)).toBe('generated-id');
    expect(resolveRequestId('abc12345\n[ERROR] forged line', generated)).toBe('generated-id');
    expect(resolveRequestId('id with spaces here', generated)).toBe('generated-id');
  });

  it('defaults to a UUID', () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe('accessLogSeverity', () => {
  it('is ERROR for 5xx, WARN for 4xx, WARN for slow 2xx, INFO otherwise', () => {
    expect(accessLogSeverity(500, 10)).toBe('ERROR');
    expect(accessLogSeverity(503, 9000)).toBe('ERROR');
    expect(accessLogSeverity(404, 10)).toBe('WARN');
    expect(accessLogSeverity(429, 10)).toBe('WARN');
    expect(accessLogSeverity(200, SLOW_REQUEST_THRESHOLD_MS)).toBe('INFO');
    expect(accessLogSeverity(200, SLOW_REQUEST_THRESHOLD_MS + 1)).toBe('WARN');
    expect(accessLogSeverity(201, 12)).toBe('INFO');
  });

  it('honours a custom threshold', () => {
    expect(isSlowRequest(150, 100)).toBe(true);
    expect(isSlowRequest(50, 100)).toBe(false);
    expect(accessLogSeverity(200, 150, 100)).toBe('WARN');
  });
});

describe('toDurationMs', () => {
  it('rounds and never goes negative', () => {
    expect(toDurationMs(1000, 1042.6)).toBe(43);
    expect(toDurationMs(1000, 900)).toBe(0);
  });
});

describe('formatAccessLogLine', () => {
  it('prints status, duration and request id', () => {
    expect(
      formatAccessLogLine({
        method: 'GET',
        url: '/api/v1/user/profile',
        statusCode: 200,
        durationMs: 42,
        requestId: 'rid-12345678',
      })
    ).toBe('GET /api/v1/user/profile [200] 42ms rid=rid-12345678');
  });

  it('marks slow requests with the matched route (or the path without query)', () => {
    expect(
      formatAccessLogLine({
        method: 'GET',
        url: '/api/v1/appointments/abc?x=1',
        statusCode: 200,
        durationMs: 812,
        requestId: 'rid-12345678',
        route: '/api/v1/appointments/:id',
      })
    ).toBe(
      'GET /api/v1/appointments/abc?x=1 [200] 812ms rid=rid-12345678 SLOW route=/api/v1/appointments/:id'
    );
    expect(
      formatAccessLogLine({
        method: 'GET',
        url: '/api/v1/queue?clinicId=c',
        statusCode: 200,
        durationMs: 900,
        requestId: 'rid-12345678',
      })
    ).toContain('SLOW route=/api/v1/queue');
  });
});
