/**
 * Text of the login alert (`user.logged_in` / `user.otp_logged_in` / `user.google_oauth_logged_in`),
 * pure, no Nest imports.
 *
 * D8 (release E2E): the alert told the user to "change your password immediately", but sign-in
 * is OTP-only and there is no password to change; with no login method it also read "via
 * account". The advice is now to contact the clinic, and the method is named only when known.
 */

export interface LoginAlertInput {
  readonly displayName: string;
  readonly loginMethod?: string | null | undefined;
  readonly loginTime: string;
  readonly isFirstLogin: boolean;
}

export const LOGIN_ALERT_ADVICE = "If this wasn't you, contact the clinic.";

const METHOD_LABELS: Readonly<Record<string, string>> = {
  otp: 'OTP',
  phone_otp: 'OTP',
  sms_otp: 'OTP',
  whatsapp_otp: 'WhatsApp OTP',
  email_otp: 'email OTP',
  google: 'Google',
  google_oauth: 'Google',
};

/** " via OTP" / " via Google" / "" when the method is unknown. */
export function loginMethodPhrase(method: string | null | undefined): string {
  const key = String(method ?? '')
    .trim()
    .toLowerCase();
  if (!key || key === 'account') return '';
  return ` via ${METHOD_LABELS[key] ?? key.replace(/_/g, ' ')}`;
}

export function loginAlertContent(input: LoginAlertInput): { title: string; body: string } {
  const via = loginMethodPhrase(input.loginMethod);
  return input.isFirstLogin
    ? {
        title: `Welcome to ${input.displayName}`,
        body: `Your new account is ready and you signed in to ${input.displayName}${via} at ${input.loginTime}. ${LOGIN_ALERT_ADVICE}`,
      }
    : {
        title: `${input.displayName} Login Alert`,
        body: `You signed in to ${input.displayName}${via} at ${input.loginTime}. ${LOGIN_ALERT_ADVICE}`,
      };
}
