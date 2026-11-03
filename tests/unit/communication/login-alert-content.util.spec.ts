import { describe, expect, it } from '@jest/globals';
import {
  LOGIN_ALERT_ADVICE,
  loginAlertContent,
  loginMethodPhrase,
} from '../../../src/libs/communication/listeners/login-alert-content.util';

describe('login alert text (D8)', () => {
  it('never mentions a password (sign-in is OTP-only) and points to the clinic', () => {
    for (const isFirstLogin of [true, false]) {
      const { body } = loginAlertContent({
        displayName: 'Ayur Clinic',
        loginMethod: 'otp',
        loginTime: '01:57:12 pm',
        isFirstLogin,
      });
      expect(body.toLowerCase()).not.toContain('password');
      expect(body.endsWith(LOGIN_ALERT_ADVICE)).toBe(true);
    }
  });

  it('reads naturally', () => {
    expect(
      loginAlertContent({
        displayName: 'Healthcare App',
        loginMethod: 'otp',
        loginTime: '01:57:12 pm',
        isFirstLogin: false,
      })
    ).toEqual({
      title: 'Healthcare App Login Alert',
      body: "You signed in to Healthcare App via OTP at 01:57:12 pm. If this wasn't you, contact the clinic.",
    });
  });

  it('names the method only when it is known', () => {
    expect(loginMethodPhrase('google_oauth')).toBe(' via Google');
    expect(loginMethodPhrase('magic_link')).toBe(' via magic link');
    expect(loginMethodPhrase('account')).toBe('');
    expect(loginMethodPhrase(null)).toBe('');
    expect(loginMethodPhrase('  ')).toBe('');
  });
});
