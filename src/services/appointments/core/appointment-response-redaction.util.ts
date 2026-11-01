/**
 * What an appointment response may carry about the people on it.
 *
 * Appointment reads used to `include: { user: true }` on the patient and the doctor, so
 * GET /appointments/:id and the POST /appointments answer handed the doctor's bcrypt hash (and the
 * caller's own) to a patient. Two layers close that:
 *   - the queries select only `SAFE_APPOINTMENT_USER_SELECT` (and `toSafeAppointmentUsers` trims
 *     rows that come from shared database methods with full user rows), and
 *   - every appointment / in-person HTTP answer passes `redactAppointmentResponse`, which drops
 *     credential keys at any depth for every role, and the clinical keys for the reception desk
 *     (contract 18.8: reception never reads clinical data).
 *
 * GET /appointments/:id's fallback read (`clinic: true`) embeds the full Clinic row, not just the
 * safe columns the list endpoint selects — `redactAppointmentResponse` also drops the same
 * infrastructure/secret keys `toSafeClinicResponse` (clinic-response.util.ts) blocks, so the
 * clinic's db_connection_string etc. never leaves this controller either, whichever read path
 * answered. That clinic blocklist (it includes a bare `token` key for provider credentials) is
 * applied only inside the embedded clinic and settings subtrees: applied to the whole answer it
 * removed the queue display token ("K-014") of every appointment and visit.
 * Pure helpers: no Nest imports, so the spec runs without the framework.
 */
import { stripKeysDeep, type ScopedKeyBlock } from '@core/interceptors/billing-redaction.util';
import { isClinicalBlindRole, isClinicalKey } from '@core/interceptors/clinical-redaction.util';
import { isSensitiveClinicKey } from '@services/clinic/clinic-response.util';

/** The only user columns an appointment read selects for the patient / doctor. */
export const SAFE_APPOINTMENT_USER_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  profilePicture: true,
} as const;

export type SafeAppointmentUserKey = keyof typeof SAFE_APPOINTMENT_USER_SELECT;

/** `include` for an appointment read with its patient and doctor (safe user columns only). */
export const SAFE_APPOINTMENT_PEOPLE_INCLUDE = {
  patient: { include: { user: { select: SAFE_APPOINTMENT_USER_SELECT } } },
  doctor: { include: { user: { select: SAFE_APPOINTMENT_USER_SELECT } } },
} as const;

/** Normalised (lower-case, letters and digits only) credential / login-secret keys. */
const CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwordhash',
  'hashedpassword',
  'passwordchangedat',
  'refreshtoken',
  'accesstoken',
  'authtoken',
  'sessiontoken',
  'idtoken',
  'resettoken',
  'resetpasswordtoken',
  'otpsecret',
  'otphash',
  'twofactorsecret',
  'mfasecret',
  'totpsecret',
  'googleid',
  'facebookid',
  'appleid',
  'lastloginip',
  'lastlogindevice',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEYS.has(normalizeKey(key));
}

/** Keys whose value is a clinic row or a settings / configuration object (provider secrets). */
function opensClinicSecretScope(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized === 'clinic' ||
    normalized === 'clinics' ||
    normalized.endsWith('settings') ||
    normalized.endsWith('config') ||
    normalized.endsWith('configuration')
  );
}

/**
 * The clinic's infrastructure/secret keys (db_connection_string, provider token, apiKey, ...)
 * are removed inside the embedded clinic / settings subtrees only.
 */
const CLINIC_SECRET_SCOPE: ScopedKeyBlock = {
  opensScope: opensClinicSecretScope,
  isBlockedInScope: isSensitiveClinicKey,
};

/**
 * Deep copy of `value` without any credential key (every role, every depth) and without the
 * clinic-infrastructure keys inside the embedded clinic / settings subtrees.
 */
export function stripCredentialFields<T>(value: T): T {
  return stripKeysDeep(value, isCredentialKey, CLINIC_SECRET_SCOPE);
}

/**
 * The HTTP answer of an appointment / in-person route for `role`: credentials and clinic
 * infrastructure secrets never, clinical keys not for the reception desk.
 */
export function redactAppointmentResponse<T>(value: T, role: unknown): T {
  if (isClinicalBlindRole(role)) {
    return stripKeysDeep(
      value,
      key => isCredentialKey(key) || isClinicalKey(key),
      CLINIC_SECRET_SCOPE
    );
  }
  return stripCredentialFields(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the safe columns of a user row (null / non-object left as it is). */
export function pickSafeUser(user: unknown): unknown {
  if (!isRecord(user)) return user;
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(SAFE_APPOINTMENT_USER_SELECT) as SafeAppointmentUserKey[]) {
    if (key in user) safe[key] = user[key];
  }
  return safe;
}

function withSafeUser(person: unknown): unknown {
  if (!isRecord(person) || !('user' in person)) return person;
  return { ...person, user: pickSafeUser(person['user']) };
}

/**
 * Copy of an appointment row whose `patient.user`, `doctor.user` and `user` keep only the safe
 * columns. Shallow on purpose: the rest of the row (Dates, Decimals) is returned untouched for
 * internal callers.
 */
export function toSafeAppointmentUsers<T>(appointment: T): T {
  if (!isRecord(appointment)) return appointment;
  const next: Record<string, unknown> = { ...appointment };
  if ('patient' in next) next['patient'] = withSafeUser(next['patient']);
  if ('doctor' in next) next['doctor'] = withSafeUser(next['doctor']);
  if (isRecord(next['user'])) next['user'] = pickSafeUser(next['user']);
  return next as T;
}

/** Every key path in `value` whose key is a credential (test / audit helper). */
export function findCredentialKeyPaths(value: unknown, path = '$', depth = 0): string[] {
  if (depth > 40 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findCredentialKeyPaths(item, `${path}[${index}]`, depth + 1)
    );
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(isCredentialKey(key) ? [`${path}.${key}`] : []),
    ...findCredentialKeyPaths(child, `${path}.${key}`, depth + 1),
  ]);
}
