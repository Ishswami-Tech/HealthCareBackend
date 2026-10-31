import { describe, expect, it } from '@jest/globals';
import { isDevCorsOriginAllowed } from '../../../src/libs/security/cors-origin.util';

describe('isDevCorsOriginAllowed', () => {
  const allowed = ['https://app.example.in', 'https://www.app.example.in'];

  it('allows requests without an Origin header', () => {
    expect(isDevCorsOriginAllowed(undefined, allowed)).toBe(true);
    expect(isDevCorsOriginAllowed('', allowed)).toBe(true);
  });

  it('allows explicitly configured origins', () => {
    expect(isDevCorsOriginAllowed('https://app.example.in', allowed)).toBe(true);
  });

  it('allows any http://localhost:<port> in development', () => {
    expect(isDevCorsOriginAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(isDevCorsOriginAllowed('http://localhost:8081', allowed)).toBe(true);
  });

  it('refuses other origins (SEC-12 hostile preflight)', () => {
    expect(isDevCorsOriginAllowed('http://evil.local:4000', allowed)).toBe(false);
    expect(isDevCorsOriginAllowed('http://localhost.evil.com:3000', allowed)).toBe(false);
    expect(isDevCorsOriginAllowed('https://localhost:3000', allowed)).toBe(false);
    expect(isDevCorsOriginAllowed('http://localhost:3000.evil.com', allowed)).toBe(false);
    expect(isDevCorsOriginAllowed('https://app.example.in.evil.com', allowed)).toBe(false);
  });
});
