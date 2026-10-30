/**
 * Store + RBAC for the L3 cascade proposal rows (DoctorReassignmentProposal).
 *
 * One PENDING row per appointment: the cascade records PENDING rows for visits that could not
 * be auto-moved, and APPLIED audit rows for the safe-auto moves it applied — replacing an
 * override refreshes the existing PENDING row instead of piling up duplicates. This store owns
 * those writes (with audit trails) and the review-side reads / status transitions, shared by
 * ReassignmentCascadeService (the automatic half) and ReassignmentProposalService (the
 * human-confirm half), so both agree on dedupe and on who may manage a proposal.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import {
  Prisma,
  type DoctorReassignmentProposal as ProposalModel,
} from '@infrastructure/database/prisma/generated/client';
import { LogType, LogLevel } from '@core/types';
import { nowIso } from '@utils/date-time.util';
import type { DayAvailabilityActor } from '@services/doctors/day-availability.service';
import { dateToIstDayKey } from '@services/doctors/day-availability-sessions.util';

const SOURCE = 'ReassignmentProposalStore';

/**
 * The roles that may review / apply proposals (mirrors the day-availability routes: doctor
 * self-service for their own, clinic-admin for the clinic, super-admin bypasses). Any other
 * role is refused at the service level even if a @Roles list ever widens.
 */
export const PROPOSAL_REVIEW_ROLES: ReadonlySet<string> = new Set<string>([
  'CLINIC_ADMIN',
  'DOCTOR',
  'ASSISTANT_DOCTOR',
  'SUPER_ADMIN',
]);

export type ReassignmentProposalRow = ProposalModel;

export interface ReassignmentProposalResponse {
  id: string;
  clinicId: string;
  doctorId: string;
  appointmentId: string;
  date: string;
  reason: string | null;
  autoEligible: boolean;
  suggestedTargetDoctorId: string | null;
  status: string;
  notes: string | null;
  appliedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toReassignmentProposalResponse(
  row: ReassignmentProposalRow
): ReassignmentProposalResponse {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    appointmentId: row.appointmentId,
    date: dateToIstDayKey(row.date),
    reason: row.reason ?? null,
    autoEligible: row.autoEligible,
    suggestedTargetDoctorId: row.suggestedTargetDoctorId ?? null,
    status: row.status,
    notes: row.notes ?? null,
    appliedBy: row.appliedBy ?? null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the cascade writes for a visit that could not be auto-moved. */
export interface PendingProposalInput {
  clinicId: string;
  doctorId: string;
  appointmentId: string;
  /** IST calendar day of the removed window, YYYY-MM-DD. */
  dateKey: string;
  reason?: string | null;
  notes?: string | null;
}

/** What the cascade records for a safe-auto move (audit row, not a PENDING one). */
export interface AppliedProposalInput extends PendingProposalInput {
  targetDoctorId: string;
}

@Injectable()
export class ReassignmentProposalStore {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  /** Proposals of a clinic by status, optionally one doctor's, newest day last. */
  async list(
    clinicId: string,
    status: string,
    doctorId?: string
  ): Promise<ReassignmentProposalRow[]> {
    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorReassignmentProposal.findMany({
        where: {
          clinicId,
          status,
          deletedAt: null,
          ...(doctorId ? { doctorId } : {}),
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      });
    });
    return rows ?? [];
  }

  /** A single proposal row; 404 when missing, soft-deleted, or not in this clinic. */
  async load(id: string, clinicId: string): Promise<ReassignmentProposalRow> {
    const row = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorReassignmentProposal.findUnique({ where: { id } });
    });
    if (!row || row.deletedAt || row.clinicId !== clinicId) {
      throw new NotFoundException('Reassignment proposal not found');
    }
    return row;
  }

  /**
   * Record (or refresh) the PENDING proposal of an appointment — one PENDING row per
   * appointment, so a replaced override updates the existing row instead of duplicating it.
   */
  async recordPending(input: PendingProposalInput): Promise<void> {
    const existing = await this.findPending(input.appointmentId, input.clinicId);
    if (existing) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const tx = client as unknown as Prisma.TransactionClient;
          return await tx.doctorReassignmentProposal.update({
            where: { id: existing.id },
            data: {
              doctorId: input.doctorId,
              date: dayKeyToDate(input.dateKey),
              reason: input.reason ?? null,
              ...(input.notes != null ? { notes: input.notes } : {}),
            },
          });
        },
        this.auditInfo(input, 'PENDING', 'system', 'system')
      );
      return;
    }
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctorReassignmentProposal.create({
          data: {
            clinicId: input.clinicId,
            doctorId: input.doctorId,
            appointmentId: input.appointmentId,
            date: dayKeyToDate(input.dateKey),
            autoEligible: false,
            status: 'PENDING',
            reason: input.reason ?? null,
            ...(input.notes != null ? { notes: input.notes } : {}),
          },
        });
      },
      this.auditInfo(input, 'PENDING', 'system', 'system')
    );
  }

  /**
   * Record the APPLIED audit row of a safe-auto move. When a PENDING row already exists for
   * the appointment (an earlier override), it is upgraded to APPLIED rather than duplicated.
   */
  async recordApplied(input: AppliedProposalInput): Promise<void> {
    const existing = await this.findPending(input.appointmentId, input.clinicId);
    const fields = {
      doctorId: input.doctorId,
      date: dayKeyToDate(input.dateKey),
      suggestedTargetDoctorId: input.targetDoctorId,
      autoEligible: true,
      status: 'APPLIED',
      appliedBy: 'system',
      resolvedAt: new Date(),
      reason: input.reason ?? null,
      notes:
        input.notes ?? 'Auto-moved: an open same-clinic provider was available at the exact slot',
    };
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        if (existing) {
          return await tx.doctorReassignmentProposal.update({
            where: { id: existing.id },
            data: fields,
          });
        }
        return await tx.doctorReassignmentProposal.create({
          data: { ...fields, clinicId: input.clinicId, appointmentId: input.appointmentId },
        });
      },
      this.auditInfo(input, 'APPLIED', 'system', 'system')
    );
  }

  /**
   * A review-side status transition (APPLIED / DEFERRED / DISCARDED): records who did it and
   * when, with an audit trail. The move itself happens in the existing appointment paths.
   */
  async setStatus(
    id: string,
    actor: DayAvailabilityActor,
    status: string,
    notes?: string
  ): Promise<ReassignmentProposalResponse> {
    const actorId = actor.userId || 'system';
    const row = await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctorReassignmentProposal.update({
          where: { id },
          data: {
            status,
            appliedBy: actorId,
            resolvedAt: new Date(),
            ...(notes ? { notes } : {}),
          },
        });
      },
      this.auditInfo(
        { clinicId: actor.clinicId ?? '', doctorId: '', appointmentId: id, dateKey: '' },
        status,
        actorId,
        actor.role
      )
    );
    void this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      `Reassignment proposal ${status.toLowerCase()}`,
      SOURCE,
      { proposalId: id, status, appliedBy: actorId, timestamp: nowIso() }
    );
    return toReassignmentProposalResponse(row);
  }

  /** Roles gate: only the proposal review roles may manage proposals. */
  assertReviewRole(actor: DayAvailabilityActor): void {
    if (!PROPOSAL_REVIEW_ROLES.has(actor.role)) {
      throw new BadRequestException('Insufficient permissions to manage reassignment proposals');
    }
  }

  /** Mirror the day-availability RBAC: doctor self-service for their own, admin for the clinic. */
  async assertCanManageDoctor(
    doctorId: string,
    actor: DayAvailabilityActor,
    clinicId: string
  ): Promise<void> {
    this.assertReviewRole(actor);
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'CLINIC_ADMIN') {
      const link = await this.databaseService.executeHealthcareRead(async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctorClinic.findFirst({
          where: { clinicId, doctorId },
          select: { doctorId: true },
        });
      });
      if (!link) throw new NotFoundException('Doctor not found in this clinic');
      return;
    }
    // DOCTOR / ASSISTANT_DOCTOR (the only remaining review roles).
    const doctor = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctor.findFirst({
        where: { OR: [{ id: doctorId }, { userId: doctorId }] },
        select: { id: true, userId: true },
      });
    });
    if (!doctor || (doctor.id !== actor.userId && doctor.userId !== actor.userId)) {
      throw new BadRequestException('Doctors can only manage their own reassignment proposals');
    }
  }

  private async findPending(
    appointmentId: string,
    clinicId: string
  ): Promise<ReassignmentProposalRow | null> {
    const row = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorReassignmentProposal.findFirst({
        where: { appointmentId, clinicId, status: 'PENDING', deletedAt: null },
      });
    });
    return row ?? null;
  }

  private auditInfo(
    input: { clinicId: string; doctorId: string; appointmentId: string; dateKey: string },
    status: string,
    userId: string,
    userRole: string
  ) {
    return {
      userId,
      clinicId: input.clinicId,
      resourceType: 'DOCTOR_REASSIGNMENT_PROPOSAL',
      operation: 'CREATE',
      resourceId: input.appointmentId,
      userRole,
      details: { doctorId: input.doctorId, date: input.dateKey, status },
    };
  }
}

/** IST-midnight day key (YYYY-MM-DD) -> the UTC-midnight DATE value Prisma stores. */
function dayKeyToDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}
