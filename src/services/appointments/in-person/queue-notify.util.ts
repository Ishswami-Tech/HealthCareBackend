/**
 * "You're next" / "N ahead of you" patient notifications (worker cron), pure selection rules.
 *
 * A waiting patient is told once per threshold: NEAR when 1 or 2 patients are ahead, NEXT when
 * nobody is. The debounce key is per appointment and threshold, so a patient who jumps from 3
 * ahead straight to next gets only NEXT, and a list rewrite never repeats a message.
 */
import { computeQueuePlaces, queueTokenLabel, type QueueLine } from '@utils/in-person-flow.util';

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
        threshold,
        peopleAhead: place.peopleAhead,
        token: queueTokenLabel(entry),
      });
    }
  }
  return due;
}

/** The patient-facing text of a threshold message. */
export function queueNotifyMessage(notification: QueueNotification): {
  title: string;
  body: string;
} {
  const token = notification.token ? ` (token ${notification.token})` : '';
  if (notification.threshold === 'NEXT') {
    return {
      title: "You're next",
      body: `You're next in the queue${token}. Please be ready near the consultation room.`,
    };
  }
  const people =
    notification.peopleAhead === 1 ? '1 patient' : `${notification.peopleAhead} patients`;
  return {
    title: 'Almost your turn',
    body: `${people} ahead of you in the queue${token}. Please stay close to the clinic.`,
  };
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
