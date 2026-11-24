import { describe, expect, it } from '@jest/globals';
import {
  SLOW_REQUEST_THRESHOLD_MS,
  accessLogSeverity,
  formatAccessLogLine,
  isSlowRequest,
  redactQuery,
  redactUrl,
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

describe('credential redaction in logged URLs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJvcmRlcklkIjoiSU5WLTEifQ.c2lnbmF0dXJl';

  it('masks the payment handoff_token in the access line (was logged verbatim)', () => {
    const line = formatAccessLogLine({
      method: 'POST',
      url: `/api/v1/payments/callback/handoff?handoff_token=${jwt}&status=PAID`,
      statusCode: 200,
      durationMs: 900,
      requestId: 'rid-12345678',
      route: '/api/v1/payments/callback/handoff',
    });
    expect(line).not.toContain(jwt);
    expect(line).toContain('handoff_token=REDACTED&status=PAID');
    expect(line).toContain('SLOW route=/api/v1/payments/callback/handoff');
  });

  it('masks every credential-like parameter and leaves the rest alone', () => {
    expect(
      redactUrl(
        '/x?access_token=a&refresh-token=b&password=c&signature=d&api_key=e&code=f&otp=1&page=2&q=token'
      )
    ).toBe(
      '/x?access_token=REDACTED&refresh-token=REDACTED&password=REDACTED&signature=REDACTED&api_key=REDACTED&code=REDACTED&otp=REDACTED&page=2&q=token'
    );
    expect(redactUrl('/x?handoff%5Ftoken=a')).toBe('/x?handoff%5Ftoken=REDACTED');
    expect(redactUrl('/x?flag&token=a#frag')).toBe('/x?flag&token=REDACTED');
    expect(redactUrl('/api/v1/appointments/42')).toBe('/api/v1/appointments/42');
  });

  it('masks credential values in a parsed query object', () => {
    expect(redactQuery({ handoff_token: jwt, status: 'PAID', limit: '10' })).toEqual({
      handoff_token: 'REDACTED',
      status: 'PAID',
      limit: '10',
    });
  });
});
