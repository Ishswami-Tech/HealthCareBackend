import { describe, expect, it } from '@jest/globals';
import {
  REDACTED,
  maskEmail,
  maskPhone,
  redactLogMetadata,
  redactText,
} from '../../../src/libs/infrastructure/logging/log-redaction.util';

describe('log redaction', () => {
  describe('maskPhone', () => {
    it('keeps the country code and the last 4 digits', () => {
      expect(maskPhone('+919876543210')).toBe('+91******3210');
      expect(maskPhone('+91 98765 43210')).toBe('+91******3210');
    });

    it('masks a national number without a country code', () => {
      expect(maskPhone('9876543210')).toBe('******3210');
    });

    it('fully redacts something too short to be a phone', () => {
      expect(maskPhone('12345')).toBe(REDACTED);
    });
  });

  describe('maskEmail', () => {
    it('keeps the first character and the domain', () => {
      expect(maskEmail('asha.k@clinic.in')).toBe('a***@clinic.in');
    });
  });

  describe('redactText', () => {
    it('masks phones and emails inside free text', () => {
      expect(redactText('OTP sent to +919876543210 and asha@x.com')).toBe(
        'OTP sent to +91******3210 and a***@x.com'
      );
    });

    it('redacts inline secrets', () => {
      expect(redactText('verify otp=123456 token: abc.def')).toBe(
        `verify otp=${REDACTED} token: ${REDACTED}`
      );
    });

    it('leaves UUIDs, ISO timestamps, epoch-ms and latencies alone', () => {
      const text =
        'appointment 3f2b6c1e-8a4d-4b7e-9c2f-1a2b3c4d5e6f at 2026-10-22T09:15:00.000Z ts=1729580000000 took 123ms';
      expect(redactText(text)).toBe(text);
    });
  });

  describe('redactLogMetadata', () => {
    it('redacts secrets by key and masks contact fields, recursively', () => {
      const input = {
        otp: '482913',
        password: 'hunter2',
        authorization: 'Bearer eyJhbGciOi',
        phone: '+919876543210',
        user: { email: 'asha@x.com', refreshToken: 'r-1', note: 'call 9876543210' },
        list: [{ mobile: '9876543210' }],
        latency: 42,
      };

      expect(redactLogMetadata(input)).toEqual({
        otp: REDACTED,
        password: REDACTED,
        authorization: REDACTED,
        phone: '+91******3210',
        user: { email: 'a***@x.com', refreshToken: REDACTED, note: 'call ******3210' },
        list: [{ mobile: '******3210' }],
        latency: 42,
      });
    });

    it('does not mutate the input', () => {
      const input = { otp: '482913', nested: { email: 'asha@x.com' } };
      redactLogMetadata(input);
      expect(input).toEqual({ otp: '482913', nested: { email: 'asha@x.com' } });
    });

    it('survives circular references and keeps empty secret values as-is', () => {
      const input: Record<string, unknown> = { token: '' };
      input['self'] = input;

      const output = redactLogMetadata(input);

      expect(output['token']).toBe('');
      expect(output['self']).toBe('[Circular]');
    });

    it('reduces errors to name + redacted message', () => {
      const output = redactLogMetadata({ error: new Error('no user for asha@x.com') });
      expect(output['error']).toEqual({ name: 'Error', message: 'no user for a***@x.com' });
    });
  });
});
