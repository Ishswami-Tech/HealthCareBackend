/**
 * Central PII/secret redaction for log lines (message + metadata), applied by LoggingService
 * before a line reaches stdout, the Dragonfly ring buffer or the DB.
 *
 * - Phone numbers keep their country code and last 4 digits: `+919876543210` -> `+91******3210`.
 * - Emails keep the first character of the local part and the domain: `asha@x.com` -> `a***@x.com`.
 * - Secrets (OTP, password, token, authorization, cookie, api key, ...) are replaced entirely,
 *   matched by metadata KEY name, and inside free text as `otp=123456` / `token: abc` pairs.
 *
 * Pure and dependency-free so it can be unit tested and reused (e.g. by Sentry beforeSend).
 */

export const REDACTED = '[REDACTED]';

/** Keys whose VALUE is always a secret (compared case-insensitively, `_`/`-` ignored). */
const SECRET_KEY_NAMES: ReadonlySet<string> = new Set([
  'otp',
  'otpcode',
  'verificationcode',
  'pin',
  'password',
  'passwd',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'jwt',
  'authorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'privatekey',
  'sessionid',
  'cardnumber',
  'cvv',
]);

/** Keys whose value is a phone number / email even when it does not look like one. */
const PHONE_KEY_NAMES: ReadonlySet<string> = new Set([
  'phone',
  'phonenumber',
  'mobile',
  'mobilenumber',
  'whatsapp',
  'whatsappnumber',
  'contact',
  'to',
]);
const EMAIL_KEY_NAMES: ReadonlySet<string> = new Set(['email', 'emailaddress', 'useremail']);

const EMAIL_PATTERN = /([A-Z0-9._%+-])[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
/**
 * A phone-looking digit run: optional `+` and country code, 10-13 digits overall, allowing
 * single spaces/dashes. Bounded by non-digits so ids, timestamps and UUID parts are not hit
 * (UUID groups are hex runs mixed with letters and dashes, timestamps are 13+ digit runs).
 */
const PHONE_PATTERN = /(?<![\w.-])(\+\d{1,3}[\s-]?)?(\d[\s-]?){9,11}\d(?![\w-])/g;
/** `otp=123456`, `token: abc`, `password":"x"` inside free text. */
const INLINE_SECRET_PATTERN =
  /\b(otp|password|passwd|token|access_token|refresh_token|secret|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)([^\s"',&;]+)/gi;

const MAX_DEPTH = 6;
/** Returned by redactByKey when the key carries no rule (the value is redacted by content). */
const NO_KEY_RULE = Symbol('no-key-rule');

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/** `+919876543210` -> `+91******3210`; `9876543210` -> `******3210`. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return REDACTED;
  const hasCountry = raw.trim().startsWith('+') && digits.length > 10;
  const country = hasCountry ? `+${digits.slice(0, digits.length - 10)}` : '';
  const local = hasCountry ? digits.slice(-10) : digits;
  return `${country}${'*'.repeat(local.length - 4)}${local.slice(-4)}`;
}

/** `asha.k@clinic.in` -> `a***@clinic.in`. */
export function maskEmail(raw: string): string {
  const at = raw.indexOf('@');
  if (at <= 0) return REDACTED;
  return `${raw.charAt(0)}***${raw.slice(at)}`;
}

/** Masks emails, phone numbers and inline `key=secret` pairs inside free text. */
export function redactText(text: string): string {
  return text
    .replace(
      INLINE_SECRET_PATTERN,
      (_m: string, key: string, sep: string) => `${key}${sep}${REDACTED}`
    )
    .replace(EMAIL_PATTERN, (match: string) => maskEmail(match))
    .replace(PHONE_PATTERN, (match: string) => maskPhone(match));
}

function redactByKey(key: string, value: unknown): unknown {
  const normalized = normalizeKey(key);
  if (SECRET_KEY_NAMES.has(normalized)) {
    return value === undefined || value === null || value === '' ? value : REDACTED;
  }
  if (typeof value === 'string') {
    if (PHONE_KEY_NAMES.has(normalized) && /\d{6,}/.test(value.replace(/[\s-]/g, ''))) {
      return maskPhone(value);
    }
    if (EMAIL_KEY_NAMES.has(normalized) && value.includes('@')) return maskEmail(value);
  }
  return NO_KEY_RULE;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  // Buffers/typed arrays (file uploads, binary payloads) are Uint8Array subclasses, not
  // plain objects or Arrays. Without this check, Object.entries() below walks them byte by
  // byte - a multi-MB file becomes a plain object with one property per byte, which is
  // catastrophic for V8 memory (each dictionary-mode property costs ~50-100+ bytes of
  // overhead), causing OOM crashes when any endpoint logs a body containing file bytes.
  if (ArrayBuffer.isView(value)) return `[Binary ${(value as ArrayBufferView).byteLength} bytes]`;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const byKey = redactByKey(key, item);
    output[key] = byKey === NO_KEY_RULE ? redactValue(item, depth + 1, seen) : byKey;
  }
  return output;
}

/** Returns a redacted deep copy of log metadata (the input is never mutated). */
export function redactLogMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  return redactValue(metadata, 0, new WeakSet<object>()) as Record<string, unknown>;
}
