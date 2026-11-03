/**
 * Clinic-day audit mapping (pure, no Nest imports so it can be unit tested in isolation).
 *
 * Turns the domain events a clinic day emits (check-in, consultation start / completion, payment
 * collection, EHR prescription) into one ClinicAuditEvent row each: who did it (actor + role),
 * which clinic, which entity, which action. Only ids and short enum-like values are copied into
 * `detail`; free text (diagnosis, notes, reasons, names, phones) never reaches the audit trail.
 */

export interface ClinicDayAuditIntent {
  readonly clinicId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  /** null when the transition was made by the system (cron, webhook) or the actor is unknown. */
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly detail: Readonly<Record<string, string | number | boolean>>;
}

interface AuditRule {
  readonly action: string;
  readonly entityType: string;
  /** Keys holding the entity id, first match wins (payload, then metadata, then envelope). */
  readonly idKeys: readonly string[];
  /** Payload keys holding the acting user, first match wins. */
  readonly actorKeys: readonly string[];
  /** When no actor key matched: also trust the envelope's userId (only where it IS the actor). */
  readonly envelopeUserIsActor: boolean;
  /** Payload keys copied into `detail` when they hold an id / enum-like value. */
  readonly detailKeys: readonly string[];
}

/** The events this audit listens to. Keys are event names emitted through EventService. */
export const CLINIC_DAY_AUDIT_RULES: Readonly<Record<string, AuditRule>> = {
  'appointment.checked_in': {
    action: 'CHECK_IN',
    entityType: 'APPOINTMENT',
    idKeys: ['appointmentId', 'id'],
    actorKeys: ['checkedInBy', 'confirmedBy'],
    envelopeUserIsActor: false,
    detailKeys: ['checkInMethod', 'locationId', 'doctorId', 'source'],
  },
  'appointment.consultation_started': {
    action: 'CONSULTATION_STARTED',
    entityType: 'APPOINTMENT',
    idKeys: ['appointmentId', 'id'],
    actorKeys: ['startedBy'],
    // AppointmentsService puts the starting user on the envelope; the queue routes put it on
    // payload.userId (handled below as the last fallback for this event only).
    envelopeUserIsActor: true,
    detailKeys: ['doctorId', 'status', 'source'],
  },
  'appointment.completed': {
    action: 'CONSULTATION_COMPLETED',
    entityType: 'APPOINTMENT',
    idKeys: ['appointmentId', 'id'],
    // The envelope userId of this event is the PATIENT (notification routing): never the actor.
    actorKeys: ['completedBy'],
    envelopeUserIsActor: false,
    detailKeys: ['doctorId', 'status', 'videoConsultationId'],
  },
  'payment.completed': {
    action: 'PAYMENT_COLLECTED',
    entityType: 'PAYMENT',
    idKeys: ['paymentId'],
    // The envelope userId is the payer; the collecting staff member is not on this event.
    actorKeys: ['collectedBy', 'actorUserId'],
    envelopeUserIsActor: false,
    detailKeys: ['appointmentId', 'invoiceId', 'subscriptionId', 'status', 'method', 'amount'],
  },
  'ehr.prescription.created': {
    action: 'PRESCRIPTION_CREATED',
    entityType: 'PRESCRIPTION',
    idKeys: ['prescriptionId'],
    // payload.userId is the patient's user id here: only the explicit prescriber key counts.
    actorKeys: ['prescribedByUserId'],
    envelopeUserIsActor: false,
    detailKeys: ['doctorId', 'medicationsCount'],
  },
};

export const CLINIC_DAY_AUDIT_EVENT_NAMES: readonly string[] = Object.keys(CLINIC_DAY_AUDIT_RULES);

/** Ids, enum values and short codes: letters, digits and `._:-`, at most 64 chars. */
const SAFE_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;
/** Role keys (on the payload) that name the actor's role, first match wins. */
const ROLE_KEYS = ['actorRole', 'role', 'userRole'] as const;

type PlainRecord = Record<string, unknown>;

function asRecord(value: unknown): PlainRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainRecord)
    : null;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && SAFE_VALUE.test(value) ? value : null;
}

function firstString(
  sources: ReadonlyArray<PlainRecord | null>,
  keys: readonly string[]
): string | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = safeString(source[key]);
      if (value) return value;
    }
  }
  return null;
}

/** 'system' / 'SYSTEM' style placeholders are the system acting, not a user id. */
function normalizeActor(value: string | null): string | null {
  if (!value) return null;
  return ['system', 'desk', 'cron', 'unknown'].includes(value.toLowerCase()) ? null : value;
}

function pickDetail(
  sources: ReadonlyArray<PlainRecord | null>,
  keys: readonly string[]
): Record<string, string | number | boolean> {
  const detail: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    for (const source of sources) {
      const value = source?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        detail[key] = value;
        break;
      }
      if (typeof value === 'boolean') {
        detail[key] = value;
        break;
      }
      const text = safeString(value);
      if (text) {
        detail[key] = text;
        break;
      }
    }
  }
  return detail;
}

/**
 * The audit row for one emitted event, or null when the event is not audited or lacks the clinic
 * or entity id (a row without them could never be found again).
 *
 * `envelope` is what EventService hands to listeners: `{ clinicId, userId, metadata, payload }`
 * for enterprise emits, and the same shape wrapping the original object for simple emits.
 */
export function resolveClinicDayAudit(
  eventName: string,
  envelope: unknown
): ClinicDayAuditIntent | null {
  const rule = CLINIC_DAY_AUDIT_RULES[eventName];
  const root = asRecord(envelope);
  if (!rule || !root) return null;

  const payload = asRecord(root['payload']);
  const metadata = asRecord(root['metadata']);
  const payloadAppointment = asRecord(payload?.['appointment']);
  const sources = [payload, metadata, root];

  const entityId = firstString(sources, rule.idKeys);
  const clinicId = firstString([payload, root, metadata, payloadAppointment], ['clinicId']);
  if (!entityId || !clinicId) return null;

  let actorUserId = normalizeActor(firstString([payload, metadata], rule.actorKeys));
  if (!actorUserId && rule.envelopeUserIsActor) {
    actorUserId =
      normalizeActor(safeString(root['userId'])) ?? normalizeActor(safeString(payload?.['userId']));
  }
  const actorRole = actorUserId ? firstString([payload, metadata], ROLE_KEYS) : 'SYSTEM';

  const detail = pickDetail([payload, metadata, payloadAppointment], rule.detailKeys);
  const eventId = safeString(root['eventId']);

  return {
    clinicId,
    entityType: rule.entityType,
    entityId,
    action: rule.action,
    actorUserId,
    actorRole: actorRole ? actorRole.toUpperCase() : null,
    detail: { ...detail, ...(eventId ? { eventId } : {}), event: eventName },
  };
}

/**
 * Remembers keys for `ttlMs` so the same transition announced twice (several events are emitted
 * once as an enterprise envelope and once through the simple API) is audited once.
 * `firstSeen(key)` is true the first time a key is seen inside the window.
 */
export interface RecentKeyGuard {
  firstSeen(key: string, nowMs?: number): boolean;
  readonly size: number;
}

export function createRecentKeyGuard(ttlMs: number, maxKeys: number): RecentKeyGuard {
  const seen = new Map<string, number>();
  const prune = (nowMs: number): void => {
    for (const [key, at] of seen) {
      if (nowMs - at < ttlMs && seen.size <= maxKeys) break;
      seen.delete(key);
    }
  };
  return {
    firstSeen(key: string, nowMs: number = Date.now()): boolean {
      prune(nowMs);
      const at = seen.get(key);
      if (at !== undefined && nowMs - at < ttlMs) return false;
      seen.delete(key);
      seen.set(key, nowMs);
      return true;
    },
    get size(): number {
      return seen.size;
    },
  };
}

/** Dedupe key of an intent: one row per action on one entity inside the guard window. */
export function clinicDayAuditKey(intent: ClinicDayAuditIntent): string {
  return `${intent.clinicId}:${intent.action}:${intent.entityId}`;
}
