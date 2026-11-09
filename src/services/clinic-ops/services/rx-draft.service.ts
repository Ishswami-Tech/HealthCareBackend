/**
 * Rx Draft Service (assistant doctor -> doctor approval)
 * @module ClinicOps
 * @description The assistant doctor PREPARES prescriptions (created as DRAFT through the normal
 * prescription endpoint, invisible to pharmacy and patient). The doctor approves a draft - it then
 * becomes a normal PENDING prescription - or returns it with a change note; the assistant fixes it
 * and resubmits. Responses never carry prices.
 */

import {
  RESUBMIT_UNCHANGED_MESSAGE,
  draftChangedSinceReturn,
} from '@services/clinic-ops/services/rx-draft-change.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { PharmacyService } from '@services/pharmacy/services/pharmacy.service';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import { displayName, type OpsClient, type PrescriptionLiteRow } from '../clinic-ops.types';
import type { ReturnRxDraftDto } from '../dto/clinic-ops.dto';

export interface RxDraftResponse {
  id: string;
  prescriptionNumber: string | null;
  status: string;
  patientId: string;
  patientName: string;
  diagnosis: string | null;
  notes: string | null;
  draftedByUserId: string | null;
  draftedByName: string | null;
  submittedAt: string | null;
  returnedAt: string | null;
  returnNote: string | null;
  approvedAt: string | null;
  items: Array<{
    id: string;
    medicineId: string | null;
    medicineName: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    quantity: number | null;
    instructions: string | null;
  }>;
  /** Items as the doctor last saw them (set when a draft is returned) so a resubmit can be diffed. */
  returnedSnapshot: unknown;
  /** The assistant's note on the last resubmit, if any. */
  resubmitNote: string | null;
}

const SOURCE = 'RxDraftService';
/** Pharmacy desk publish attempts after an approval (the approval is already committed). */
const PUBLISH_ATTEMPTS = 2;

function resubmitNoteOf(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const note = (snapshot as Record<string, unknown>)['resubmitNote'];
  return typeof note === 'string' && note.trim() ? note : null;
}

const DRAFT_SELECT = {
  id: true,
  clinicId: true,
  patientId: true,
  doctorId: true,
  status: true,
  diagnosis: true,
  notes: true,
  date: true,
  prescriptionNumber: true,
  draftedByUserId: true,
  draftedByRole: true,
  draftSnapshot: true,
  submittedAt: true,
  returnedAt: true,
  returnedByUserId: true,
  returnNote: true,
  approvedAt: true,
  approvedByUserId: true,
  doctor: { select: { id: true, userId: true } },
  patient: {
    select: { id: true, user: { select: { name: true, firstName: true, lastName: true } } },
  },
  items: {
    select: {
      id: true,
      medicineId: true,
      dosage: true,
      frequency: true,
      duration: true,
      quantity: true,
      instructions: true,
      medicine: { select: { id: true, name: true } },
    },
  },
};

@Injectable()
export class RxDraftService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly pharmacyService: PharmacyService,
    private readonly eventService: EventService,
    private readonly audit: ClinicAuditService,
    @Optional() private readonly loggingService?: LoggingService
  ) {}

  /**
   * Doctor: every draft awaiting approval (status DRAFT) in the clinic.
   * Assistant: only their own drafts, DRAFT and RETURNED (the "returned drafts" tab).
   */
  async list(
    clinicId: string,
    actor: OpsActor,
    status?: string,
    days?: number
  ): Promise<RxDraftResponse[]> {
    const role = actor.role.toUpperCase();
    const requested = status?.toUpperCase();
    if (requested === 'APPROVED') return this.listApproved(clinicId, actor, days);
    const wanted = requested ? [requested] : ['DRAFT', 'RETURNED'];
    if (wanted.some(s => !['DRAFT', 'RETURNED'].includes(s))) {
      throw new BadRequestException('status must be DRAFT, RETURNED or APPROVED');
    }
    const where: Record<string, unknown> = {
      clinicId,
      status: { in: wanted },
      ...this.ownerScope(actor),
    };
    if (role === 'ASSISTANT_DOCTOR') where['draftedByUserId'] = actor.userId;
    const rows = await this.ops.read(client =>
      client.prescription.findMany({
        where,
        select: DRAFT_SELECT,
        orderBy: { submittedAt: 'desc' },
        take: 200,
      })
    );
    return this.toResponses(rows);
  }

  /**
   * Recent history: drafts the doctor approved in the last `days` days (default 30, max 90),
   * newest first. They are normal prescriptions by now, so `status` is their live status
   * (PENDING, DISPENSED, ...). The assistant sees its own only.
   */
  private async listApproved(
    clinicId: string,
    actor: OpsActor,
    days?: number
  ): Promise<RxDraftResponse[]> {
    const window =
      Number.isFinite(days) && (days as number) >= 1 ? Math.min(days as number, 90) : 30;
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = {
      clinicId,
      draftedByUserId:
        actor.role.toUpperCase() === 'ASSISTANT_DOCTOR' ? actor.userId : { not: null },
      approvedAt: { gte: since },
      ...this.ownerScope(actor),
    };
    const rows = await this.ops.read(client =>
      client.prescription.findMany({
        where,
        select: DRAFT_SELECT,
        orderBy: { approvedAt: 'desc' },
        take: 100,
      })
    );
    return this.toResponses(rows);
  }

  async get(id: string, clinicId: string, actor: OpsActor): Promise<RxDraftResponse> {
    const row = await this.load(id, clinicId);
    this.assertCanSee(row, actor);
    return (await this.toResponses([row]))[0] as RxDraftResponse;
  }

  /** Doctor approves: DRAFT -> PENDING, then the prescription enters the pharmacy desk queue. */
  async approve(id: string, clinicId: string, actor: OpsActor): Promise<RxDraftResponse> {
    const row = await this.load(id, clinicId);
    this.assertTreatingDoctor(row, actor);
    if (row.status === 'PENDING' && row.approvedByUserId === actor.userId) {
      // Already approved by this doctor (e.g. the desk publish failed and the doctor retried):
      // approving is idempotent, so just make sure the pharmacy desk has it.
      await this.publishSafely(id, clinicId);
      return this.get(id, clinicId, actor);
    }
    if (row.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only a draft awaiting approval can be approved (it is ${row.status})`
      );
    }
    if (!row.items?.length && !row.diagnosis && !row.notes) {
      throw new BadRequestException('The draft is empty - ask the assistant to complete it');
    }
    const claimed = await this.ops.write(
      client =>
        client.prescription.updateMany({
          where: { id, clinicId, status: 'DRAFT' },
          data: {
            status: 'PENDING',
            approvedAt: new Date(),
            approvedByUserId: actor.userId,
            returnNote: null,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'PRESCRIPTION',
        operation: 'APPROVE_DRAFT',
        resourceId: id,
        details: { draftedBy: row.draftedByUserId },
      }
    );
    if (claimed.count !== 1) {
      throw new BadRequestException('This draft was already handled');
    }
    await this.publishSafely(id, clinicId);
    // Approval is what sends the prescription to the pharmacy (DRAFT -> PENDING).
    await this.audit.record(
      clinicId,
      { type: 'PRESCRIPTION', id },
      'PRESCRIPTION_APPROVED',
      actor,
      {
        prescriptionId: id,
        sentToPharmacy: true,
      }
    );
    await this.eventService.emit('clinic-ops.rx-draft.approved', {
      prescriptionId: id,
      clinicId,
      patientId: row.patientId,
      draftedByUserId: row.draftedByUserId,
      approvedByUserId: actor.userId,
    });
    return this.get(id, clinicId, actor);
  }

  /** Doctor sends the draft back with a change note. */
  async returnDraft(
    id: string,
    dto: ReturnRxDraftDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<RxDraftResponse> {
    const row = await this.load(id, clinicId);
    this.assertTreatingDoctor(row, actor);
    if (row.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only a draft awaiting approval can be returned (it is ${row.status})`
      );
    }
    const snapshot = this.snapshotOf(row);
    const claimed = await this.ops.write(
      client =>
        client.prescription.updateMany({
          where: { id, clinicId, status: 'DRAFT' },
          data: {
            status: 'RETURNED',
            returnedAt: new Date(),
            returnedByUserId: actor.userId,
            returnNote: dto.note.trim(),
            draftSnapshot: snapshot,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'PRESCRIPTION',
        operation: 'RETURN_DRAFT',
        resourceId: id,
      }
    );
    if (claimed.count !== 1) throw new BadRequestException('This draft was already handled');
    await this.pharmacyService.invalidatePrescriptionListCache({ prescriptionId: id, clinicId });
    await this.audit.record(
      clinicId,
      { type: 'PRESCRIPTION', id },
      'PRESCRIPTION_RETURNED',
      actor,
      {
        prescriptionId: id,
      }
    );
    await this.eventService.emit('clinic-ops.rx-draft.returned', {
      prescriptionId: id,
      clinicId,
      draftedByUserId: row.draftedByUserId,
      note: dto.note,
    });
    return this.get(id, clinicId, actor);
  }

  /**
   * Assistant: RETURNED -> DRAFT again after fixing it (edit via the normal prescription update).
   * An optional note for the doctor ("changed the dose as asked") rides on the draft snapshot.
   */
  async resubmit(
    id: string,
    clinicId: string,
    actor: OpsActor,
    note?: string
  ): Promise<RxDraftResponse> {
    const row = await this.load(id, clinicId);
    if (row.draftedByUserId !== actor.userId) {
      throw new ForbiddenException('Only the assistant who prepared the draft can resubmit it');
    }
    if (row.status !== 'RETURNED') {
      throw new BadRequestException(
        `Only a returned draft can be resubmitted (it is ${row.status})`
      );
    }
    // Sending the same draft back unchanged and without a word helps nobody: the doctor would
    // review exactly what they returned.
    const unchanged = !draftChangedSinceReturn(
      row.draftSnapshot && typeof row.draftSnapshot === 'object' ? row.draftSnapshot : null,
      { diagnosis: row.diagnosis, notes: row.notes ?? null, items: row.items ?? [] }
    );
    if (unchanged && !note?.trim()) {
      throw new ConflictException(RESUBMIT_UNCHANGED_MESSAGE);
    }
    const claimed = await this.ops.write(
      client =>
        client.prescription.updateMany({
          where: { id, clinicId, status: 'RETURNED' },
          data: {
            status: 'DRAFT',
            submittedAt: new Date(),
            ...this.resubmitNoteUpdate(row.draftSnapshot, note),
          },
        }),
      { actor, clinicId, resourceType: 'PRESCRIPTION', operation: 'RESUBMIT_DRAFT', resourceId: id }
    );
    if (claimed.count !== 1) throw new BadRequestException('This draft was already handled');
    await this.pharmacyService.invalidatePrescriptionListCache({ prescriptionId: id, clinicId });
    await this.audit.record(
      clinicId,
      { type: 'PRESCRIPTION', id },
      'PRESCRIPTION_RESUBMITTED',
      actor,
      {
        prescriptionId: id,
      }
    );
    await this.eventService.emit('clinic-ops.rx-draft.submitted', {
      prescriptionId: id,
      clinicId,
      draftedByUserId: actor.userId,
      ...(note?.trim() ? { note: note.trim() } : {}),
    });
    return this.get(id, clinicId, actor);
  }

  /** Assistant (own draft) or doctor discards a draft that will not be used. */
  async discard(
    id: string,
    clinicId: string,
    actor: OpsActor
  ): Promise<{ id: string; status: string }> {
    const row = await this.load(id, clinicId);
    const isDoctor = actor.role.toUpperCase() === 'DOCTOR';
    if (!isDoctor && row.draftedByUserId !== actor.userId) {
      throw new ForbiddenException('You can only discard your own drafts');
    }
    if (!['DRAFT', 'RETURNED'].includes(row.status)) {
      throw new BadRequestException(`Only a draft can be discarded (it is ${row.status})`);
    }
    const claimed = await this.ops.write(
      client =>
        client.prescription.updateMany({
          where: { id, clinicId, status: { in: ['DRAFT', 'RETURNED'] } },
          data: { status: 'CANCELLED' },
        }),
      { actor, clinicId, resourceType: 'PRESCRIPTION', operation: 'DISCARD_DRAFT', resourceId: id }
    );
    if (claimed.count !== 1) throw new BadRequestException('This draft was already handled');
    await this.pharmacyService.invalidatePrescriptionListCache({ prescriptionId: id, clinicId });
    return { id, status: 'CANCELLED' };
  }

  // ------------------------------------------------------------------ helpers

  private async load(id: string, clinicId: string): Promise<PrescriptionLiteRow> {
    const row = await this.ops.read(client =>
      client.prescription.findFirst({ where: { id, clinicId }, select: DRAFT_SELECT })
    );
    if (!row || !row.draftedByUserId) throw new NotFoundException('Draft prescription not found');
    return row;
  }

  private assertCanSee(row: PrescriptionLiteRow, actor: OpsActor): void {
    const role = actor.role.toUpperCase();
    if (role === 'ASSISTANT_DOCTOR' && row.draftedByUserId !== actor.userId) {
      throw new NotFoundException('Draft prescription not found');
    }
    if (role === 'DOCTOR' && row.doctor && row.doctor.userId !== actor.userId) {
      throw new NotFoundException('Draft prescription not found');
    }
  }

  /** A doctor only sees drafts written for them (prescription.doctor is the caller). */
  private ownerScope(actor: OpsActor): Record<string, unknown> {
    return actor.role.toUpperCase() === 'DOCTOR' ? { doctor: { userId: actor.userId } } : {};
  }

  /**
   * Puts an approved prescription on the pharmacy desk. The approval itself is already committed,
   * so a desk failure must not turn the request into an error: retry once, then log it. The desk
   * re-syncs its queue on the next listing, and approving again re-attempts the publish.
   */
  private async publishSafely(id: string, clinicId: string): Promise<void> {
    for (let attempt = 1; attempt <= PUBLISH_ATTEMPTS; attempt++) {
      try {
        await this.pharmacyService.publishApprovedPrescription(id, clinicId);
        return;
      } catch (error) {
        if (attempt < PUBLISH_ATTEMPTS) continue;
        void this.loggingService?.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'Approved draft could not be published to the pharmacy desk',
          SOURCE,
          {
            prescriptionId: id,
            clinicId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }
  }

  private assertTreatingDoctor(row: PrescriptionLiteRow, actor: OpsActor): void {
    if (actor.role.toUpperCase() !== 'DOCTOR') {
      throw new ForbiddenException('Only the doctor can approve or return a draft prescription');
    }
    if (row.doctor && row.doctor.userId !== actor.userId) {
      throw new ForbiddenException('This draft belongs to another doctor');
    }
  }

  /**
   * The draftSnapshot change for a resubmit: the returned snapshot (kept for the diff) with the
   * assistant's note; a previous note is dropped. No write when there is nothing to change.
   */
  private resubmitNoteUpdate(
    snapshot: unknown,
    note?: string
  ): { draftSnapshot?: Record<string, unknown> } {
    const text = note?.trim();
    const hasOldNote = resubmitNoteOf(snapshot) !== null;
    if (!text && !hasOldNote) return {};
    const base =
      snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? { ...(snapshot as Record<string, unknown>) }
        : {};
    delete base['resubmitNote'];
    delete base['resubmittedAt'];
    return {
      draftSnapshot: text
        ? { ...base, resubmitNote: text, resubmittedAt: new Date().toISOString() }
        : base,
    };
  }

  private snapshotOf(row: PrescriptionLiteRow): Record<string, unknown> {
    return {
      takenAt: new Date().toISOString(),
      diagnosis: row.diagnosis,
      notes: row.notes ?? null,
      items: (row.items ?? []).map(item => ({
        medicineId: item.medicineId,
        medicineName: item.medicine?.name ?? null,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        quantity: item.quantity,
        instructions: item.instructions,
      })),
    };
  }

  private async toResponses(rows: PrescriptionLiteRow[]): Promise<RxDraftResponse[]> {
    const authorIds = [
      ...new Set(rows.map(r => r.draftedByUserId).filter((v): v is string => !!v)),
    ];
    const authors = authorIds.length
      ? await this.ops.read((client: OpsClient) =>
          client.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true, firstName: true, lastName: true },
          })
        )
      : [];
    const names = new Map(authors.map(a => [a.id, displayName(a)]));
    return rows.map(r => ({
      id: r.id,
      prescriptionNumber: r.prescriptionNumber ?? null,
      status: r.status,
      patientId: r.patientId,
      patientName: displayName(r.patient?.user ?? null),
      diagnosis: r.diagnosis,
      notes: r.notes ?? null,
      draftedByUserId: r.draftedByUserId,
      draftedByName: r.draftedByUserId ? (names.get(r.draftedByUserId) ?? null) : null,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      returnedAt: r.returnedAt ? r.returnedAt.toISOString() : null,
      returnNote: r.returnNote,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      items: (r.items ?? []).map(item => ({
        id: item.id,
        medicineId: item.medicineId,
        medicineName: item.medicine?.name ?? null,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        quantity: item.quantity,
        instructions: item.instructions,
      })),
      returnedSnapshot: r.draftSnapshot ?? null,
      resubmitNote: resubmitNoteOf(r.draftSnapshot),
    }));
  }
}
