import { describe, expect, it } from '@jest/globals';
import {
  formatRetryWait,
  withRetryWait,
} from '../../../src/libs/security/rate-limit/retry-wait.util';

const NOW = new Date('2026-10-22T10:30:00.000Z'); // 4:00 pm IST

describe('retry wait wording', () => {
  it('names minutes and the IST clock time', () => {
    expect(formatRetryWait(12 * 60, NOW)).toBe('in 12 minutes (at 4:12 pm)');
    expect(formatRetryWait(61, NOW)).toBe('in 2 minutes (at 4:01 pm)');
  });

  it('uses seconds under a minute and never goes below 1', () => {
    expect(formatRetryWait(40, NOW)).toBe('in 40 seconds');
    expect(formatRetryWait(0, NOW)).toBe('in 1 second');
  });

  it('appends the wait to a message', () => {
    expect(withRetryWait('Too many incorrect codes', 300, NOW)).toBe(
      'Too many incorrect codes. You can try again in 5 minutes (at 4:05 pm).'
    );
    expect(withRetryWait('Too many OTP requests.', 30, NOW)).toBe(
      'Too many OTP requests. You can try again in 30 seconds.'
    );
  });
});
