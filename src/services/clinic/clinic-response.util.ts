/**
 * Response shaping for clinic payloads.
 *
 * The Clinic row carries tenant infrastructure (the full Postgres DSN in
 * `db_connection_string`, the physical database name and its provisioning
 * status) and the JSON `settings` blob may hold provider credentials. None of
 * that belongs in an HTTP response, whatever the caller's role. Every clinic
 * payload leaving ClinicController is passed through {@link toSafeClinicResponse},
 * which deep-copies the value and drops:
 *  - infrastructure keys (connection string, database name/status/timestamps);
 *  - any key that names a secret (password, secret, api key, token, private
 *    key, credentials, DSN, ...), at any depth;
 *  - any string value that is itself a database/cache connection URL.
 *
 * Location `workingHours` (stored as a JSON string) is returned as the parsed object.
 *
 * Service methods keep returning the raw row (other services read the DSN);
 * only the presentation layer is shaped here.
 */

/** Exact keys (normalised: lower-case, no `_`/`-`) that never leave the API. */
const BLOCKED_KEYS: ReadonlySet<string> = new Set([
  'dbconnectionstring',
  'connectionstring',
  'databaseurl',
  'databasename',
  'databasestatus',
  'databasecreatedat',
  'databaselastsync',
  'dsn',
  'password',
  'passwordhash',
  'secret',
  'apikey',
  'apisecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'privatekey',
  'credentials',
  'salt',
  'encryptionkey',
  'signingkey',
  'webhooksecret',
  'clientsecret',
]);

/** Suffixes (normalised) that mark a key as secret-bearing, e.g. `smtpPassword`, `cashfreeSecretKey`. */
const BLOCKED_SUFFIXES: readonly string[] = [
  'password',
  'secret',
  'secretkey',
  'apikey',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'connectionstring',
  'credentials',
];

const CONNECTION_URL_PATTERN =
  /^\s*(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis(s)?|amqps?):\/\//i;

function normaliseKey(key: string): string {
  return key.replace(/[_\-\s]/g, '').toLowerCase();
}

/** True when a key must be removed from a clinic response. */
export function isSensitiveClinicKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (BLOCKED_KEYS.has(normalised)) return true;
  return BLOCKED_SUFFIXES.some(suffix => normalised.endsWith(suffix));
}

/** True when a string value is a database / cache / broker connection URL. */
export function isConnectionUrl(value: string): boolean {
  return CONNECTION_URL_PATTERN.test(value);
}

type JsonLike =
  string | number | boolean | null | undefined | Date | JsonLike[] | { [key: string]: JsonLike };

const MAX_DEPTH = 12;

function isPlainObject(value: object): boolean {
  const proto: object | null = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

function sanitiseValue(value: JsonLike, depth: number): JsonLike {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return isConnectionUrl(value) ? undefined : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (!Array.isArray(value) && !isPlainObject(value)) {
    // Class instances (Prisma Decimal, Buffer, ...) serialise themselves; keep as-is.
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitiseValue(item, depth + 1)).filter(item => item !== undefined);
  }
  const output: { [key: string]: JsonLike } = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveClinicKey(key)) continue;
    const shaped = JSON_STRING_KEYS.has(key) ? parseJsonObjectString(child) : child;
    const cleaned = sanitiseValue(shaped, depth + 1);
    if (cleaned !== undefined) output[key] = cleaned;
  }
  return output;
}

/** Keys stored as a JSON string (e.g. a location's `workingHours`) but returned as an object. */
const JSON_STRING_KEYS: ReadonlySet<string> = new Set(['workingHours']);

/** `'{"start":"09:00"}'` -> `{ start: '09:00' }`; anything that is not a JSON object string is kept. */
function parseJsonObjectString(value: JsonLike): JsonLike {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    const parsed = JSON.parse(trimmed) as JsonLike;
    return parsed !== null && typeof parsed === 'object' ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * Deep-copies a clinic payload (single clinic, array of clinics, or any
 * wrapper object) with infrastructure and secret fields removed. The input is
 * never mutated.
 */
export function toSafeClinicResponse<T>(payload: T): T {
  return sanitiseValue(payload as unknown as JsonLike, 0) as unknown as T;
}
