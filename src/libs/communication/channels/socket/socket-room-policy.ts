/**
 * SOCKET ROOM + PAYLOAD POLICY
 * ============================
 * Pure helpers (no Nest/IO dependencies) deciding:
 *  - which rooms a connected user may join (staff vs patient), and
 *  - which rooms a domain event goes to, with a slim, PHI-free socket payload.
 *
 * Rules:
 *  - Only clinic STAFF join `clinic:<id>` and `clinic:<id>:role:<role>`. Patients never join a
 *    clinic-wide room; they join `user:<id>` plus `clinic:<id>:public`, which only ever carries
 *    catalog events (doctor availability, doctor-clinic links, clinic profile).
 *  - Socket payloads carry ids + status only. No nested appointment/payment/patient objects:
 *    clients refetch over HTTP (which applies RBAC + redaction).
 *  - A patient still receives their OWN updates on `user:<patientUserId>`.
 */
import { Role } from '@core/types/enums.types';
import type { SocketEventData } from '@communication/channels/socket/socket-relay.util';

export interface SocketRoomUser {
  userId: string;
  clinicId?: string | undefined;
  role?: string | undefined;
}

/** Every known role except PATIENT. Unknown or missing roles are NOT staff. */
export const STAFF_ROLES: ReadonlySet<string> = new Set(
  Object.values(Role).filter(role => role !== Role.PATIENT)
);

/** Roles that may see detailed system health (namespace /health). */
export const HEALTH_DETAIL_ROLES: ReadonlySet<string> = new Set([
  Role.SUPER_ADMIN,
  Role.CLINIC_ADMIN,
]);

export function isStaffRole(role: string | undefined | null): boolean {
  return typeof role === 'string' && STAFF_ROLES.has(role.trim().toUpperCase());
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function clinicRoom(clinicId: string): string {
  return `clinic:${clinicId}`;
}

export function clinicPublicRoom(clinicId: string): string {
  return `clinic:${clinicId}:public`;
}

export function clinicRoleRoom(clinicId: string, role: string): string {
  return `clinic:${clinicId}:role:${role}`;
}

/** Rooms a user is auto-joined to on connect, and the only rooms `joinRoom` accepts. */
export function resolveUserRooms(user: SocketRoomUser | undefined | null): string[] {
  if (!user?.userId) {
    return [];
  }
  const rooms = [userRoom(user.userId)];
  if (!user.clinicId) {
    return rooms;
  }
  if (isStaffRole(user.role)) {
    rooms.push(clinicRoom(user.clinicId));
    if (user.role) {
      rooms.push(clinicRoleRoom(user.clinicId, user.role));
    }
  } else {
    rooms.push(clinicPublicRoom(user.clinicId));
  }
  return rooms;
}

export function canJoinRoom(room: string, user: SocketRoomUser | undefined | null): boolean {
  return resolveUserRooms(user).includes(room);
}

// ---------------------------------------------------------------------------
// Event summarising
// ---------------------------------------------------------------------------

export interface SocketEventIds {
  clinicId?: string;
  userId?: string;
  appointmentId?: string;
  patientId?: string;
  /** Routing only: the patient's user id. Never sent to clients. */
  patientUserId?: string;
  doctorId?: string;
  locationId?: string;
  invoiceId?: string;
  paymentId?: string;
  subscriptionId?: string;
  ehrRecordId?: string;
  queueName?: string;
  entryId?: string;
  prescriptionId?: string;
  handoverId?: string;
}

export interface SocketEventSummary {
  ids: SocketEventIds;
  eventId?: string;
  version?: string;
  occurredAt?: string;
  status?: string;
  paymentStatus?: string;
  action?: string;
  position?: number;
  totalInQueue?: number;
  estimatedWaitTime?: number;
}

type PlainRecord = Record<string, unknown>;

const ID_KEYS: ReadonlyArray<Exclude<keyof SocketEventIds, 'patientUserId'>> = [
  'clinicId',
  'userId',
  'appointmentId',
  'patientId',
  'doctorId',
  'locationId',
  'invoiceId',
  'paymentId',
  'subscriptionId',
  'ehrRecordId',
  'queueName',
  'entryId',
  'prescriptionId',
  'handoverId',
];

/** Short opaque identifiers only: anything longer or with spaces is not an id. */
const MAX_ID_LENGTH = 128;

function asRecord(value: unknown): PlainRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainRecord)
    : undefined;
}

function asId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  return text.length > 0 && text.length <= MAX_ID_LENGTH && !/\s/.test(text) ? text : undefined;
}

function asShortText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 && text.length <= 64 ? text : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstDefined<T>(
  sources: ReadonlyArray<PlainRecord | undefined>,
  read: (source: PlainRecord) => T | undefined
): T | undefined {
  for (const source of sources) {
    if (!source) continue;
    const value = read(source);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isEnvelope(record: PlainRecord): boolean {
  return typeof record['eventType'] === 'string' && 'eventId' in record;
}

/**
 * Pull ids/status out of an EventService envelope or a plain payload. Looks at the envelope,
 * its metadata, its `payload`, and the nested appointment/payment/invoice objects so emitters
 * that only put clinicId deep inside the payload still route.
 */
export function summarizeEvent(raw: unknown): SocketEventSummary {
  const root = asRecord(raw) ?? {};
  const envelope = isEnvelope(root) ? root : undefined;
  const payload = envelope ? asRecord(envelope['payload']) : root;
  const metadata = envelope ? asRecord(envelope['metadata']) : undefined;
  const appointment = asRecord(payload?.['appointment']);
  const payment = asRecord(payload?.['payment']);
  const invoice = asRecord(payload?.['invoice']);
  const patient = asRecord(payload?.['patient']) ?? asRecord(appointment?.['patient']);

  const flatSources = [envelope, metadata, payload];
  const ids: SocketEventIds = {};
  for (const key of ID_KEYS) {
    const value = firstDefined([...flatSources, appointment, payment, invoice], source =>
      asId(source[key])
    );
    if (value !== undefined) ids[key] = value;
  }

  // Nested objects carry their own id under `id`.
  const nested: ReadonlyArray<
    ['appointmentId' | 'paymentId' | 'invoiceId', PlainRecord | undefined]
  > = [
    ['appointmentId', appointment],
    ['paymentId', payment],
    ['invoiceId', invoice],
  ];
  for (const [key, source] of nested) {
    const nestedId = source && ids[key] === undefined ? asId(source['id']) : undefined;
    if (nestedId !== undefined) ids[key] = nestedId;
  }

  const patientUserId =
    firstDefined(flatSources, source => asId(source['patientUserId'])) ??
    (patient ? asId(patient['userId']) : undefined);
  if (patientUserId !== undefined) ids.patientUserId = patientUserId;

  const summary: SocketEventSummary = { ids };
  const eventId = envelope ? asId(envelope['eventId']) : undefined;
  if (eventId) summary.eventId = eventId;
  const version = envelope ? asShortText(envelope['version']) : undefined;
  if (version) summary.version = version;
  const occurredAt = envelope ? asShortText(envelope['timestamp']) : undefined;
  if (occurredAt) summary.occurredAt = occurredAt;

  const status =
    firstDefined(flatSources, source => asShortText(source['status'])) ??
    firstDefined(flatSources, source => asShortText(source['nextStatus'])) ??
    (appointment ? asShortText(appointment['status']) : undefined);
  if (status) summary.status = status;
  const paymentStatus =
    firstDefined(flatSources, source => asShortText(source['paymentStatus'])) ??
    (payment ? asShortText(payment['status']) : undefined);
  if (paymentStatus) summary.paymentStatus = paymentStatus;
  const action = firstDefined(flatSources, source => asShortText(source['action']));
  if (action) summary.action = action;

  for (const key of ['position', 'totalInQueue', 'estimatedWaitTime'] as const) {
    const value = firstDefined(flatSources, source => asFiniteNumber(source[key]));
    if (value !== undefined) summary[key] = value;
  }
  return summary;
}

/**
 * The minimal socket payload: event type, ids, status, version/timestamp. Never nested objects,
 * never names/phones/notes/amounts. `patientUserId` is routing-only and is not included.
 */
export function buildSlimSocketPayload(
  event: string,
  summary: SocketEventSummary,
  now: string
): SocketEventData {
  const data: SocketEventData = {
    eventType: event,
    timestamp: summary.occurredAt ?? now,
  };
  if (summary.eventId) data['eventId'] = summary.eventId;
  if (summary.version) data['version'] = summary.version;
  for (const key of ID_KEYS) {
    const value = summary.ids[key];
    if (value !== undefined) data[key] = value;
  }
  if (summary.status) data['status'] = summary.status;
  if (summary.paymentStatus) data['paymentStatus'] = summary.paymentStatus;
  if (summary.action) data['action'] = summary.action;
  if (summary.position !== undefined) data['position'] = summary.position;
  if (summary.totalInQueue !== undefined) data['totalInQueue'] = summary.totalInQueue;
  if (summary.estimatedWaitTime !== undefined) {
    data['estimatedWaitTime'] = summary.estimatedWaitTime;
  }
  return data;
}

/** Catalog events with no patient data: also delivered to the patient-facing public room. */
const PUBLIC_CATALOG_PREFIXES = ['doctor.availability.', 'doctor.clinic.', 'clinic.'];

/** Event families that concern one patient, so the patient's own user room should get them. */
export const PATIENT_SCOPED_PREFIXES = [
  'appointment.',
  'payment.',
  'billing.',
  'invoice.',
  'ehr.',
  'queue.',
  'subscription.',
  // The patient's own prescription at the medicine desk and its counter hand-over.
  'pharmacy.medicine_desk.',
  'pharmacy.handover.',
];

export function isPublicCatalogEvent(event: string): boolean {
  return PUBLIC_CATALOG_PREFIXES.some(prefix => event.startsWith(prefix));
}

export function isPatientScopedEvent(event: string): boolean {
  return PATIENT_SCOPED_PREFIXES.some(prefix => event.startsWith(prefix));
}

/**
 * Target rooms for an event. Emit to all of them in ONE `server.to(rooms)` call so a socket in
 * several of them (e.g. staff in `clinic:x` and `user:y`) receives the event once.
 *
 * `clinic:<id>` only contains staff (see resolveUserRooms), so role rooms are subsets of it and
 * are not targeted separately.
 */
export function determineTargetRooms(event: string, ids: SocketEventIds): string[] {
  const rooms = new Set<string>();

  if (ids.userId) rooms.add(userRoom(ids.userId));
  if (ids.patientUserId && isPatientScopedEvent(event)) rooms.add(userRoom(ids.patientUserId));

  if (ids.clinicId) {
    rooms.add(clinicRoom(ids.clinicId));
    if (isPublicCatalogEvent(event)) rooms.add(clinicPublicRoom(ids.clinicId));
  }

  if (event.startsWith('doctor.availability.') && ids.doctorId) {
    rooms.add(`doctor:${ids.doctorId}`);
    rooms.add(userRoom(ids.doctorId));
  }

  if (ids.appointmentId) rooms.add(`appointment:${ids.appointmentId}`);
  if (ids.subscriptionId) rooms.add(`subscription:${ids.subscriptionId}`);
  if (ids.invoiceId) rooms.add(`invoice:${ids.invoiceId}`);
  if (ids.paymentId) rooms.add(`payment:${ids.paymentId}`);
  if (ids.ehrRecordId) rooms.add(`ehr:${ids.ehrRecordId}`);

  return Array.from(rooms);
}

// ---------------------------------------------------------------------------
// In-app notifications (socket channel)
// ---------------------------------------------------------------------------

/** The one event name every in-app notification is pushed under (the web listens for it). */
export const NOTIFICATION_SOCKET_EVENT = 'notification';

export interface NotificationSocketInput {
  category: string;
  notificationId?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

/**
 * Ids-only payload of an in-app notification push: the category, the inbox row id and the
 * routing ids found in the request data. Never the title, body or free-text data: the client
 * reads the notification itself from the inbox API (RBAC applies there).
 */
export function buildNotificationSocketPayload(
  input: NotificationSocketInput,
  now: string
): SocketEventData {
  const summary = summarizeEvent(input.data ?? {});
  const data = buildSlimSocketPayload(NOTIFICATION_SOCKET_EVENT, summary, now);
  data['type'] = input.category;
  data['category'] = input.category;
  const notificationId = asId(input.notificationId);
  if (notificationId) data['notificationId'] = notificationId;
  return data;
}
