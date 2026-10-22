/**
 * Whether an account has a usable password (OTP / social sign-ups have none). Only this boolean
 * ever leaves the server; the hash itself is never serialised.
 */
export function hasPasswordSet(password: string | null | undefined): boolean {
  return typeof password === 'string' && password.trim().length > 0;
}

/**
 * Whether the account holder has a password they actually chose. A PATIENT account can carry a
 * random hash nobody knows (desk registration's temporary password, Google sign-up), which made
 * "Change password" show for OTP-only patients; for patients the password counts only once it
 * was set by them (self registration, change or reset stamp `passwordChangedAt`). Staff keep the
 * plain "a hash is stored" rule.
 */
export function hasUsablePassword(user: {
  readonly password?: string | null | undefined;
  readonly passwordChangedAt?: Date | string | null | undefined;
  readonly role?: string | null | undefined;
}): boolean {
  if (!hasPasswordSet(user.password)) return false;
  if (String(user.role ?? '').toUpperCase() !== 'PATIENT') return true;
  return user.passwordChangedAt !== null && user.passwordChangedAt !== undefined;
}
