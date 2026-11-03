/**
 * Clinic scope checks for foreign ids taken from a request body.
 * @module ClinicOps
 * @description Every id a caller sends (patient, location, staff user, supplier, prescription,
 * visit, appointment) must belong to the caller's clinic before it is written onto a row. The
 * patient predicate is the one the in-person walk-in path uses (primary clinic or clinic list).
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { OpsClient } from '../clinic-ops.types';

/** Prisma `where` fragment: the patient's user is registered with the clinic. */
export function patientInClinicWhere(clinicId: string): Record<string, unknown> {
  return {
    user: { OR: [{ primaryClinicId: clinicId }, { clinics: { some: { id: clinicId } } }] },
  };
}

export async function assertPatientInClinic(
  client: OpsClient,
  patientId: string,
  clinicId: string
): Promise<{ id: string }> {
  const patient = await client.patient.findFirst({
    where: { id: patientId, ...patientInClinicWhere(clinicId) },
    select: { id: true },
  });
  if (!patient) throw new NotFoundException('Patient not found in this clinic');
  return patient;
}

/** Every id must be an active location of the clinic (empty list passes). */
export async function assertLocationsInClinic(
  client: OpsClient,
  locationIds: readonly string[],
  clinicId: string
): Promise<void> {
  const wanted = [...new Set(locationIds)];
  if (!wanted.length) return;
  const found = await client.clinicLocation.findMany({
    where: { id: { in: wanted }, clinicId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (found.length !== wanted.length) {
    throw new BadRequestException('Location not found in this clinic');
  }
}

/** The user is a staff member (any non-patient role) of the clinic. */
export async function assertStaffInClinic(
  client: OpsClient,
  userId: string,
  clinicId: string
): Promise<void> {
  const user = await client.user.findFirst({
    where: {
      id: userId,
      role: { not: 'PATIENT' },
      OR: [{ primaryClinicId: clinicId }, { clinics: { some: { id: clinicId } } }],
    },
    select: { id: true },
  });
  if (!user) throw new BadRequestException('The selected staff member is not part of this clinic');
}

export async function assertSupplierInClinic(
  client: OpsClient,
  supplierId: string,
  clinicId: string
): Promise<void> {
  const supplier = await client.supplier.findFirst({
    where: { id: supplierId, clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!supplier) throw new BadRequestException('Supplier not found in this clinic');
}
