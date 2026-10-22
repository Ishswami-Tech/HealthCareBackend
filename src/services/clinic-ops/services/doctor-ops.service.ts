/**
 * Doctor Ops Service
 * @module ClinicOps
 * @description Investigation (lab / imaging) orders raised by the doctor, and per-account
 * favourites of the doctor / assistant (replaces the device-local copy).
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { assertPatientInClinic } from './clinic-scope.util';
import {
  displayName,
  type DoctorFavouriteRow,
  type InvestigationOrderRow,
} from '../clinic-ops.types';
import type {
  BulkFavouritesDto,
  CreateInvestigationOrderDto,
  UpdateInvestigationStatusDto,
  UpsertFavouriteDto,
} from '../dto/clinic-ops.dto';

export interface InvestigationResponse {
  id: string;
  patientId: string;
  patientName: string;
  appointmentId: string | null;
  visitId: string | null;
  tests: Array<{ name: string; kind: string }>;
  urgency: string;
  labDestination: string | null;
  notes: string | null;
  status: string;
  orderedAt: string;
}

export interface FavouriteResponse {
  id: string;
  kind: string;
  itemKey: string;
  label: string;
  payload: unknown;
  sortOrder: number;
}

const STATUS_FLOW: Record<string, string[]> = {
  ORDERED: ['SAMPLE_COLLECTED', 'RESULT_READY', 'CANCELLED'],
  SAMPLE_COLLECTED: ['RESULT_READY', 'CANCELLED'],
  RESULT_READY: [],
  CANCELLED: [],
};

@Injectable()
export class DoctorOpsService {
  constructor(private readonly ops: OpsDbService) {}

  // ------------------------------------------------------------------ investigations

  async createInvestigation(
    dto: CreateInvestigationOrderDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<InvestigationResponse> {
    const doctor = await this.ops.read(client =>
      client.doctor.findFirst({
        where: { userId: actor.userId, clinics: { some: { clinicId } } },
      })
    );
    if (!doctor) {
      throw new ForbiddenException('Only a doctor of this clinic can order investigations');
    }
    await this.ops.read(async client => {
      await assertPatientInClinic(client, dto.patientId, clinicId);
      // A linked visit / appointment must be this patient's, in this clinic.
      if (dto.visitId) {
        const visit = await client.patientVisit.findFirst({
          where: { id: dto.visitId, clinicId, patientId: dto.patientId },
          select: { id: true, appointmentId: true },
        });
        if (!visit) throw new NotFoundException('Visit not found for this patient');
        if (dto.appointmentId && visit.appointmentId && visit.appointmentId !== dto.appointmentId) {
          throw new BadRequestException('The visit belongs to a different appointment');
        }
      }
      if (dto.appointmentId) {
        const appointment = await client.appointment.findFirst({
          where: { id: dto.appointmentId, clinicId, patientId: dto.patientId },
          select: { id: true },
        });
        if (!appointment) throw new NotFoundException('Appointment not found for this patient');
      }
    });
    const row = await this.ops.write(
      client =>
        client.investigationOrder.create({
          data: {
            clinicId,
            patientId: dto.patientId,
            doctorId: doctor.id,
            visitId: dto.visitId ?? null,
            appointmentId: dto.appointmentId ?? null,
            tests: dto.tests.map(t => ({ name: t.name.trim(), kind: t.kind ?? 'LAB' })),
            urgency: dto.urgency ?? 'ROUTINE',
            labDestination: dto.labDestination ?? null,
            notes: dto.notes ?? null,
            status: 'ORDERED',
          },
        }),
      { actor, clinicId, resourceType: 'INVESTIGATION_ORDER', operation: 'CREATE' }
    );
    return (await this.toInvestigations([row]))[0] as InvestigationResponse;
  }

  async listInvestigations(
    clinicId: string,
    actor: OpsActor,
    filter: { patientId?: string; status?: string }
  ): Promise<InvestigationResponse[]> {
    const role = actor.role.toUpperCase();
    const where: Record<string, unknown> = { clinicId };
    if (filter.patientId) where['patientId'] = filter.patientId;
    if (filter.status) where['status'] = filter.status.toUpperCase();
    if (role === 'PATIENT') {
      const patients = await this.ops.read(client =>
        client.patient.findMany({ where: { userId: actor.userId }, select: { id: true } })
      );
      where['patientId'] = { in: patients.map(p => p.id) };
    }
    const rows = await this.ops.read(client =>
      client.investigationOrder.findMany({ where, orderBy: { orderedAt: 'desc' }, take: 200 })
    );
    return this.toInvestigations(rows);
  }

  async setInvestigationStatus(
    id: string,
    dto: UpdateInvestigationStatusDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<InvestigationResponse> {
    const row = await this.ops.read(client =>
      client.investigationOrder.findFirst({ where: { id, clinicId } })
    );
    if (!row) throw new NotFoundException('Order not found');
    if (!(STATUS_FLOW[row.status] ?? []).includes(dto.status)) {
      throw new BadRequestException(`Cannot move an order from ${row.status} to ${dto.status}`);
    }
    const updated = await this.ops.write(
      client => client.investigationOrder.update({ where: { id }, data: { status: dto.status } }),
      {
        actor,
        clinicId,
        resourceType: 'INVESTIGATION_ORDER',
        operation: 'SET_STATUS',
        resourceId: id,
      }
    );
    return (await this.toInvestigations([updated]))[0] as InvestigationResponse;
  }

  // ------------------------------------------------------------------ favourites

  async listFavourites(actor: OpsActor, kind?: string): Promise<FavouriteResponse[]> {
    const rows = await this.ops.read(client =>
      client.doctorFavourite.findMany({
        where: { userId: actor.userId, ...(kind ? { kind: kind.toUpperCase() } : {}) },
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      })
    );
    return rows.map(r => this.toFavourite(r));
  }

  async upsertFavourite(
    dto: UpsertFavouriteDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<FavouriteResponse> {
    const row = await this.ops.write(
      client =>
        client.doctorFavourite.upsert({
          where: {
            userId_kind_itemKey: { userId: actor.userId, kind: dto.kind, itemKey: dto.itemKey },
          },
          create: {
            userId: actor.userId,
            clinicId,
            kind: dto.kind,
            itemKey: dto.itemKey,
            label: dto.label,
            payload: dto.payload ?? null,
            sortOrder: dto.sortOrder ?? 0,
          },
          update: {
            label: dto.label,
            payload: dto.payload ?? null,
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          },
        }),
      { actor, clinicId, resourceType: 'DOCTOR_FAVOURITE', operation: 'UPSERT' }
    );
    return this.toFavourite(row);
  }

  /** One-off import of the device-local favourites; existing server rows win nothing - they are updated. */
  async bulkUpsert(
    dto: BulkFavouritesDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<FavouriteResponse[]> {
    for (const item of dto.items) await this.upsertFavourite(item, clinicId, actor);
    return this.listFavourites(actor);
  }

  async removeFavourite(
    id: string,
    clinicId: string,
    actor: OpsActor
  ): Promise<{ id: string; deleted: boolean }> {
    const result = await this.ops.write(
      client => client.doctorFavourite.deleteMany({ where: { id, userId: actor.userId } }),
      { actor, clinicId, resourceType: 'DOCTOR_FAVOURITE', operation: 'DELETE', resourceId: id }
    );
    if (result.count !== 1) throw new NotFoundException('Favourite not found');
    return { id, deleted: true };
  }

  // ------------------------------------------------------------------ helpers

  private toFavourite(r: DoctorFavouriteRow): FavouriteResponse {
    return {
      id: r.id,
      kind: r.kind,
      itemKey: r.itemKey,
      label: r.label,
      payload: r.payload ?? null,
      sortOrder: r.sortOrder,
    };
  }

  private async toInvestigations(rows: InvestigationOrderRow[]): Promise<InvestigationResponse[]> {
    if (!rows.length) return [];
    const patients = await this.ops.read(client =>
      client.patient.findMany({
        where: { id: { in: [...new Set(rows.map(r => r.patientId))] } },
        select: { id: true, user: { select: { name: true, firstName: true, lastName: true } } },
      })
    );
    const names = new Map(patients.map(p => [p.id, displayName(p.user)]));
    return rows.map(r => ({
      id: r.id,
      patientId: r.patientId,
      patientName: names.get(r.patientId) ?? 'Unknown',
      appointmentId: r.appointmentId,
      visitId: r.visitId,
      tests: Array.isArray(r.tests) ? (r.tests as Array<{ name: string; kind: string }>) : [],
      urgency: r.urgency,
      labDestination: r.labDestination,
      notes: r.notes,
      status: r.status,
      orderedAt: r.orderedAt.toISOString(),
    }));
  }
}
