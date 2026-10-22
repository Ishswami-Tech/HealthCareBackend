import { ForbiddenException } from '@nestjs/common';

/**
 * Who controls the course of a visit. Product rule: ONE doctor per clinic; only the DOCTOR calls a
 * patient (`POST /queue/call-next` is `@Roles(DOCTOR)`), starts the consultation and completes the
 * visit. THERAPIST / COUNSELOR run their own sessions: `POST /appointments/:id/complete` allows them
 * (contract section 4), so they may also start (IN_PROGRESS) the visits they are allowed to
 * complete. The assistant doctor, front desk, nurse and clinic admin never do.
 * (`SYSTEM` is the internal scheduler / queue-worker identity, never a login role.)
 */
export const VISIT_CONTROL_ROLES: ReadonlySet<string> = new Set([
  'DOCTOR',
  'THERAPIST',
  'COUNSELOR',
  'SYSTEM',
]);

export const DOCTOR_ONLY_VISIT_MESSAGE =
  'Only the doctor can call a patient, start a consultation or complete a visit.';

/** Queue status values that start / end a consultation and therefore need visit control. */
export const VISIT_CONTROL_QUEUE_STATUSES: ReadonlySet<string> = new Set([
  'IN_PROGRESS',
  'COMPLETED',
]);

function normalizeRole(role: string | null | undefined): string {
  return String(role ?? '')
    .trim()
    .toUpperCase();
}

export function canControlVisit(role: string | null | undefined): boolean {
  return VISIT_CONTROL_ROLES.has(normalizeRole(role));
}

/** Throws 403 unless the caller may call / start / complete a visit. */
export function assertDoctorControlsVisit(role: string | null | undefined): void {
  if (!canControlVisit(role)) {
    throw new ForbiddenException(DOCTOR_ONLY_VISIT_MESSAGE);
  }
}

/** True when moving a queue entry to `status` needs visit control (start / complete). */
export function queueStatusNeedsVisitControl(status: string | null | undefined): boolean {
  return VISIT_CONTROL_QUEUE_STATUSES.has(normalizeRole(status));
}

/**
 * `PATCH /queue/:id/status`: every queue role may confirm, cancel, mark no-show / expired; only
 * visit-control roles may start (IN_PROGRESS) or complete. 403 names the status that was refused.
 */
export function assertQueueStatusAllowed(
  role: string | null | undefined,
  status: string | null | undefined
): void {
  if (!queueStatusNeedsVisitControl(status) || canControlVisit(role)) return;
  throw new ForbiddenException(
    `${DOCTOR_ONLY_VISIT_MESSAGE} Setting the queue status to ${normalizeRole(status)} is reserved ` +
      'for the doctor (or the therapist / counselor for their own sessions); confirm, cancel, ' +
      'no-show and expired stay open to the front desk, nurse and clinic admin.'
  );
}
