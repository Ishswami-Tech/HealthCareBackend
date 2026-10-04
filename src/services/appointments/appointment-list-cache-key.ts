import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';

/**
 * Cache keys for the appointment list routes (GET /appointments and GET /appointments/my-appointments).
 *
 * The global cache interceptor fills `{placeholders}` from route params, then query params, and
 * only falls back to the JWT for `userId` when no query value exists. A caller could therefore send
 * `?userId=<victim>` and read, or poison, the victim's cached list before the handler's own
 * patient override ever ran, and `{clinicId}` was never resolvable (it arrives in a header), so
 * lists of a user who belongs to two clinics shared one key.
 *
 * These keys are derived from the authenticated caller and the clinic resolved by ClinicGuard
 * only. Query values can only narrow the filters, they can never choose whose list is cached.
 *
 * The same holds for the other cached appointment reads that used `{userId}` / `{id}` templates:
 * /appointments/upcoming, /appointments/user/:userId/upcoming and /appointments/:id. A cache hit
 * is served by the interceptor BEFORE the handler runs, so every check the handler makes (a
 * patient only reads their own, the clinic matches) is skipped on a hit unless the key itself
 * separates callers and clinics.
 */

type ListVariant = 'list' | 'my';

interface ListCacheRequest {
  user?: { sub?: string; id?: string; role?: string };
  clinicContext?: { clinicId?: string };
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

/** Filters each route understands (anything else is ignored, so stray params cannot fragment the cache). */
const FILTER_KEYS: Readonly<Record<ListVariant, readonly string[]>> = {
  list: [
    'userId',
    'doctorId',
    'patientId',
    'type',
    'status',
    'date',
    'dateFrom',
    'dateTo',
    'startDate',
    'endDate',
    'locationId',
    'page',
    'limit',
  ],
  my: ['status', 'date', 'startDate', 'endDate', 'doctorId', 'locationId', 'type', 'page', 'limit'],
};

const PATIENT_ROLE = 'PATIENT';

function readRequest(context: unknown): ListCacheRequest {
  const candidate = context as { switchToHttp?: unknown } | null;
  if (!candidate || typeof candidate.switchToHttp !== 'function') {
    throw new Error('Appointment list cache key requires an HTTP execution context');
  }
  return (context as ExecutionContext).switchToHttp().getRequest<ListCacheRequest>();
}

function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/** Scalars (and arrays of scalars, joined with commas) only; objects and blanks are ignored. */
function normalizeQueryValue(value: unknown): string | undefined {
  const parts = Array.isArray(value) ? value.map(stringifyScalar) : [stringifyScalar(value)];
  const text = parts
    .filter((part): part is string => part !== undefined)
    .join(',')
    .trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Build the cache key for one request. Throws when the caller or the clinic cannot be resolved;
 * the interceptor then serves the request uncached rather than under a shared key.
 */
export function buildAppointmentListCacheKey(context: unknown, variant: ListVariant): string {
  const request = readRequest(context);
  const callerId = request.user?.sub ?? request.user?.id;
  const clinicId = request.clinicContext?.clinicId;
  if (!callerId || !clinicId) {
    throw new Error('Cannot build an appointment list cache key without a caller and a clinic');
  }

  const role = String(request.user?.role ?? '').toUpperCase();
  const query = request.query ?? {};

  const filters: Record<string, string> = {};
  for (const name of FILTER_KEYS[variant]) {
    // A patient is always scoped to themselves; the query userId plays no part in what they get.
    if (name === 'userId' && role === PATIENT_ROLE) {
      continue;
    }
    const value = normalizeQueryValue(query[name]);
    if (value !== undefined) {
      filters[name] = value;
    }
  }

  const filterHash = createHash('sha256')
    .update(JSON.stringify(filters))
    .update('\u0000')
    .update(role)
    .digest('hex')
    .slice(0, 32);

  const handler = variant === 'my' ? 'getMyAppointments' : 'getAppointments';
  return `appointments:${variant}:${callerId}:${clinicId}:${filterHash}:${handler}`;
}

interface CacheIdentity {
  readonly callerId: string;
  readonly clinicId: string;
  readonly role: string;
}

/** Caller and clinic of the request; throws when either is unknown (the request is then uncached). */
function resolveIdentity(request: ListCacheRequest): CacheIdentity {
  const callerId = request.user?.sub ?? request.user?.id;
  const clinicId = request.clinicContext?.clinicId;
  if (!callerId || !clinicId) {
    throw new Error('Cannot build an appointment cache key without a caller and a clinic');
  }
  return { callerId, clinicId, role: String(request.user?.role ?? '').toUpperCase() };
}

function readRouteParam(request: ListCacheRequest, name: string): string {
  const value = request.params?.[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Cannot build an appointment cache key without the ${name} route parameter`);
  }
  return value;
}

/** GET /appointments/upcoming: the caller's own upcoming appointments in this clinic. */
export function buildMyUpcomingCacheKey(context: unknown): string {
  const { callerId, clinicId, role } = resolveIdentity(readRequest(context));
  return `appointments:upcoming:${callerId}:${clinicId}:${role}:getMyUpcomingAppointments`;
}

/**
 * GET /appointments/user/:userId/upcoming: the key names the requested user AND the caller, so a
 * patient asking for someone else's list can never be served an entry another caller created.
 */
export function buildUserUpcomingCacheKey(context: unknown): string {
  const request = readRequest(context);
  const { callerId, clinicId, role } = resolveIdentity(request);
  const targetUserId = readRouteParam(request, 'userId');
  return `appointments:upcoming:${targetUserId}:${clinicId}:${callerId}:${role}:getUserUpcomingAppointments`;
}

/**
 * GET /appointments/:id. Per caller and clinic: the patient-ownership check lives in the handler
 * and is skipped on a hit, so an entry is only ever served back to the caller who passed it.
 */
export function buildAppointmentDetailCacheKey(context: unknown): string {
  const request = readRequest(context);
  const { callerId, clinicId, role } = resolveIdentity(request);
  const appointmentId = readRouteParam(request, 'id');
  return `appointments:detail:${appointmentId}:${clinicId}:${callerId}:${role}:getAppointmentById`;
}

/**
 * Key for a clinic-wide read (analytics) whose result depends on the clinic and the named
 * filters only. The old `{from}:{to}:{locationId}` templates had no clinic and ignored the
 * `doctorId` filter, so one clinic's numbers were served to every other clinic that asked for
 * the same dates. `filterNames` are read from the route params first, then the query.
 */
export function buildClinicScopedCacheKey(
  context: unknown,
  scope: string,
  filterNames: readonly string[]
): string {
  const request = readRequest(context);
  const clinicId = request.clinicContext?.clinicId;
  if (!clinicId) {
    throw new Error('Cannot build a clinic-scoped cache key without a clinic');
  }

  const filters: Record<string, string> = {};
  for (const name of filterNames) {
    const value = normalizeQueryValue(request.params?.[name] ?? request.query?.[name]);
    if (value !== undefined) {
      filters[name] = value;
    }
  }
  const filterHash = createHash('sha256')
    .update(JSON.stringify(filters))
    .digest('hex')
    .slice(0, 32);

  return `${scope}:${clinicId}:${filterHash}`;
}
