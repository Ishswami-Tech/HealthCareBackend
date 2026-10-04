import { Role } from '@core/types/enums.types';
import { BadRequestException } from '@nestjs/common';

export const APPOINTMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['SCHEDULED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED'],
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED'],
  CONFIRMED: ['IN_PROGRESS', 'NO_SHOW', 'EXPIRED'],
  WAITING: ['IN_PROGRESS', 'NO_SHOW', 'CANCELLED', 'EXPIRED'],
  ON_HOLD: ['SCHEDULED', 'CANCELLED', 'RESCHEDULED'],
  // EXPIRED: a video visit the doctor started but never completed closes when its window ends.
  // Only the SYSTEM scheduler may take that edge (see getGenericStatusChangeRefusal).
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'ON_HOLD', 'EXPIRED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: ['RESCHEDULED'],
  EXPIRED: [],
  RESCHEDULED: ['SCHEDULED', 'CONFIRMED', 'CANCELLED'],
  AWAITING_SLOT_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED'],
  FOLLOW_UP_SCHEDULED: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'],
  DISCHARGED: [],
  TRANSFERRED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED'],
};

export const APPOINTMENT_CANCELABLE_STATUSES = new Set<string>([
  'PENDING',
  'SCHEDULED',
  'RESCHEDULED',
  'WAITING',
  'ON_HOLD',
  'AWAITING_SLOT_CONFIRMATION',
  'FOLLOW_UP_SCHEDULED',
]);

/** Statuses an appointment never leaves: its queue entry, if any, must go. */
export const APPOINTMENT_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED',
]);

/** Role the internal schedulers and plugins act as. It is never a login role. */
export const APPOINTMENT_SYSTEM_ROLE = 'SYSTEM';

/**
 * Roles that run the clinic and may change an appointment status. Every other role (PATIENT,
 * PHARMACIST, an unknown or missing role...) is treated like a patient.
 */
export const APPOINTMENT_STAFF_ROLES: ReadonlySet<string> = new Set<string>([
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.THERAPIST,
  Role.COUNSELOR,
  Role.NURSE,
  Role.RECEPTIONIST,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
]);

export const PATIENT_STATUS_CHANGE_MESSAGE =
  'Patients cannot change an appointment status here. Cancel the appointment, or check in at the clinic.';
export const IN_CLINIC_CONFIRMATION_MESSAGE =
  'In-clinic appointments are confirmed by check-in. Use the check-in flow.';
export const VIDEO_CONFIRMATION_MESSAGE =
  'Video appointments are confirmed by payment, not by a status change.';
export const COMPLETION_FLOW_MESSAGE =
  'An appointment is completed by the treating doctor from an in-progress consultation. Use the complete-appointment flow.';
export const CONSULTATION_START_MESSAGE =
  'A consultation is started by clinic staff from a checked-in appointment. Use the start-consultation flow.';
export const SYSTEM_ONLY_EXPIRY_MESSAGE =
  'Only the system can expire a consultation that is in progress.';

export function normalizeAppointmentRole(role: string | null | undefined): string {
  return String(role ?? '')
    .trim()
    .toUpperCase();
}

export function isAppointmentStaffRole(role: string | null | undefined): boolean {
  return APPOINTMENT_STAFF_ROLES.has(normalizeAppointmentRole(role));
}

/** Exact match on purpose: SYSTEM is an internal constant, never a spelling a caller can vary. */
export function isAppointmentSystemRole(role: string | null | undefined): boolean {
  return role === APPOINTMENT_SYSTEM_ROLE;
}

/** IN_PROGRESS -> EXPIRED: the scheduler closing a visit that was started and never completed. */
export function isSystemOnlyStatusTransition(currentStatus: string, targetStatus: string): boolean {
  return (
    String(currentStatus).toUpperCase() === 'IN_PROGRESS' &&
    String(targetStatus).toUpperCase() === 'EXPIRED'
  );
}

export function isVideoSlotAwaitingConfirmation(appointment: {
  type?: string | null | undefined;
  status?: string | null | undefined;
  proposedSlots?: unknown;
  confirmedSlotIndex?: number | null | undefined;
}): boolean {
  if (String(appointment.type || '').toUpperCase() !== 'VIDEO_CALL') {
    return false;
  }

  const hasProposedSlots =
    Array.isArray(appointment.proposedSlots) && appointment.proposedSlots.length > 0;
  const confirmedSlotIndex = appointment.confirmedSlotIndex;
  const hasConfirmedSlot =
    confirmedSlotIndex !== null &&
    confirmedSlotIndex !== undefined &&
    !Number.isNaN(Number(confirmedSlotIndex));

  if (String(appointment.status || '').toUpperCase() === 'AWAITING_SLOT_CONFIRMATION') {
    return true;
  }

  return hasProposedSlots && !hasConfirmedSlot;
}

export function isValidAppointmentStatusTransition(
  currentStatus: string,
  newStatus: string
): boolean {
  return APPOINTMENT_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

export function canCancelAppointmentStatus(currentStatus: string): boolean {
  return APPOINTMENT_CANCELABLE_STATUSES.has(currentStatus);
}

/** Why a status change through the generic update is refused, and with which HTTP class. */
export interface GenericStatusChangeRefusal {
  readonly httpStatus: 400 | 403;
  readonly message: string;
}

/**
 * The product rules for a status change through the GENERIC update (PUT /appointments/:id and the
 * status endpoint's fall-through targets), on top of the transition table above. They live here,
 * in the state contract, so every caller of the core update is covered, not just one route.
 *
 * - SYSTEM (cron / plugins) is bound only by the transition table.
 * - A target equal to the current status is a no-op and never refused here.
 * - A non-staff role (patient...) may not change a status at all; cancelling and checking in have
 *   their own flows.
 * - Staff cannot expire a consultation in progress (the scheduler does), cannot complete (only the
 *   treating doctor's complete flow does), cannot start a consultation (the start flow does) and
 *   cannot confirm: an in-clinic visit is confirmed by check-in, a video visit by payment.
 *
 * Returns null when the change may proceed to the transition table.
 */
export function getGenericStatusChangeRefusal(input: {
  currentStatus: string;
  targetStatus: string;
  appointmentType?: string | null | undefined;
  role: string | null | undefined;
}): GenericStatusChangeRefusal | null {
  const current = String(input.currentStatus).toUpperCase();
  const target = String(input.targetStatus).toUpperCase();

  if (isAppointmentSystemRole(input.role) || target === current) {
    return null;
  }

  if (!isAppointmentStaffRole(input.role)) {
    return { httpStatus: 403, message: PATIENT_STATUS_CHANGE_MESSAGE };
  }

  if (isSystemOnlyStatusTransition(current, target)) {
    return { httpStatus: 403, message: SYSTEM_ONLY_EXPIRY_MESSAGE };
  }

  switch (target) {
    case 'COMPLETED':
      return { httpStatus: 400, message: COMPLETION_FLOW_MESSAGE };
    case 'IN_PROGRESS':
      return { httpStatus: 400, message: CONSULTATION_START_MESSAGE };
    case 'CONFIRMED':
      return {
        httpStatus: 400,
        message:
          String(input.appointmentType ?? '').toUpperCase() === 'VIDEO_CALL'
            ? VIDEO_CONFIRMATION_MESSAGE
            : IN_CLINIC_CONFIRMATION_MESSAGE,
      };
    default:
      return null;
  }
}

/**
 * Which fields of the generic appointment update (PUT /appointments/:id and the status
 * endpoint's fall-through targets) each kind of caller may send.
 *
 * Everything not listed is refused with a 400, so a field added to the DTO later is closed by
 * default. Structural changes have their own flows and never go through here: the date, time,
 * duration and location (reschedule), the doctor (reassign), the clinic, the patient and the
 * appointment type (fixed once booked), the payment state, the check-in / start / completion
 * timestamps, and the status itself (state contract + dedicated flows).
 */

/** `status` is listed so the status policy, not this one, decides on it. */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set(['status', 'reason', 'notes']);
const STAFF_FIELDS: ReadonlySet<string> = new Set([
  'status',
  'reason',
  'notes',
  'priority',
  'treatmentType',
  'metadata',
]);
const PATIENT_FIELDS: ReadonlySet<string> = new Set(['status', 'notes']);

/** The one metadata key a clinician may write through the generic update (a merged draft). */
const CONSULTATION_DRAFT_KEY = 'consultationDraft';

/** Staff roles that may save a consultation draft. Front-desk staff do not write clinical data. */
const DRAFT_ROLES: ReadonlySet<string> = new Set<string>([
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.THERAPIST,
  Role.COUNSELOR,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
]);

const RESCHEDULE_HINT = 'Use the reschedule flow.';
const CLINICAL_HINT = 'Clinical details are recorded when the consultation is completed.';
const FIXED_HINT = 'This is fixed once the appointment is booked.';

const FIELD_HINTS: Readonly<Record<string, string>> = {
  appointmentDate: RESCHEDULE_HINT,
  date: RESCHEDULE_HINT,
  time: RESCHEDULE_HINT,
  duration: RESCHEDULE_HINT,
  locationId: RESCHEDULE_HINT,
  doctorId: 'Use the reassign-doctor flow.',
  clinicId: FIXED_HINT,
  patientId: FIXED_HINT,
  familyMemberId: FIXED_HINT,
  type: FIXED_HINT,
  metadata: 'Appointment metadata is managed by the system.',
  diagnosis: CLINICAL_HINT,
  prescription: CLINICAL_HINT,
  treatmentPlan: CLINICAL_HINT,
  symptoms: CLINICAL_HINT,
  followUpDate: CLINICAL_HINT,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for `{ consultationDraft: { ... } }` and nothing else. */
function isConsultationDraftOnly(metadata: unknown): metadata is Record<string, unknown> {
  if (!isPlainObject(metadata)) {
    return false;
  }
  const keys = Object.keys(metadata);
  return (
    keys.length === 1 &&
    keys[0] === CONSULTATION_DRAFT_KEY &&
    isPlainObject(metadata[CONSULTATION_DRAFT_KEY])
  );
}

function allowedFieldsFor(role: string | null | undefined): ReadonlySet<string> {
  if (isAppointmentSystemRole(role)) {
    return SYSTEM_FIELDS;
  }
  return isAppointmentStaffRole(role) ? STAFF_FIELDS : PATIENT_FIELDS;
}

function refuse(field: string): never {
  const hint = FIELD_HINTS[field];
  throw new BadRequestException(
    `Field "${field}" cannot be changed here.${hint ? ` ${hint}` : ''}`
  );
}

/**
 * Throws a 400 naming the first field the caller may not change through the generic update.
 * Fields whose value is undefined count as absent.
 */
export function assertUpdateFieldsAllowed(
  updateDto: object,
  role: string | null | undefined
): void {
  const allowed = allowedFieldsFor(role);

  for (const [field, value] of Object.entries(updateDto)) {
    if (value === undefined) {
      continue;
    }
    if (!allowed.has(field)) {
      refuse(field);
    }
    if (field === 'metadata') {
      const mayDraft = DRAFT_ROLES.has(normalizeAppointmentRole(role));
      if (!mayDraft || !isConsultationDraftOnly(value)) {
        refuse(field);
      }
    }
  }
}

export interface AppointmentUpdateBase {
  readonly metadata?: unknown;
}

/**
 * The Prisma update payload for an already-validated generic update. Built field by field, never
 * by spreading the request, so nothing outside the allowlist can reach the database.
 *
 * @param statusChange the new status, or undefined when the status is not changing (including a
 *   status sent unchanged).
 */
export function buildAppointmentUpdateData(input: {
  updateDto: object;
  existing: AppointmentUpdateBase;
  statusChange: string | undefined;
}): Record<string, unknown> {
  const dto = input.updateDto as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  for (const field of ['notes', 'priority', 'treatmentType'] as const) {
    if (dto[field] !== undefined) {
      data[field] = dto[field];
    }
  }

  if (input.statusChange !== undefined) {
    data['status'] = input.statusChange;
  }

  // `reason` belongs to the status DTO and is not an Appointment column: map it onto the
  // canonical fields so Prisma never receives an unknown property.
  const reason = typeof dto['reason'] === 'string' ? dto['reason'].trim() : '';
  if (reason) {
    const closing = input.statusChange === 'EXPIRED' || input.statusChange === 'CANCELLED';
    if (closing) {
      data['cancellationReason'] = reason;
    } else if (!data['notes']) {
      data['notes'] = reason;
    }
  }

  if (isConsultationDraftOnly(dto['metadata'])) {
    const current = isPlainObject(input.existing.metadata) ? input.existing.metadata : {};
    data['metadata'] = {
      ...current,
      [CONSULTATION_DRAFT_KEY]: dto['metadata'][CONSULTATION_DRAFT_KEY],
    };
  }

  return data;
}
