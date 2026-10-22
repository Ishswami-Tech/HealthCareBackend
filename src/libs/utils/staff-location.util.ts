/**
 * Staff location allotment - the ONE place that knows where a staff member works.
 *
 * Every staff role has a profile row (Receptionist, ClinicAdmin, Pharmacist, Nurse, ...) whose
 * `locationId` is the clinic location the clinic admin allotted them to; the doctor and the
 * assistant doctor carry it on DoctorClinic. The location always comes from here (the server),
 * never from a header / query / body the client sends.
 */

import { ForbiddenException } from '@nestjs/common';
import type { DatabaseService } from '@infrastructure/database';

export interface StaffLocation {
  locationId: string | null;
  locationName: string | null;
}

interface LocationLink {
  locationId: string | null;
  location?: { name: string } | null;
}

/** User relation that holds the allotted location for each staff role. */
export const STAFF_LOCATION_RELATION: Readonly<Record<string, string>> = {
  RECEPTIONIST: 'receptionists',
  CLINIC_ADMIN: 'clinicAdmins',
  PHARMACIST: 'pharmacist',
  NURSE: 'nurse',
  THERAPIST: 'therapist',
  LAB_TECHNICIAN: 'labTechnician',
  FINANCE_BILLING: 'financeBilling',
  SUPPORT_STAFF: 'supportStaff',
  COUNSELOR: 'counselor',
  CLINIC_LOCATION_HEAD: 'locationHead',
};

const DOCTOR_ROLES: ReadonlySet<string> = new Set(['DOCTOR', 'ASSISTANT_DOCTOR']);
const LINK_SELECT = { select: { locationId: true, location: { select: { name: true } } } };

const NO_LOCATION: StaffLocation = { locationId: null, locationName: null };

/** Prisma `select` for a User row that carries every staff role's location link (one query). */
export function staffLocationSelect(clinicId?: string): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  for (const relation of new Set(Object.values(STAFF_LOCATION_RELATION))) {
    select[relation] = LINK_SELECT;
  }
  select['doctor'] = {
    select: {
      clinics: {
        ...(clinicId ? { where: { clinicId } } : {}),
        select: { locationId: true, location: { select: { name: true } } },
        take: 1,
      },
    },
  };
  return select;
}

/** The allotted location of a User row read with `staffLocationSelect`. */
export function pickStaffLocation(
  row: Record<string, unknown> | null | undefined,
  role: string | null | undefined
): StaffLocation {
  if (!row) return NO_LOCATION;
  const upper = String(role ?? '')
    .trim()
    .toUpperCase();
  let link: LocationLink | null | undefined;
  if (DOCTOR_ROLES.has(upper)) {
    const doctor = row['doctor'] as { clinics?: Array<LocationLink | null> } | null | undefined;
    link = doctor?.clinics?.[0];
  } else {
    const relation = STAFF_LOCATION_RELATION[upper];
    link = relation ? (row[relation] as LocationLink | null | undefined) : undefined;
  }
  return link?.locationId
    ? { locationId: link.locationId, locationName: link.location?.name ?? null }
    : NO_LOCATION;
}

interface ReceptionistLocationRow {
  locationId: string | null;
  /** Loaded with the allotment (Prisma always returns the key when selected). */
  location?: { clinicId: string; isActive: boolean; deletedAt: Date | null } | null;
}

/**
 * Whether the receptionist's allotted location may be used for `clinicId`: it must belong to that
 * clinic and be active and not deleted. A row read without the relation (older callers / fakes)
 * keeps the previous behaviour and is trusted.
 */
export function isUsableReceptionistLocation(
  row: ReceptionistLocationRow | null | undefined,
  clinicId: string
): row is ReceptionistLocationRow & { locationId: string } {
  if (!row?.locationId) return false;
  if (row.location === undefined) return true;
  const location = row.location;
  return Boolean(
    location && location.clinicId === clinicId && location.isActive && !location.deletedAt
  );
}

interface StaffLocationClient {
  user: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
  receptionist: { findFirst: (args: unknown) => Promise<ReceptionistLocationRow | null> };
  clinicLocation: { findMany: (args: unknown) => Promise<Array<{ id: string; name: string }>> };
}

/** One staff member's allotted location (null fields when none / a patient). */
export async function readStaffLocation(
  database: Pick<DatabaseService, 'executeHealthcareRead'>,
  userId: string,
  role: string | null | undefined,
  clinicId?: string
): Promise<StaffLocation> {
  const upper = String(role ?? '').toUpperCase();
  if (!DOCTOR_ROLES.has(upper) && !STAFF_LOCATION_RELATION[upper]) return NO_LOCATION;
  const row = await database.executeHealthcareRead(client =>
    (client as unknown as StaffLocationClient).user.findUnique({
      where: { id: userId },
      select: staffLocationSelect(clinicId),
    })
  );
  return pickStaffLocation(row, upper);
}

/**
 * The location a RECEPTIONIST works at. Fail closed: without a usable allotment (none, or a
 * location of ANOTHER clinic - a receptionist linked to several clinics through
 * ReceptionistsAtClinic keeps one Receptionist row - or an inactive / deleted location) the
 * receptionist is accepted only in a clinic with exactly one active location; otherwise 403
 * RECEPTION_WRONG_LOCATION (the clinic admin must allot one). Clinic membership itself is
 * enforced by ClinicGuard before this runs.
 */
export async function resolveReceptionistLocationOrThrow(
  database: Pick<DatabaseService, 'executeHealthcareRead'>,
  userId: string,
  clinicId: string
): Promise<string> {
  // The hot path (every reception list / queue read): one indexed lookup on Receptionist.userId.
  const assigned = await database.executeHealthcareRead(client =>
    (client as unknown as StaffLocationClient).receptionist.findFirst({
      where: { userId },
      select: {
        locationId: true,
        location: { select: { clinicId: true, isActive: true, deletedAt: true } },
      },
    })
  );
  if (isUsableReceptionistLocation(assigned, clinicId)) return assigned.locationId;
  const active = await database.executeHealthcareRead(client =>
    (client as unknown as StaffLocationClient).clinicLocation.findMany({
      where: { clinicId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
      take: 2,
    })
  );
  if (active.length === 1 && active[0]) return active[0].id;
  throw new ForbiddenException({
    statusCode: 403,
    code: 'RECEPTION_WRONG_LOCATION',
    message: 'You are not allotted to a clinic location. Ask the clinic admin to assign one.',
  });
}
