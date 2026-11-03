/**
 * Last-line-of-defence response sanitizer: strips credential/secret-shaped keys and
 * connection-URL-shaped string values from ANY outgoing HTTP response, at any depth.
 *
 * Five independent incidents in one day (see
 * project_healthcarebackend_db_connection_string_leak.md) found a raw Prisma `include` (no
 * `select`) on `User` or `Clinic` leaking a password hash, OAuth ids, or `db_connection_string` to
 * an authenticated caller — each fixed one controller at a time with its own `select` allowlist or
 * a per-controller redaction call. This util/interceptor is the global backstop the memory
 * recommended after round 5: it doesn't replace those fixes (a `select` allowlist is still the
 * right fix at the source), it catches the NEXT one before it ships.
 *
 * Reuses `isConnectionUrl` from clinic-response.util.ts for the connection-string check, but keeps
 * its OWN, deliberately narrower key deny-list (see GLOBAL_BLOCKED_KEYS below) rather than reusing
 * `isSensitiveClinicKey` wholesale — that one also blocks `token`/`accessToken`/`refreshToken`,
 * which is correct for a Clinic settings blob but would strip every login response's own tokens
 * if applied globally.
 */
import { isConnectionUrl } from '@services/clinic/clinic-response.util';

type JsonLike = unknown;

/**
 * Deliberately narrower than `isSensitiveClinicKey` (which also blocks `token`/`accessToken`/
 * `refreshToken`/`authToken` — correct for a Clinic settings blob, WRONG as a global response
 * rule: those are legitimate, intended top-level fields on every auth response, and stripping
 * them globally breaks login entirely. This only targets the three concrete things the five
 * documented incidents actually leaked: password hashes, OAuth provider ids, and the tenant DB
 * connection string/infra fields — never a field an endpoint is meant to return to its caller.
 */
const GLOBAL_BLOCKED_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwordhash',
  'googleid',
  'facebookid',
  'appleid',
  'dbconnectionstring',
  'connectionstring',
  'databaseurl',
  'databasename',
  'databasestatus',
  'databasecreatedat',
  'databaselastsync',
  'dsn',
]);

function normaliseKey(key: string): string {
  return key.replace(/[_\-\s]/g, '').toLowerCase();
}

function isGloballyBlockedKey(key: string): boolean {
  return GLOBAL_BLOCKED_KEYS.has(normaliseKey(key));
}

const MAX_DEPTH = 15;

function isPlainObject(value: object): boolean {
  const proto: object | null = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

function stripCredentialShapedValues(value: JsonLike, depth: number): JsonLike {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return isConnectionUrl(value) ? '[redacted]' : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map(item => stripCredentialShapedValues(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    // Class instances (Prisma Decimal, Buffer, streams, ...) are left as-is: walking their own
    // properties would break serialization, and they are never the source of this leak class.
    return value;
  }
  const output: Record<string, JsonLike> = {};
  for (const [key, child] of Object.entries(value as Record<string, JsonLike>)) {
    if (isGloballyBlockedKey(key)) continue;
    output[key] = stripCredentialShapedValues(child, depth + 1);
  }
  return output;
}

/** Deep-copies `payload`, dropping any secret-shaped key or connection-URL-shaped value. */
export function stripLeakedCredentials<T>(payload: T): T {
  if (payload === null || payload === undefined || typeof payload !== 'object') return payload;
  // Controllers routinely wrap the real response in a DTO class instance (e.g. `new
  // SuccessResponseDto(...)`), not a plain object literal — `stripCredentialShapedValues`'s
  // "leave class instances alone" rule exists to protect nested Buffer/Decimal-like values, but
  // applying it to the OUTERMOST wrapper would skip sanitizing the whole response. Walk the
  // top-level object's own enumerable keys regardless of its prototype; nested values still go
  // through the normal (prototype-aware) recursive walk.
  if (Array.isArray(payload)) return stripCredentialShapedValues(payload, 0) as T;
  const output: Record<string, JsonLike> = {};
  for (const [key, child] of Object.entries(payload as Record<string, JsonLike>)) {
    if (isGloballyBlockedKey(key)) continue;
    output[key] = stripCredentialShapedValues(child, 1);
  }
  return output as T;
}
