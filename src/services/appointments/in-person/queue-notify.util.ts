/**
 * "You're next" / "N ahead of you" patient notifications (worker cron), pure selection rules.
 *
 * A waiting patient is told once per threshold: NEAR when 1 or 2 patients are ahead, NEXT when
 * nobody is. The debounce key is per appointment and threshold, so a patient who jumps from 3
 * ahead straight to next gets only NEXT, and a list rewrite never repeats a message.
 */
import { computeQueuePlaces, queueTokenLabel, type QueueLine } from '@utils/in-person-flow.util';
import { endOfIstDay } from '@utils/clock.util';

export type QueueNotifyThreshold = 'NEXT' | 'NEAR';

/** Most people ahead that still count as "near". */
export const QUEUE_NOTIFY_NEAR_AHEAD = 2;
/** A threshold message is never repeated for the same appointment within this window. */
export const QUEUE_NOTIFY_DEBOUNCE_SECONDS = 24 * 60 * 60;

export interface QueueNotifyEntry extends QueueLine {
  patientId?: string | undefined;
  doctorId?: string | undefined;
  queueOwnerId?: string | undefined;
  locationId?: string | undefined;
}

export interface QueueNotification {
  appointmentId: string;
  patientId: string | null;
  /** Owner of the line (doctor), so a paused doctor's queue can be skipped. */
  doctorId: string | null;
  threshold: QueueNotifyThreshold;
  peopleAhead: number;
  token: string | null;
}

const WAITING: ReadonlySet<string> = new Set(['WAITING', 'CONFIRMED', 'CHECKED_IN']);

export function thresholdFor(peopleAhead: number): QueueNotifyThreshold | null {
  if (peopleAhead === 0) return 'NEXT';
  if (peopleAhead > 0 && peopleAhead <= QUEUE_NOTIFY_NEAR_AHEAD) return 'NEAR';
  return null;
}

export function queueNotifyKey(appointmentId: string, threshold: QueueNotifyThreshold): string {
  return `queue-notify:${appointmentId}:${threshold}`;
}

/** Notifications due for a clinic queue already in serving order (one line per doctor+location). */
export function selectQueueNotifications(
  orderedEntries: readonly QueueNotifyEntry[],
  averageConsultMinutes?: number
): QueueNotification[] {
  const lines = new Map<string, QueueNotifyEntry[]>();
  for (const entry of orderedEntries) {
    const key = `${entry.queueOwnerId || entry.doctorId || ''}|${entry.locationId ?? ''}`;
    lines.set(key, [...(lines.get(key) ?? []), entry]);
  }
  const due: QueueNotification[] = [];
  const seen = new Set<string>();
  for (const line of lines.values()) {
    const places = computeQueuePlaces(line, averageConsultMinutes);
    for (const entry of line) {
      if (seen.has(entry.appointmentId)) continue;
      seen.add(entry.appointmentId);
      if (!WAITING.has(String(entry.status ?? '').toUpperCase())) continue;
      const place = places.get(entry.appointmentId);
      const threshold = place ? thresholdFor(place.peopleAhead) : null;
      if (!place || !threshold) continue;
      due.push({
        appointmentId: entry.appointmentId,
        patientId: entry.patientId ?? null,
        doctorId: entry.queueOwnerId || entry.doctorId || null,
        threshold,
        peopleAhead: place.peopleAhead,
        token: queueTokenLabel(entry),
      });
    }
  }
  return due;
}

/**
 * The patient-facing text of a threshold message. Push text shows on a lock screen: only the
 * token and the doctor's name, never the patient's name or the reason for the visit.
 */
export function queueNotifyMessage(
  notification: Pick<QueueNotification, 'threshold' | 'peopleAhead' | 'token'> &
    Partial<QueueNotification>,
  doctorName?: string | null
): {
  title: string;
  body: string;
} {
  const token = notification.token ? ` (token ${notification.token})` : '';
  if (notification.threshold === 'NEXT') {
    const doctor = doctorName?.trim() || 'The doctor';
    return {
      title: "You're next",
      body: `You're next in the queue${token}. ${doctor} will call you shortly.`,
    };
  }
  const people =
    notification.peopleAhead === 1 ? '1 patient' : `${notification.peopleAhead} patients`;
  return {
    title: 'Almost your turn',
    body: `${people} ahead of you in the queue${token}. Please be near the consultation room.`,
  };
}

// ------------------------------------------------------------------ event-driven alerts

/** The appointment facts that decide whether a due threshold may be sent (one batched read). */
export interface QueueAlertRow {
  id: string;
  status: string;
  type: string;
  /** User.id to notify: the patient's own user, else the booking user (guardian). */
  recipientUserId: string | null;
  doctorName: string | null;
}

/** A threshold message that passed the database checks and can be claimed and emitted. */
export interface QueuePatientAlert extends QueueNotification {
  recipientUserId: string;
  doctorName: string | null;
}

/** The database status of a visit that must never be told "you're next". */
const NOT_ALERTABLE_STATUSES: ReadonlySet<string> = new Set([
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);

/**
 * Due thresholds of the live list, kept only when the database agrees: the visit is in person
 * (a VIDEO_CALL has no room to wait near), still waiting (never cancelled / completed / no-show)
 * and has a user to address. The live list can lag the database by a few seconds.
 */
export function selectAlertableNotifications(
  due: readonly QueueNotification[],
  rows: readonly QueueAlertRow[]
): QueuePatientAlert[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const alerts: QueuePatientAlert[] = [];
  for (const notification of due) {
    const row = byId.get(notification.appointmentId);
    if (!row?.recipientUserId) continue;
    if (String(row.type).toUpperCase() === 'VIDEO_CALL') continue;
    if (NOT_ALERTABLE_STATUSES.has(String(row.status).toUpperCase())) continue;
    alerts.push({
      ...notification,
      recipientUserId: row.recipientUserId,
      doctorName: row.doctorName,
    });
  }
  return alerts;
}

/**
 * Idempotency keys to claim (SET NX) for one message, the first being the message's own key.
 * NEXT also burns NEAR: once "you're next" went out, "2 ahead" would read backwards.
 */
export function queueAlertClaimKeys(
  appointmentId: string,
  threshold: QueueNotifyThreshold
): string[] {
  return threshold === 'NEXT'
    ? [queueNotifyKey(appointmentId, 'NEXT'), queueNotifyKey(appointmentId, 'NEAR')]
    : [queueNotifyKey(appointmentId, 'NEAR')];
}

/** SET NX of the cache (CacheService.acquireLock): true only for the first caller of a key. */
export type AcquireOnce = (key: string, ttlSeconds: number) => Promise<boolean>;

/**
 * Claims one message: true only the first time for this appointment + threshold (any replica,
 * the API or the worker cron). A NEXT claim also takes NEAR, so NEAR never follows NEXT.
 */
export async function claimQueueAlert(
  acquire: AcquireOnce,
  appointmentId: string,
  threshold: QueueNotifyThreshold,
  ttlSeconds: number
): Promise<boolean> {
  const [own, ...also] = queueAlertClaimKeys(appointmentId, threshold);
  if (!own || !(await acquire(own, ttlSeconds))) return false;
  for (const key of also) {
    await acquire(key, ttlSeconds);
  }
  return true;
}

/** Floor of the claim TTL, so a claim made just before midnight still outlives retries. */
export const QUEUE_ALERT_MIN_TTL_SECONDS = 60;

/** Seconds until the end of the IST day of `now` (the live queue is per day), at least a minute. */
export function queueAlertTtlSeconds(now: Date): number {
  const end = endOfIstDay(now);
  if (!end) return QUEUE_NOTIFY_DEBOUNCE_SECONDS;
  const seconds = Math.ceil((end.getTime() - now.getTime()) / 1000);
  return Math.max(QUEUE_ALERT_MIN_TTL_SECONDS, seconds);
}

/** The doctor line an `appointment.queue.updated` envelope is about (null: not an in-person line). */
export interface QueueUpdatedEnvelope {
  clinicId?: string;
  payload?: {
    clinicId?: string;
    doctorId?: string;
    queueOwnerId?: string;
    domain?: string;
    action?: string;
    date?: string;
  };
}

export const IN_PERSON_QUEUE_DOMAIN = 'clinic';
/** Queue actions that move nobody closer to the doctor. */
const NON_ADVANCING_ACTIONS: ReadonlySet<string> = new Set(['PAUSED']);

export function queueLineOfEvent(
  event: QueueUpdatedEnvelope | null | undefined,
  today: string
): { clinicId: string; ownerId: string } | null {
  const payload = event?.payload;
  const clinicId = payload?.clinicId || event?.clinicId || '';
  const ownerId = payload?.queueOwnerId || payload?.doctorId || '';
  if (!clinicId || !ownerId) return null;
  if ((payload?.domain || IN_PERSON_QUEUE_DOMAIN) !== IN_PERSON_QUEUE_DOMAIN) return null;
  if (NON_ADVANCING_ACTIONS.has(String(payload?.action ?? '').toUpperCase())) return null;
  if (payload?.date && payload.date !== today) return null;
  return { clinicId, ownerId };
}

/** The doctor's live queue at a glance: who is with the doctor and who is next (B11). */
export interface DoctorQueueGlance {
  /** Same source and order as GET /queue?doctorId= (the live queue, serving order). */
  source: 'operational-queue';
  inProgressAppointmentId: string | null;
  nextAppointmentId: string | null;
  nextToken: string | null;
  nextPatientId: string | null;
  waiting: number;
}

const TERMINAL: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED']);

/** From the doctor's live queue in serving order (first in-progress, first waiting). */
export function glanceDoctorQueue(orderedEntries: readonly QueueNotifyEntry[]): DoctorQueueGlance {
  const live = orderedEntries.filter(
    entry => !TERMINAL.has(String(entry.status ?? '').toUpperCase())
  );
  const inProgress = live.find(entry => String(entry.status ?? '').toUpperCase() === 'IN_PROGRESS');
  const waiting = live.filter(entry => WAITING.has(String(entry.status ?? '').toUpperCase()));
  const next = waiting[0];
  return {
    source: 'operational-queue',
    inProgressAppointmentId: inProgress?.appointmentId ?? null,
    nextAppointmentId: next?.appointmentId ?? null,
    nextToken: next ? queueTokenLabel(next) : null,
    nextPatientId: next?.patientId ?? null,
    waiting: waiting.length,
  };
}
