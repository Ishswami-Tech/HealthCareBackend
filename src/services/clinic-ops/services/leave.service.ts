/**
 * Leave & Holiday Service
 * @module ClinicOps
 * @description Staff / doctor leave requests with a clinic-admin approval trail, plus the clinic
 * holiday / closure calendar. Approving a doctor's leave blocks the calendar and reports how many
 * booked appointments are affected so the admin can notify those patients.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { LogLevel, LogType } from '@core/types';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import { assertLocationsInClinic, assertStaffInClinic } from './clinic-scope.util';
import { leaveHolidayId } from './ops-integrity.util';
import {
  addDays,
  displayName,
  parseDay,
  todayIstKey,
  type AppointmentLiteRow,
  type ClinicHolidayRow,
  type LeaveRequestRow,
  type OpsClient,
} from '../clinic-ops.types';
import type {
  CreateClinicHolidayDto,
  CreateLeaveRequestDto,
  DecideLeaveRequestDto,
  UpdateClinicHolidayDto,
} from '../dto/clinic-ops.dto';

const SOURCE = 'LeaveService';
const BOOKED_STATUSES = ['SCHEDULED', 'CONFIRMED', 'PENDING', 'FOLLOW_UP_SCHEDULED'];
const DOCTOR_ROLES = new Set(['DOCTOR', 'ASSISTANT_DOCTOR']);

export interface LeaveRequestResponse {
  id: string;
  userId: string;
  requesterName: string;
  requesterRole: string;
  locationId: string | null;
  kind: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  status: string;
  coverUserId: string | null;
  coverName: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  impactedAppointmentCount: number;
  patientsNotifiedAt: string | null;
  createdAt: string;
}

export interface LeaveImpactResponse {
  leaveRequestId: string;
  impactedAppointmentCount: number;
  appointments: Array<{
    appointmentId: string;
    date: string;
    time: string;
    type: string;
    status: string;
    patientName: string;
  }>;
}

export interface ClinicHolidayResponse {
  id: string;
  title: string;
  kind: string;
  locationId: string | null;
  startDate: string;
  endDate: string;
  notifyPatients: boolean;
  notifiedCount: number;
  messageTemplate: string | null;
  createdAt: string;
}

const dayString = (date: Date): string => date.toISOString().slice(0, 10);
const CANCELLABLE_STATUSES = ['PENDING', 'APPROVED'];
const DOCTOR_LEAVE_HOLIDAY_TITLE = 'Doctor on leave';

/** True when a holiday starting on `startKey` (YYYY-MM-DD) starts before `todayKey` (IST day). */
export function holidayStartsInPast(startKey: string, todayKey: string): boolean {
  return startKey < todayKey;
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly audit: ClinicAuditService,
    private readonly cacheService: CacheService
  ) {}

  // ------------------------------------------------------------------ requests

  async createRequest(
    dto: CreateLeaveRequestDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<LeaveRequestResponse> {
    const { start, end } = this.parseRange(dto.startDate, dto.endDate);
    const kind = dto.kind ?? 'LEAVE';
    if (kind !== 'LEAVE' && (!dto.startTime || !dto.endTime)) {
      throw new BadRequestException('startTime and endTime are required for half-day / break');
    }
    if (dto.startTime && dto.endTime && dto.startTime >= dto.endTime) {
      throw new BadRequestException('endTime must be after startTime');
    }
    if (dto.coverUserId === actor.userId) {
      throw new BadRequestException('You cannot cover your own shift');
    }
    const { coverUserId, locationId } = dto;
    await this.ops.read(async client => {
      if (coverUserId) await assertStaffInClinic(client, coverUserId, clinicId);
      if (locationId) await assertLocationsInClinic(client, [locationId], clinicId);
    });

    const impacted = DOCTOR_ROLES.has(actor.role.toUpperCase())
      ? await this.countImpacted(actor.userId, clinicId, start, end)
      : 0;

    const row = await this.ops.write(
      client =>
        client.leaveRequest.create({
          data: {
            clinicId,
            locationId: dto.locationId ?? null,
            userId: actor.userId,
            requesterRole: actor.role.toUpperCase(),
            kind,
            startDate: start,
            endDate: end,
            startTime: dto.startTime ?? null,
            endTime: dto.endTime ?? null,
            reason: dto.reason?.trim() || null,
            coverUserId: dto.coverUserId ?? null,
            impactedAppointmentCount: impacted,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'LEAVE_REQUEST',
        operation: 'CREATE',
        details: { kind, startDate: dto.startDate, endDate: dto.endDate },
      }
    );

    await this.eventService.emit('clinic-ops.leave.requested', {
      leaveRequestId: row.id,
      clinicId,
      userId: actor.userId,
      requesterRole: row.requesterRole,
      startDate: dayString(start),
      endDate: dayString(end),
    });
    return (await this.toResponses([row]))[0] as LeaveRequestResponse;
  }

  async listMine(clinicId: string, actor: OpsActor): Promise<LeaveRequestResponse[]> {
    const rows = await this.ops.read(client =>
      client.leaveRequest.findMany({
        where: { clinicId, userId: actor.userId },
        orderBy: { startDate: 'desc' },
        take: 100,
      })
    );
    return this.toResponses(rows);
  }

  async listForAdmin(
    clinicId: string,
    filter: { status?: string; from?: string; to?: string; userId?: string }
  ): Promise<LeaveRequestResponse[]> {
    const where: Record<string, unknown> = { clinicId };
    if (filter.status) where['status'] = filter.status.toUpperCase();
    if (filter.userId) where['userId'] = filter.userId;
    const from = parseDay(filter.from);
    const to = parseDay(filter.to);
    if (from) where['endDate'] = { gte: from };
    if (to) where['startDate'] = { lte: to };
    const rows = await this.ops.read(client =>
      client.leaveRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
        take: 200,
      })
    );
    return this.toResponses(rows);
  }

  async getImpact(id: string, clinicId: string): Promise<LeaveImpactResponse> {
    const row = await this.findRequest(id, clinicId);
    const appointments = await this.loadImpacted(row.userId, clinicId, row.startDate, row.endDate);
    return {
      leaveRequestId: row.id,
      impactedAppointmentCount: appointments.length,
      appointments: appointments.map(appt => ({
        appointmentId: appt.id,
        date: dayString(appt.date),
        time: appt.time,
        type: appt.type,
        status: appt.status,
        patientName: displayName(appt.patient?.user ?? null),
      })),
    };
  }

  async decide(
    id: string,
    clinicId: string,
    decision: 'APPROVED' | 'DECLINED',
    dto: DecideLeaveRequestDto,
    actor: OpsActor
  ): Promise<LeaveRequestResponse> {
    const existing = await this.findRequest(id, clinicId);
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(
        `Only a pending request can be decided (it is ${existing.status})`
      );
    }
    if (existing.userId === actor.userId) {
      throw new ForbiddenException('You cannot decide your own leave request');
    }

    const isDoctorLeave = DOCTOR_ROLES.has(existing.requesterRole);
    const impacted =
      decision === 'APPROVED' && isDoctorLeave
        ? await this.loadImpacted(existing.userId, clinicId, existing.startDate, existing.endDate)
        : [];
    const notify = decision === 'APPROVED' && isDoctorLeave && dto.notifyPatients !== false;

    const updated = await this.ops.write(
      async client => {
        const claimed = await client.leaveRequest.updateMany({
          where: { id, clinicId, status: 'PENDING' },
          data: {
            status: decision,
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: dto.note?.trim() || null,
            impactedAppointmentCount: impacted.length,
            ...(notify ? { patientsNotifiedAt: new Date() } : {}),
          },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('This leave request was already decided');
        }
        if (decision === 'APPROVED' && isDoctorLeave) {
          // Block the calendar so no new bookings land on the leave days.
          await client.clinicHoliday.create({
            data: {
              id: leaveHolidayId(id),
              clinicId,
              locationId: existing.locationId,
              title: DOCTOR_LEAVE_HOLIDAY_TITLE,
              kind: 'DOCTOR_LEAVE',
              startDate: existing.startDate,
              endDate: existing.endDate,
              notifyPatients: notify,
              notifiedCount: notify ? impacted.length : 0,
              createdById: actor.userId,
            },
          });
        }
        return (await client.leaveRequest.findFirst({ where: { id } })) as LeaveRequestRow;
      },
      {
        actor,
        clinicId,
        resourceType: 'LEAVE_REQUEST',
        operation: decision === 'APPROVED' ? 'APPROVE' : 'DECLINE',
        resourceId: id,
        details: { impacted: impacted.length },
      }
    );

    await this.audit.record(clinicId, { type: 'LEAVE_REQUEST', id }, `LEAVE_${decision}`, actor, {
      requesterId: existing.userId,
      note: dto.note ?? null,
    });
    await this.eventService.emit('clinic-ops.leave.decided', {
      leaveRequestId: id,
      clinicId,
      userId: existing.userId,
      decision,
      note: dto.note ?? null,
      notifyPatients: notify,
      affectedAppointmentIds: notify ? impacted.map(a => a.id) : [],
    });
    await this.loggingService.log(LogType.SYSTEM, LogLevel.INFO, `Leave ${decision}`, SOURCE, {
      leaveRequestId: id,
      clinicId,
    });
    await this.refreshAvailability(clinicId);
    return (await this.toResponses([updated]))[0] as LeaveRequestResponse;
  }

  async cancel(id: string, clinicId: string, actor: OpsActor): Promise<LeaveRequestResponse> {
    const existing = await this.findRequest(id, clinicId);
    if (existing.userId !== actor.userId && actor.role.toUpperCase() !== 'CLINIC_ADMIN') {
      throw new ForbiddenException(
        'Only the requester or a clinic admin can cancel a leave request'
      );
    }
    if (!CANCELLABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `A ${existing.status.toLowerCase()} request cannot be cancelled`
      );
    }
    const updated = await this.ops.transaction(async client => {
      // Status guard in the write itself: a decline / cancel racing this one leaves 0 rows.
      const claimed = await client.leaveRequest.updateMany({
        where: { id, clinicId, status: { in: CANCELLABLE_STATUSES } },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This leave request was already decided or cancelled');
      }
      // Cancelling an approved doctor leave frees the calendar block the approval created.
      if (existing.status === 'APPROVED' && DOCTOR_ROLES.has(existing.requesterRole)) {
        await this.releaseLeaveHoliday(client, existing, clinicId);
      }
      return (await client.leaveRequest.findFirst({ where: { id } })) as LeaveRequestRow;
    });
    await this.audit.record(clinicId, { type: 'LEAVE_REQUEST', id }, 'LEAVE_CANCELLED', actor, {
      previousStatus: existing.status,
    });
    await this.refreshAvailability(clinicId);
    return (await this.toResponses([updated]))[0] as LeaveRequestResponse;
  }

  /**
   * Soft-deletes the DOCTOR_LEAVE block of an approved leave: by its deterministic id, else (blocks
   * created before the id was derived) the single block matching the approval exactly.
   */
  private async releaseLeaveHoliday(
    client: OpsClient,
    leave: LeaveRequestRow,
    clinicId: string
  ): Promise<void> {
    const now = new Date();
    const byId = await client.clinicHoliday.updateMany({
      where: { id: leaveHolidayId(leave.id), clinicId, deletedAt: null },
      data: { deletedAt: now },
    });
    if (byId.count > 0) return;
    const legacy = await client.clinicHoliday.findMany({
      where: {
        clinicId,
        kind: 'DOCTOR_LEAVE',
        title: DOCTOR_LEAVE_HOLIDAY_TITLE,
        locationId: leave.locationId,
        startDate: leave.startDate,
        endDate: leave.endDate,
        deletedAt: null,
        ...(leave.decidedById ? { createdById: leave.decidedById } : {}),
      },
      select: { id: true },
      take: 2,
    });
    // Two identical blocks cannot be told apart (two doctors, same days): leave both to the admin.
    if (legacy.length !== 1) return;
    await client.clinicHoliday.updateMany({
      where: { id: (legacy[0] as { id: string }).id, clinicId, deletedAt: null },
      data: { deletedAt: now },
    });
  }

  // ------------------------------------------------------------------ holidays

  async listHolidays(
    clinicId: string,
    filter: { from?: string; to?: string; locationId?: string }
  ): Promise<ClinicHolidayResponse[]> {
    const where: Record<string, unknown> = { clinicId, deletedAt: null };
    const from = parseDay(filter.from);
    const to = parseDay(filter.to);
    if (from) where['endDate'] = { gte: from };
    if (to) where['startDate'] = { lte: to };
    if (filter.locationId) where['OR'] = [{ locationId: filter.locationId }, { locationId: null }];
    const rows = await this.ops.read(client =>
      client.clinicHoliday.findMany({ where, orderBy: { startDate: 'asc' }, take: 300 })
    );
    return rows.map(r => this.toHoliday(r));
  }

  async createHoliday(
    dto: CreateClinicHolidayDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<ClinicHolidayResponse> {
    const { start, end } = this.parseRange(dto.startDate, dto.endDate);
    this.assertHolidayNotPast(start);
    const { locationId } = dto;
    if (locationId) {
      await this.ops.read(client => assertLocationsInClinic(client, [locationId], clinicId));
    }
    await this.assertNoDuplicateHoliday(clinicId, {
      locationId: locationId ?? null,
      kind: dto.kind ?? 'HOLIDAY',
      start,
      end,
    });
    const notify = dto.notifyPatients !== false;
    const affected = notify
      ? await this.affectedByClosure(clinicId, start, end, dto.locationId)
      : [];
    const row = await this.ops.write(
      client =>
        client.clinicHoliday.create({
          data: {
            clinicId,
            locationId: dto.locationId ?? null,
            title: dto.title.trim(),
            kind: dto.kind ?? 'HOLIDAY',
            startDate: start,
            endDate: end,
            notifyPatients: notify,
            notifiedCount: affected.length,
            messageTemplate: dto.messageTemplate?.trim() || null,
            createdById: actor.userId,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'CLINIC_HOLIDAY',
        operation: 'CREATE',
        details: { title: dto.title, startDate: dto.startDate, endDate: dto.endDate },
      }
    );
    await this.eventService.emit('clinic-ops.holiday.created', {
      holidayId: row.id,
      clinicId,
      title: row.title,
      startDate: dayString(start),
      endDate: dayString(end),
      notifyPatients: notify,
      affectedAppointmentIds: affected.map(a => a.id),
    });
    await this.refreshAvailability(clinicId);
    return this.toHoliday(row);
  }

  async updateHoliday(
    id: string,
    dto: UpdateClinicHolidayDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<ClinicHolidayResponse> {
    const existing = await this.ops.read(client =>
      client.clinicHoliday.findFirst({ where: { id, clinicId, deletedAt: null } })
    );
    if (!existing) throw new NotFoundException('Holiday not found');
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data['title'] = dto.title.trim();
    if (dto.kind !== undefined) data['kind'] = dto.kind;
    if (dto.notifyPatients !== undefined) data['notifyPatients'] = dto.notifyPatients;
    if (dto.messageTemplate !== undefined) data['messageTemplate'] = dto.messageTemplate.trim();
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const { start, end } = this.parseRange(
        dto.startDate ?? dayString(existing.startDate),
        dto.endDate ?? dayString(existing.endDate)
      );
      // Moving the start is checked against today; an ongoing holiday may still change its end.
      if (start.getTime() !== existing.startDate.getTime()) this.assertHolidayNotPast(start);
      data['startDate'] = start;
      data['endDate'] = end;
    }
    if (data['startDate'] !== undefined || data['kind'] !== undefined) {
      await this.assertNoDuplicateHoliday(
        clinicId,
        {
          locationId: existing.locationId ?? null,
          kind: typeof data['kind'] === 'string' ? data['kind'] : existing.kind,
          start: (data['startDate'] as Date | undefined) ?? existing.startDate,
          end: (data['endDate'] as Date | undefined) ?? existing.endDate,
        },
        id
      );
    }
    const row = await this.ops.write(
      async client => {
        await client.clinicHoliday.updateMany({ where: { id, clinicId }, data });
        return (await client.clinicHoliday.findFirst({ where: { id } })) as ClinicHolidayRow;
      },
      {
        actor,
        clinicId,
        resourceType: 'CLINIC_HOLIDAY',
        operation: 'UPDATE',
        resourceId: id,
        details: { fields: Object.keys(data) },
      }
    );
    await this.refreshAvailability(clinicId);
    return this.toHoliday(row);
  }

  async deleteHoliday(id: string, clinicId: string, actor: OpsActor): Promise<{ id: string }> {
    const result = await this.ops.write(
      client =>
        client.clinicHoliday.updateMany({
          where: { id, clinicId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
      { actor, clinicId, resourceType: 'CLINIC_HOLIDAY', operation: 'DELETE', resourceId: id }
    );
    if (result.count !== 1) throw new NotFoundException('Holiday not found');
    await this.refreshAvailability(clinicId);
    return { id };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Holidays and approved leave close days in the slot grid; drop the clinic's cached availability
   * so patients and the desk stop seeing the old free slots straight away. Best effort only.
   */
  private async refreshAvailability(clinicId: string): Promise<void> {
    try {
      await this.cacheService.invalidateClinicAvailabilityCache(clinicId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Could not clear cached availability after a calendar change',
        'LeaveService.refreshAvailability',
        { clinicId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /** A holiday cannot start before today (IST); today itself is allowed. */
  private assertHolidayNotPast(start: Date): void {
    if (holidayStartsInPast(dayString(start), todayIstKey())) {
      throw new BadRequestException('A holiday cannot start in the past');
    }
  }

  /** Same clinic, location, kind and exact date range as a live holiday is a 409. */
  private async assertNoDuplicateHoliday(
    clinicId: string,
    holiday: { locationId: string | null; kind: string; start: Date; end: Date },
    excludeId?: string
  ): Promise<void> {
    const duplicate = await this.ops.read(client =>
      client.clinicHoliday.findFirst({
        where: {
          clinicId,
          deletedAt: null,
          locationId: holiday.locationId,
          kind: holiday.kind,
          startDate: holiday.start,
          endDate: holiday.end,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })
    );
    if (duplicate) {
      throw new ConflictException('This holiday is already on the calendar for these dates');
    }
  }

  private parseRange(startDate: string, endDate: string): { start: Date; end: Date } {
    const start = parseDay(startDate.slice(0, 10));
    const end = parseDay(endDate.slice(0, 10));
    if (!start || !end) throw new BadRequestException('startDate / endDate must be valid dates');
    if (end < start) throw new BadRequestException('endDate cannot be before startDate');
    return { start, end };
  }

  private async findRequest(id: string, clinicId: string): Promise<LeaveRequestRow> {
    const row = await this.ops.read(client =>
      client.leaveRequest.findFirst({ where: { id, clinicId } })
    );
    if (!row) throw new NotFoundException('Leave request not found');
    return row;
  }

  private async doctorIdOf(client: OpsClient, userId: string): Promise<string | null> {
    const doctor = await client.doctor.findFirst({ where: { userId }, select: { id: true } });
    return doctor?.id ?? null;
  }

  private async loadImpacted(
    userId: string,
    clinicId: string,
    start: Date,
    end: Date
  ): Promise<AppointmentLiteRow[]> {
    return this.ops.read(async client => {
      const doctorId = await this.doctorIdOf(client, userId);
      if (!doctorId) return [];
      return client.appointment.findMany({
        where: {
          clinicId,
          doctorId,
          status: { in: BOOKED_STATUSES },
          date: { gte: start, lt: addDays(end, 1) },
        },
        select: {
          id: true,
          date: true,
          time: true,
          type: true,
          status: true,
          patient: {
            select: { id: true, user: { select: { name: true, firstName: true, lastName: true } } },
          },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: 500,
      });
    });
  }

  private async countImpacted(
    userId: string,
    clinicId: string,
    start: Date,
    end: Date
  ): Promise<number> {
    return (await this.loadImpacted(userId, clinicId, start, end)).length;
  }

  private affectedByClosure(
    clinicId: string,
    start: Date,
    end: Date,
    locationId?: string
  ): Promise<AppointmentLiteRow[]> {
    return this.ops.read(client =>
      client.appointment.findMany({
        where: {
          clinicId,
          status: { in: BOOKED_STATUSES },
          date: { gte: start, lt: addDays(end, 1) },
          ...(locationId ? { locationId } : {}),
        },
        select: { id: true },
        take: 2000,
      })
    );
  }

  private async toResponses(rows: LeaveRequestRow[]): Promise<LeaveRequestResponse[]> {
    const userIds = [
      ...new Set(rows.flatMap(r => [r.userId, r.coverUserId].filter((v): v is string => !!v))),
    ];
    const users = userIds.length
      ? await this.ops.read(client =>
          client.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, firstName: true, lastName: true },
          })
        )
      : [];
    const names = new Map(users.map(u => [u.id, displayName(u)]));
    return rows.map(r => ({
      id: r.id,
      userId: r.userId,
      requesterName: names.get(r.userId) ?? 'Unknown',
      requesterRole: r.requesterRole,
      locationId: r.locationId,
      kind: r.kind,
      startDate: dayString(r.startDate),
      endDate: dayString(r.endDate),
      startTime: r.startTime,
      endTime: r.endTime,
      reason: r.reason,
      status: r.status,
      coverUserId: r.coverUserId,
      coverName: r.coverUserId ? (names.get(r.coverUserId) ?? null) : null,
      decidedById: r.decidedById,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      impactedAppointmentCount: r.impactedAppointmentCount,
      patientsNotifiedAt: r.patientsNotifiedAt ? r.patientsNotifiedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private toHoliday(r: ClinicHolidayRow): ClinicHolidayResponse {
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      locationId: r.locationId,
      startDate: dayString(r.startDate),
      endDate: dayString(r.endDate),
      notifyPatients: r.notifyPatients,
      notifiedCount: r.notifiedCount,
      messageTemplate: r.messageTemplate,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
