import { describe, expect, it } from '@jest/globals';
import type { IncomingMessage, RequestOptions } from 'http';
import {
  REDACTED_QUERY,
  incomingSpanUrlAttributes,
  outgoingSpanUrlAttributes,
  redisStatementSerializer,
} from '@infrastructure/logging/otel-redaction';

describe('incomingSpanUrlAttributes', () => {
  it('replaces any query string on server spans', () => {
    const request = { url: '/api/v1/patients/search?phone=9876543210&name=Asha' };
    expect(incomingSpanUrlAttributes(request as IncomingMessage)).toEqual({
      'url.query': REDACTED_QUERY,
    });
  });

  it('adds nothing when there is no query string', () => {
    expect(incomingSpanUrlAttributes({ url: '/api/v1/health' } as IncomingMessage)).toEqual({});
    expect(incomingSpanUrlAttributes({} as IncomingMessage)).toEqual({});
  });
});

describe('outgoingSpanUrlAttributes', () => {
  it('rebuilds url.full without the query string', () => {
    const options: RequestOptions = {
      protocol: 'https:',
      hostname: 'graph.facebook.com',
      path: '/v21.0/123/messages?access_token=EAAsecret&to=919876543210',
    };
    expect(outgoingSpanUrlAttributes(options)).toEqual({
      'url.full': 'https://graph.facebook.com/v21.0/123/messages',
    });
  });

  it('keeps a non-default port and falls back to host', () => {
    const options: RequestOptions = {
      protocol: 'http:',
      host: 'api.local',
      port: 8088,
      path: '/x?y=1',
    };
    expect(outgoingSpanUrlAttributes(options)).toEqual({ 'url.full': 'http://api.local:8088/x' });
  });

  it('adds nothing when the path has no query string', () => {
    expect(outgoingSpanUrlAttributes({ hostname: 'a.example', path: '/ok' })).toEqual({});
  });
});

describe('redisStatementSerializer', () => {
  it('keeps only the command name, never keys or values', () => {
    expect(redisStatementSerializer('get', ['healthcare:otp:someone@example.com:v1'])).toBe('get');
    expect(redisStatementSerializer('SET', ['k', '123456', 'EX', 300])).toBe('SET');
  });
});
