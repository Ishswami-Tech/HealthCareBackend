/**
 * Video consultation access control helpers.
 *
 * The RBAC guard lets every clinical role through on `video:create` / `video:update`, so the
 * video service itself must decide who may join, start, end or leave a given appointment.
 * `assertParticipantOrClinicStaff` is the single place that decision is made.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@core/types/enums.types';
import type { DatabaseService } from '@infrastructure/database/database.service';
import type { Prisma } from '@infrastructure/database/prisma/generated/client';

/**
 * Platform roles that may use the staff side of a consultation (waiting-room queue and admit,
 * medical notes, EHR saves, participant list, analytics). A PATIENT is never one of them.
 * Being on this list only opens the door: the caller must still pass
 * `assertParticipantOrClinicStaff` for the appointment in question. SUPER_ADMIN is matched by the
 * raw platform role (the controller maps it to the clinic_admin video role).
 */
export const VIDEO_CLINICAL_STAFF_ROLES: readonly Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.THERAPIST,
  Role.COUNSELOR,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

/** Roles that may record a consultation or remove / mute its participants. */
export const VIDEO_MODERATOR_ROLES: readonly Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.THERAPIST,
  Role.COUNSELOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

/** Role names the video layer works with (mapped from the platform role by the controller). */
export type VideoCallerRole = 'patient' | 'doctor' | 'receptionist' | 'clinic_admin';

/** Request-derived context that the role mapping alone cannot express. */
export interface VideoCallerContext {
  /** Clinic the caller is acting in (validated by ClinicGuard, i.e. req.clinicContext.clinicId). */
  clinicId?: string | undefined;
  /** Platform role before it was mapped to a VideoCallerRole (for example SUPER_ADMIN). */
  rawRole?: string | undefined;
}

/** The slice of an appointment the access decision needs. */
export interface VideoAccessAppointment {
  clinicId: string;
  /** User who booked the appointment. */
  userId?: string | null | undefined;
  patient?: { userId?: string | null | undefined } | null | undefined;
  doctor?: { userId?: string | null | undefined } | null | undefined;
}

export interface VideoAccessCaller extends VideoCallerContext {
  userId: string;
  role: VideoCallerRole;
  /** True when the caller owns the family dependent the appointment is booked for. */
  ownsFamilyMember?: boolean | undefined;
}

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';
const ASSISTANT_DOCTOR_ROLE = 'ASSISTANT_DOCTOR';

function normalizeRole(role: string | undefined): string {
  return String(role ?? '')
    .trim()
    .toUpperCase();
}

const VIDEO_CALLER_ROLE_BY_PLATFORM_ROLE: ReadonlyMap<string, VideoCallerRole> = new Map<
  string,
  VideoCallerRole
>([
  [Role.PATIENT, 'patient'],
  [Role.DOCTOR, 'doctor'],
  [Role.ASSISTANT_DOCTOR, 'doctor'],
  [Role.THERAPIST, 'doctor'],
  [Role.COUNSELOR, 'doctor'],
  [Role.NURSE, 'receptionist'],
  [Role.RECEPTIONIST, 'receptionist'],
  [Role.CLINIC_ADMIN, 'clinic_admin'],
  [Role.SUPER_ADMIN, 'clinic_admin'],
]);

/**
 * Map a platform role (the JWT `role`) to the role name the video layer works with, or null when
 * the role has no business in a video consultation. SUPER_ADMIN maps to clinic_admin; the raw role
 * stays available through `VideoCallerContext.rawRole` for the checks that tell them apart.
 */
export function toVideoCallerRole(role: string | null | undefined): VideoCallerRole | null {
  return VIDEO_CALLER_ROLE_BY_PLATFORM_ROLE.get(normalizeRole(role ?? undefined)) ?? null;
}

/**
 * Is the caller the appointment's patient (the patient's own login, or the account holder that
 * booked it)? Family dependents are resolved by the caller through `ownsFamilyMember`.
 */
export function isPatientOwner(appointment: VideoAccessAppointment, userId: string): boolean {
  if (!userId) {
    return false;
  }
  return appointment.patient?.userId === userId || appointment.userId === userId;
}

/** Who completed a video visit through the end route. */
export type VideoCompletionActor = 'doctor' | 'clinic_admin';

/** What anyone else hears when they try to end (complete) a consultation. */
export const VIDEO_END_FORBIDDEN_MESSAGE =
  'Only the treating doctor or a clinic admin can end this consultation. Leave the call instead.';

/** True for a platform CLINIC_ADMIN (a SUPER_ADMIN is not one: it terminates sessions instead). */
export function isClinicAdminRole(rawRole: string | undefined): boolean {
  return normalizeRole(rawRole) === String(Role.CLINIC_ADMIN);
}

/**
 * Who may END (complete) a video visit: the appointment's own doctor, or a CLINIC_ADMIN of the
 * appointment's clinic. Nobody else: an assistant doctor, a therapist or counselor who is not the
 * appointment's doctor, nurses, receptionists and SUPER_ADMIN are all refused (they can join, and
 * a SUPER_ADMIN can terminate a session, but none of them completes a visit).
 *
 * Call it AFTER `assertParticipantOrClinicStaff`, which has already rejected another clinic's
 * appointment with a 404 for everyone but a SUPER_ADMIN.
 *
 * @returns the capacity the caller completes it in, or null when the caller may not
 */
export function resolveVideoCompletionActor(
  appointment: VideoAccessAppointment,
  caller: { userId: string; role: VideoCallerRole; rawRole?: string | undefined }
): VideoCompletionActor | null {
  if (caller.role === 'doctor' && appointment.doctor?.userId === caller.userId) {
    return 'doctor';
  }
  if (caller.role === 'clinic_admin' && isClinicAdminRole(caller.rawRole)) {
    return 'clinic_admin';
  }
  return null;
}

/**
 * Authorise a caller against a video appointment.
 *
 * 1. Clinic isolation applies to every role except SUPER_ADMIN. A different clinic gets a 404 so
 *    the existence of other clinics' appointments is not revealed.
 * 2. Patients must be the appointment's patient (or own the dependent it is booked for).
 * 3. Doctors must be the appointment's doctor; an ASSISTANT_DOCTOR of the same clinic is allowed.
 * 4. Nurses, receptionists and clinic admins only need to belong to the appointment's clinic.
 *
 * @throws NotFoundException when the appointment belongs to another clinic
 * @throws ForbiddenException when the caller is not a participant
 */
export function assertParticipantOrClinicStaff(
  appointment: VideoAccessAppointment,
  caller: VideoAccessCaller
): void {
  const rawRole = normalizeRole(caller.rawRole);

  if (rawRole !== SUPER_ADMIN_ROLE) {
    if (!caller.clinicId || appointment.clinicId !== caller.clinicId) {
      throw new NotFoundException('Appointment not found');
    }
  }

  switch (caller.role) {
    case 'patient':
      if (isPatientOwner(appointment, caller.userId) || caller.ownsFamilyMember === true) {
        return;
      }
      throw new ForbiddenException('You are not authorized to access this video appointment.');
    case 'doctor':
      if (appointment.doctor?.userId === caller.userId || rawRole === ASSISTANT_DOCTOR_ROLE) {
        return;
      }
      throw new ForbiddenException('You are not authorized to access this video appointment.');
    case 'receptionist':
    case 'clinic_admin':
      return;
    default:
      throw new ForbiddenException('You are not authorized to access this video appointment.');
  }
}

/**
 * Who, besides the patient, may be told about a video visit.
 *
 * `appointment.userId` is whoever created the appointment: the patient, a family member booking
 * for a dependent, but also a receptionist or the treating doctor. Only the first two belong in the
 * patient-facing notifications ("your doctor has joined", "consultation completed, rate your
 * visit"); staff who happened to create the booking must never receive them.
 */

/** The slice of an appointment the booker decision needs. */
export interface VideoBookerAppointment {
  /** User who created the appointment. */
  userId?: string | null | undefined;
  patientId?: string | null | undefined;
  familyMemberId?: string | null | undefined;
  patient?: { userId?: string | null | undefined } | null | undefined;
  doctor?: { userId?: string | null | undefined } | null | undefined;
}

/**
 * True when `userId` owns the family dependent (`FamilyMember.userId`, or the account that created
 * it) the appointment is booked for.
 */
export async function isFamilyMemberOwner(
  databaseService: DatabaseService,
  familyMemberId: string,
  patientId: string,
  userId: string
): Promise<boolean> {
  const member = await databaseService.executeHealthcareRead(async client => {
    const tx = client as unknown as Prisma.TransactionClient;
    return await tx.familyMember.findFirst({
      where: {
        id: familyMemberId,
        patientId,
        isActive: true,
        deletedAt: null,
        OR: [{ userId }, { createdByUserId: userId }],
      },
      select: { id: true },
    });
  });
  return member !== null && member !== undefined;
}

async function findUserRole(
  databaseService: DatabaseService,
  userId: string
): Promise<string | null> {
  const user = await databaseService.executeHealthcareRead(async client => {
    const tx = client as unknown as Prisma.TransactionClient;
    return await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  });
  return user ? String(user.role) : null;
}

/**
 * The booking account to notify in addition to the patient, or undefined when there is none.
 *
 * The booker is included only when it is a different account from the patient and is either the
 * owner of the family dependent the visit is for or a PATIENT-role user (an account holder booking
 * for someone else). The treating doctor's own user, receptionists and every other staff role are
 * never included, even when they created the appointment.
 */
export async function resolveVideoBookerUserId(
  databaseService: DatabaseService,
  appointment: VideoBookerAppointment
): Promise<string | undefined> {
  const bookerUserId = appointment.userId || undefined;
  if (!bookerUserId) {
    return undefined;
  }
  if (bookerUserId === appointment.patient?.userId || bookerUserId === appointment.doctor?.userId) {
    return undefined;
  }

  if (appointment.familyMemberId && appointment.patientId) {
    const ownsDependent = await isFamilyMemberOwner(
      databaseService,
      appointment.familyMemberId,
      appointment.patientId,
      bookerUserId
    );
    if (ownsDependent) {
      return bookerUserId;
    }
  }

  const role = await findUserRole(databaseService, bookerUserId);
  return role === String(Role.PATIENT) ? bookerUserId : undefined;
}
