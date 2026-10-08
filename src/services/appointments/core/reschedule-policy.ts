/**
 * Which appointments may be moved to another slot, and what status they carry afterwards.
 *
 * - Video (VIDEO_CALL): only while CONFIRMED (paid, awaiting the call).
 * - In-person (every other type): any status except the ones below. A visit that is over or
 *   under way (consultation in progress) cannot move.
 *
 * The 5-hour video window and the reschedule limit are separate rules in AppointmentsService.
 */

export const VIDEO_APPOINTMENT_TYPE = 'VIDEO_CALL';

/** In-person visits that can never be moved: finished, abandoned, or being consulted right now. */
export const IN_PERSON_NON_RESCHEDULABLE_STATUSES: readonly string[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
  'IN_PROGRESS',
];

/** The only status a video appointment can be rescheduled from. */
export const VIDEO_RESCHEDULABLE_STATUS = 'CONFIRMED';

/** In-person statuses that describe the booking itself and survive a move unchanged. */
const IN_PERSON_STATUSES_KEPT_ON_MOVE: ReadonlySet<string> = new Set([
  'PENDING',
  'SCHEDULED',
  'AWAITING_SLOT_CONFIRMATION',
  'FOLLOW_UP_SCHEDULED',
]);

export const VIDEO_RESCHEDULE_STATUS_MESSAGE =
  'Video appointments can only be rescheduled while they are confirmed.';
export const IN_PERSON_RESCHEDULE_STATUS_MESSAGE =
  'This visit cannot be rescheduled because it is already completed, cancelled, a no-show, expired or in progress.';

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.toUpperCase() : '';

export function isVideoAppointmentType(type: unknown): boolean {
  return normalize(type) === VIDEO_APPOINTMENT_TYPE;
}

/** True when an appointment of this type and status may be moved (before window / limit rules). */
export function isRescheduleStatusAllowed(type: unknown, status: unknown): boolean {
  const current = normalize(status);
  if (isVideoAppointmentType(type)) return current === VIDEO_RESCHEDULABLE_STATUS;
  return !IN_PERSON_NON_RESCHEDULABLE_STATUSES.includes(current);
}

/** The refusal to show when {@link isRescheduleStatusAllowed} is false. */
export function rescheduleStatusRefusal(type: unknown): string {
  return isVideoAppointmentType(type)
    ? VIDEO_RESCHEDULE_STATUS_MESSAGE
    : IN_PERSON_RESCHEDULE_STATUS_MESSAGE;
}

/**
 * The status a moved appointment carries on its new slot. A video visit stays CONFIRMED (the
 * payment stands). An in-person visit keeps a booking-level status; anything that implied
 * arrival (CONFIRMED / checked in / waiting) goes back to SCHEDULED, the pre-arrival state.
 */
export function statusAfterReschedule(type: unknown, status: unknown): string {
  if (isVideoAppointmentType(type)) return VIDEO_RESCHEDULABLE_STATUS;
  const current = normalize(status);
  return IN_PERSON_STATUSES_KEPT_ON_MOVE.has(current) ? current : 'SCHEDULED';
}

/** The status filter of the conditional reschedule write, so a concurrent change is never lost. */
export function rescheduleStatusFilter(type: unknown): { in: string[] } | { notIn: string[] } {
  return isVideoAppointmentType(type)
    ? { in: [VIDEO_RESCHEDULABLE_STATUS] }
    : { notIn: [...IN_PERSON_NON_RESCHEDULABLE_STATUSES] };
}
