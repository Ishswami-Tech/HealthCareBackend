/**
 * Row-level reads / writes of the pharmacy counter hand-over (DispenseHandover + the prescription
 * and patient identity it needs). Kept out of HandoverService so the service holds only the
 * hand-over rules; every write goes through OpsDbService (clinic-scoped, audited).
 */

import type {
  DispenseHandoverRow,
  PrescriptionLiteRow,
} from '@services/clinic-ops/clinic-ops.types';
import { HANDOVER_RX_SELECT } from '@services/clinic-ops/services/handover-contract.util';
import {
  handoverNotFoundError,
  prescriptionNotFoundError,
} from '@services/clinic-ops/services/handover-errors.util';
import type { OpsActor, OpsDbService } from '@services/clinic-ops/services/ops-db.service';

/** Wrong codes allowed per hand-over row before it locks. */
export const HANDOVER_MAX_ATTEMPTS = 5;
/** Most prescriptions one shared collection code covers (newest ready ones first). */
export const MAX_SHARED_PRESCRIPTIONS = 10;

export interface PatientIdentityRecord {
  phone: string | null;
  uhids: string[];
}

export async function loadPrescriptionRow(
  ops: OpsDbService,
  id: string,
  clinicId: string
): Promise<PrescriptionLiteRow> {
  const rx = await ops.read(client =>
    client.prescription.findFirst({ where: { id, clinicId }, select: HANDOVER_RX_SELECT })
  );
  if (!rx) throw prescriptionNotFoundError();
  return rx;
}

export async function loadHandoverRow(
  ops: OpsDbService,
  id: string,
  clinicId: string
): Promise<DispenseHandoverRow> {
  const row = await ops.read(client =>
    client.dispenseHandover.findFirst({ where: { id, clinicId } })
  );
  if (!row) throw handoverNotFoundError();
  return row;
}

/** Newest open (PENDING_VERIFICATION) hand-over of one prescription, verified or not. */
export async function latestOpenRow(
  ops: OpsDbService,
  clinicId: string,
  prescriptionId: string
): Promise<DispenseHandoverRow | null> {
  return await ops.read(client =>
    client.dispenseHandover.findFirst({
      where: { clinicId, prescriptionId, status: 'PENDING_VERIFICATION' },
      orderBy: { createdAt: 'desc' },
    })
  );
}

/** Unverified hand-overs of the patient at this clinic (plus any of this prescription). */
export async function openRowsOfPatient(
  ops: OpsDbService,
  rx: PrescriptionLiteRow,
  clinicId: string
): Promise<DispenseHandoverRow[]> {
  return await ops.read(client =>
    client.dispenseHandover.findMany({
      where: {
        clinicId,
        status: 'PENDING_VERIFICATION',
        verifiedAt: null,
        OR: [{ patientId: rx.patientId }, { prescriptionId: rx.id }],
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_SHARED_PRESCRIPTIONS * 2,
    })
  );
}

/** One attempt per row, claimed atomically under the limit; returns the rows it was claimed on. */
export async function claimAttempts(
  ops: OpsDbService,
  rows: readonly DispenseHandoverRow[],
  clinicId: string,
  actor: OpsActor
): Promise<DispenseHandoverRow[]> {
  const claimed: DispenseHandoverRow[] = [];
  for (const row of rows) {
    const attempt = await ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: {
            id: row.id,
            clinicId,
            status: 'PENDING_VERIFICATION',
            otpAttempts: { lt: HANDOVER_MAX_ATTEMPTS },
          },
          data: { otpAttempts: { increment: 1 } },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'VERIFY_ATTEMPT',
        resourceId: row.id,
      }
    );
    if (attempt.count === 1) claimed.push(row);
  }
  return claimed;
}

/** A matching code gives back the attempts claimed for the comparison. */
export async function refundAttempts(
  ops: OpsDbService,
  rows: readonly DispenseHandoverRow[],
  clinicId: string,
  actor: OpsActor
): Promise<void> {
  for (const row of rows) {
    await ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: { id: row.id, clinicId, otpAttempts: { gt: 0 } },
          data: { otpAttempts: { decrement: 1 } },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'VERIFY_ATTEMPT_REFUND',
        resourceId: row.id,
      }
    );
  }
}

/** Phone on file and the clinic UHID(s) of the prescription's patient. */
export async function loadIdentityRecord(
  ops: OpsDbService,
  rx: PrescriptionLiteRow,
  clinicId: string
): Promise<PatientIdentityRecord> {
  return await ops.read(async client => {
    const [patient, identifiers] = await Promise.all([
      client.patient.findFirst({
        where: { id: rx.patientId },
        select: { id: true, userId: true, user: { select: { phone: true } } },
      }),
      client.patientIdentifier.findMany({
        where: { patientId: rx.patientId, clinicId, system: 'UHID' },
        select: { value: true },
      }),
    ]);
    return {
      phone: patient?.user?.phone ?? null,
      uhids: identifiers.map(row => row.value).filter(Boolean),
    };
  });
}
