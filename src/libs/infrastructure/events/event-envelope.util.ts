/**
 * Pure helpers for EventService envelopes and emission throttling.
 * No Nest imports so they can be unit tested in isolation.
 */

/**
 * Event families that drive money or appointment state. They must never be dropped by the
 * emission rate limiter or the circuit breaker: a dropped `payment.completed` or
 * `appointment.checked_in` leaves screens (and downstream listeners) permanently stale.
 */
const CRITICAL_EVENT_PREFIXES = ['billing.', 'payment.', 'invoice.', 'appointment.'];

export function isCriticalDomainEvent(eventType: string | undefined | null): boolean {
  return (
    typeof eventType === 'string' &&
    CRITICAL_EVENT_PREFIXES.some(prefix => eventType.startsWith(prefix))
  );
}

/**
 * Rate-limit bucket: per source AND event type. A single shared bucket per source (every
 * `emit()` call uses source 'EventService') let one noisy event type starve all others.
 */
export function resolveEventRateLimitKey(source: string, eventType: string): string {
  return `rate_limit:${source || 'unknown'}:${eventType || 'unknown'}`;
}

export interface LiftedEnvelopeFields {
  clinicId?: string;
  userId?: string;
  metadata?: Record<string, string>;
}

type PlainRecord = Record<string, unknown>;

const MAX_ID_LENGTH = 128;
/** Routing ids copied into `metadata` (the envelope type has no field for them). */
const METADATA_ID_KEYS = ['locationId', 'appointmentId', 'patientId', 'doctorId'] as const;

function asRecord(value: unknown): PlainRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainRecord)
    : undefined;
}

function asId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return text.length > 0 && text.length <= MAX_ID_LENGTH && !/\s/.test(text) ? text : undefined;
}

function pick(sources: ReadonlyArray<PlainRecord | undefined>, key: string): string | undefined {
  for (const source of sources) {
    const value = source ? asId(source[key]) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * `emit(event, payload)` used to wrap the payload without copying clinicId/userId onto the
 * envelope, so room-based consumers (socket broadcaster, clinic event index) found no clinic and
 * e.g. `appointment.checked_in` never reached staff. Lift them from the payload (or its nested
 * `appointment`), plus routing ids into metadata.
 */
export function liftEnvelopeFields(payload: unknown): LiftedEnvelopeFields {
  const root = asRecord(payload);
  if (!root) return {};
  const appointment = asRecord(root['appointment']);
  const context = asRecord(root['context']);
  const sources = [root, appointment];

  const lifted: LiftedEnvelopeFields = {};
  const clinicId = pick(sources, 'clinicId');
  if (clinicId) lifted.clinicId = clinicId;
  const userId = pick([root, context], 'userId');
  if (userId) lifted.userId = userId;

  const metadata: Record<string, string> = {};
  for (const key of METADATA_ID_KEYS) {
    const value = pick(sources, key);
    if (value) metadata[key] = value;
  }
  if (!metadata['appointmentId'] && appointment) {
    const nestedId = asId(appointment['id']);
    if (nestedId) metadata['appointmentId'] = nestedId;
  }
  if (Object.keys(metadata).length > 0) lifted.metadata = metadata;
  return lifted;
}
