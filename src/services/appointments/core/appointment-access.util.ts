import type { DatabaseService } from '@infrastructure/database';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';

/**
 * Minimal shape of an appointment needed to decide who owns it.
 * Appointment.patientId is a Patient.id; a dependent booked through a family member either
 * keeps the booking patient's id and carries familyMemberId, or points at the dependent's own
 * Patient record (family members have their own User + Patient row, see FamilyMembersService).
 */
export interface AppointmentOwnershipRecord {
  readonly patientId?: string | null | undefined;
  readonly familyMemberId?: string | null | undefined;
  /** The user who made the booking (a patient booking for a dependent is the booker). */
  readonly userId?: string | null | undefined;
}

interface ReceptionistClient {
  receptionist: {
    findFirst: (args: PrismaDelegateArgs) => Promise<{
      locationId: string | null;
      location: { clinicId: string } | null;
    } | null>;
  };
}

interface ReceptionistAssignmentClient {
  receptionist: {
    findFirst: (args: PrismaDelegateArgs) => Promise<{ locationId: string | null } | null>;
  };
  clinicLocation: {
    findMany: (args: PrismaDelegateArgs) => Promise<Array<{ id: string }>>;
  };
}

interface OwnershipClient {
  patient: {
    findFirst: (args: PrismaDelegateArgs) => Promise<{ id: string } | null>;
  };
  familyMember: {
    findMany: (args: PrismaDelegateArgs) => Promise<Array<{ id: string; userId: string | null }>>;
  };
}

/**
 * True when the PATIENT-role caller (identified by their JWT user id) may act on the appointment:
 * it is their own, or it belongs to an active dependent of theirs.
 *
 * RbacGuard lets any PATIENT through on a blanket appointments:update, so ownership has to be
 * enforced where the appointment is actually loaded.
 */
export async function isAppointmentOwnedByPatientUser(
  database: DatabaseService,
  appointment: AppointmentOwnershipRecord,
  callerUserId: string
): Promise<boolean> {
  const appointmentPatientId = appointment.patientId ?? null;
  if (!callerUserId || !appointmentPatientId) {
    return false;
  }

  // The user who booked it is entitled to manage it (the patient's own list is defined the same
  // way: appointments booked by the user OR belonging to their patient profile).
  if (appointment.userId && appointment.userId === callerUserId) {
    return true;
  }

  return database.executeHealthcareRead<boolean>(async client => {
    const db = client as unknown as OwnershipClient;

    const callerPatient = await db.patient.findFirst({
      where: { userId: callerUserId },
      select: { id: true },
    });

    // Older rows stored the booking user's id in patientId; the by-id read endpoint accepts it too.
    if (appointmentPatientId === callerUserId) {
      return true;
    }
    if (!callerPatient) {
      return false;
    }
    if (appointmentPatientId === callerPatient.id) {
      return true;
    }

    const dependents = await db.familyMember.findMany({
      where: { patientId: callerPatient.id, isActive: true, deletedAt: null },
      select: { id: true, userId: true },
    });

    if (
      appointment.familyMemberId &&
      dependents.some(dependent => dependent.id === appointment.familyMemberId)
    ) {
      return true;
    }

    const dependentUserIds = dependents
      .map(dependent => dependent.userId)
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0);
    if (dependentUserIds.length === 0) {
      return false;
    }

    const dependentPatient = await db.patient.findFirst({
      where: { id: appointmentPatientId, userId: { in: dependentUserIds } },
      select: { id: true },
    });
    return Boolean(dependentPatient);
  });
}

/**
 * Fail-closed rule for a RECEPTIONIST acting on an appointment at a clinic location.
 *
 * - Assigned (Receptionist.locationId set): the appointment must be at exactly that location.
 *   An assignment that points anywhere else (including a location of another clinic) is a no.
 * - Not assigned (no Receptionist row or no locationId): allowed ONLY when the clinic has exactly
 *   one active location, because then the assignment is unambiguous. With several active
 *   locations an unassigned receptionist is refused instead of being clinic-wide.
 *
 * The request's clinicContext is a cached, clinic-wide object and never carries a per-user
 * location, so the assignment is read from the Receptionist row.
 */
export async function isReceptionistAssignedToAppointmentLocation(
  database: DatabaseService,
  userId: string,
  clinicId: string,
  appointmentLocationId: string | null | undefined
): Promise<boolean> {
  return database.executeHealthcareRead<boolean>(async client => {
    const db = client as unknown as ReceptionistAssignmentClient;

    const receptionist = await db.receptionist.findFirst({
      where: { userId },
      select: { locationId: true },
    });
    if (receptionist?.locationId) {
      return Boolean(appointmentLocationId) && receptionist.locationId === appointmentLocationId;
    }

    const activeLocations = await db.clinicLocation.findMany({
      where: { clinicId, isActive: true, deletedAt: null },
      select: { id: true },
      take: 2,
    });
    const onlyLocation = activeLocations.length === 1 ? activeLocations[0] : undefined;
    if (!onlyLocation) {
      return false;
    }
    return !appointmentLocationId || appointmentLocationId === onlyLocation.id;
  });
}

/**
 * The ClinicLocation a receptionist is assigned to (Receptionist.locationId), or null when the
 * receptionist is clinic-wide (no assignment). An assignment that points at another clinic is
 * ignored so a multi-clinic receptionist is not locked out of this one.
 *
 * @deprecated Fail-open for an unassigned receptionist. Use
 * `isReceptionistAssignedToAppointmentLocation`, which is fail-closed.
 */
export async function resolveReceptionistLocationId(
  database: DatabaseService,
  userId: string,
  clinicId: string
): Promise<string | null> {
  const receptionist = await database.executeHealthcareRead(async client => {
    return await (client as unknown as ReceptionistClient).receptionist.findFirst({
      where: { userId },
      select: { locationId: true, location: { select: { clinicId: true } } },
    });
  });

  if (!receptionist?.locationId) {
    return null;
  }
  if (receptionist.location?.clinicId && receptionist.location.clinicId !== clinicId) {
    return null;
  }
  return receptionist.locationId;
}
