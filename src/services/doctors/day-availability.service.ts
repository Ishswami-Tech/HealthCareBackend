/**
 * Dated OPD-window overrides for a single doctor day, on top of the static weekly
 * Doctor.workingHours (dynamic availability, L1).
 *
 * A doctor (or the clinic admin) can say "30th Oct: open only 12:00–15:00" (or
 * "closed for the day" = empty sessions) for a specific date, with an optional
 * emergency reason (going somewhere, family matter, illness). While an active
 * override exists, the availability engine (CoreAppointmentService.getDoctorAvailability)
 * uses the override's sessions instead of the weekly blocks for that doctor+date,
 * and every booking/slot path inherits it because they all call that one lookup.
 *
 * Storage: `doctor_day_availability` (DoctorDayAvailability). The date column is a
 * Postgres DATE (Prisma DateTime @db.Date, returned as UTC midnight) compared on its
 * IST YYYY-MM-DD day key — same convention as clinic_holidays / leave_requests.
 * At most one active (deletedAt IS NULL) override per doctor+date(+location): a new
 * override for the same key replaces (supersedes) the older rows, which are soft-deleted.
 *
 * Cache: availability grids are registered under the `doctor_availability` collection
 * tag and the `doctor:<doctorId>` entity tag, with a 10s TTL (AppointmentsService
 * .getDoctorAvailability). On create/cancel we drop both clinic-scoped and the doctor's
 * own tags, and emit the same `doctor.availability.changed` event the working-hours /
 * appointment flows already use so connected clients refetch.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { Prisma } from '@infrastructure/database/prisma/generated/client';
import { LogType, LogLevel } from '@core/types';
import { nowIso } from '@utils/date-time.util';
import { weeklySessionsForDay } from './day-availability-sessions.util';
import { ReassignmentCascadeService } from './reassignment-cascade.service';
import { AppointmentsService } from '@services/appointments/appointments.service';

export type DayAvailabilityActor = {
  userId: string;
  role: string;
  clinicId?: string;
};

export interface DoctorDayAvailabilityResponse {
  id: string;
  doctorId: string;
  clinicId: string;
  locationId: string | null;
  /** IST calendar day, YYYY-MM-DD. */
  date: string;
  sessions: Array<{ start: string; end: string }>;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Older superseded rows are soft-deleted; `deleted` is true only on the read path. */
  deleted: boolean;
}

export interface DayOverrideCreateInput {
  /** Doctor.id. */
  doctorId: string;
  /** IST calendar day, YYYY-MM-DD (today or later). */
  date: string;
  /** Per-day session blocks; `[]` = closed for the day. Times are HH:MM (24h). */
  sessions: unknown;
  /** Free-text emergency reason (going somewhere, family matter, illness, ...). */
  reason?: string | null;
  /** Optional: restrict the override to one clinic location. */
  locationId?: string | null;
}

const SESSION_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE = 'DayAvailabilityService';

/** Normalize an accepted block list; throws BadRequestException on malformed input. */
function normalizeSessions(value: unknown): Array<{ start: string; end: string }> {
  let blocks: unknown = Array.isArray(value) ? value : [];
  if (typeof value === 'string') {
    try {
      blocks = JSON.parse(value);
    } catch {
      throw new BadRequestException('sessions must be an array of { start, end } blocks');
    }
  }
  if (!Array.isArray(blocks)) {
    throw new BadRequestException(
      'sessions must be an array of { start, end } blocks (use [] to close the day)'
    );
  }
  if (blocks.length > 24) {
    throw new BadRequestException('At most 24 session blocks per day');
  }
  const parseTime = (raw: unknown, _label?: string): number | null => {
    if (typeof raw !== 'string') return null;
    const match = SESSION_TIME.exec(raw.trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const normalize = (raw: unknown, label: string): string | null => {
    const minutes = parseTime(raw, label);
    if (minutes === null) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };
  const normalized: Array<{ start: string; end: string }> = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      throw new BadRequestException('Each session must be an object { start, end }');
    }
    const record = block as Record<string, unknown>;
    const start = normalize(record['start'], 'sessions.start');
    const end = normalize(record['end'], 'sessions.end');
    if (!start || !end) {
      throw new BadRequestException('Session times must be HH:MM (24h)');
    }
    const startMinutes = parseTime(start, 'sessions.start');
    const endMinutes = parseTime(end, 'sessions.end');
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
      throw new BadRequestException('Session start must be before its end');
    }
    normalized.push({ start, end });
  }
  // No overlapping blocks: sort by start, a later block must start at or after the earliest
  // end of the blocks that began before it.
  const byStart = [...normalized]
    .map(w => ({
      startMinutes: parseTime(w.start, 's') ?? 0,
      endMinutes: parseTime(w.end, 'e') ?? 0,
    }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
  for (let i = 1; i < byStart.length; i += 1) {
    const current = byStart[i];
    if (!current) continue;
    const earliestEndBefore = Math.max(...byStart.slice(0, i).map(b => b.endMinutes));
    if (current.startMinutes < earliestEndBefore) {
      throw new BadRequestException('Session blocks must not overlap');
    }
  }
  return normalized;
}

@Injectable()
export class DayAvailabilityService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    private readonly eventService: EventService,
    private readonly reassignmentCascadeService: ReassignmentCascadeService,
    private readonly appointmentsService: AppointmentsService
  ) {}

  /**
   * Create (or replace) the dated OPD override for `doctorId` on `date`. If an active
   * override exists for the same doctor+date(+location), the older one is superseded
   * (soft-deleted) and the new one takes its place — replace, not 409.
   */
  async createDayOverride(
    input: DayOverrideCreateInput,
    actor: DayAvailabilityActor
  ): Promise<DoctorDayAvailabilityResponse> {
    const clinicId = actor.clinicId ?? '';
    if (!clinicId) throw new BadRequestException('Clinic context is required');

    // RBAC (mirror the doctor-profile / working-hours guard): the doctor edits their own
    // overrides; an admin edits any doctor in their clinic.
    await this.assertCanManageDoctor(input.doctorId, actor);

    // The engine, the cascade and every appointment row key the doctor by the Doctor ENTITY
    // id; the path id may be the doctor's user id. Normalize once so a user-id override can
    // never silently miss bookings / cascade targets. Fail-open: assistant doctors have no
    // Doctor row, so their own id is kept as-is.
    const entityDoctorId =
      (await this.appointmentsService.resolveDoctorEntityId(input.doctorId, clinicId)) ??
      input.doctorId;

    const dateKey = this.assertFutureDayKey(input.date);
    const sessions = normalizeSessions(input.sessions);
    const reason = input.reason?.trim() || null;

    // The effective windows BEFORE this write: the superseded override's sessions, else the
    // doctor's weekly blocks for the IST weekday — the L3 cascade compares against these to
    // find which slots the new override REMOVED.
    const oldSessions = await this.resolveOldSessions(
      entityDoctorId,
      clinicId,
      dateKey,
      input.locationId ?? null
    );

    const created = await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        // Supersede any active override for the same doctor+date(+location) first so a
        // doctor holds at most one live override per day (there is no @@unique — the
        // service owns deduplication, and history stays soft-deleted, not hard-deleted).
        const superseded = await tx.doctorDayAvailability.findMany({
          where: {
            doctorId: entityDoctorId,
            clinicId,
            date: this.dayKeyToDate(dateKey),
            locationId: input.locationId ?? null,
            deletedAt: null,
          },
          select: { id: true, sessions: true },
        });
        if (superseded.length > 0) {
          await tx.doctorDayAvailability.updateMany({
            where: { id: { in: superseded.map(row => row.id) } },
            data: { deletedAt: new Date() },
          });
        }
        return await tx.doctorDayAvailability.create({
          data: {
            doctorId: entityDoctorId,
            clinicId,
            locationId: input.locationId ?? null,
            date: this.dayKeyToDate(dateKey),
            sessions: sessions as Prisma.InputJsonValue,
            // sessions / reason / locationId / createdBy / date / doctorId / clinicId
            // are the write side of DoctorDayAvailability; Prisma types the Json field as
            // InputJsonValue.
            reason,
            createdBy: actor.userId,
          },
        });
      },
      {
        userId: actor.userId,
        clinicId,
        resourceType: 'DOCTOR_DAY_AVAILABILITY',
        operation: 'CREATE',
        resourceId: dateKey,
        userRole: actor.role,
        details: { doctorId: entityDoctorId, sessions: sessions.length, reason },
      }
    );

    await this.refreshAvailability(clinicId, entityDoctorId);

    // L3 cascade, fail-open: an override error is logged WARN and never rolls back or blocks
    // the availability write (the write above is already committed). Awaiting it keeps the
    // result deterministic: by the time the create response returns, safe-auto moves are
    // applied and PENDING proposals are recorded.
    await this.runReassignmentCascadeFailOpen({
      doctorId: entityDoctorId,
      clinicId,
      date: dateKey,
      newSessions: sessions,
      oldSessions,
      locationId: input.locationId ?? null,
      reason,
    });

    return this.toResponse(created);
  }

  /**
   * Active overrides for a doctor in a clinic, optionally bounded to `[from, to]` IST day
   * keys (YYYY-MM-DD inclusive). Without bounds: today through +31 days.
   */
  async listDayOverrides(
    doctorId: string,
    clinicId: string,
    actor: DayAvailabilityActor,
    from?: string,
    to?: string
  ): Promise<DoctorDayAvailabilityResponse[]> {
    if (!clinicId) throw new BadRequestException('Clinic context is required');
    await this.assertCanManageDoctor(doctorId, actor);

    // Same normalization as createDayOverride: rows are keyed by the Doctor entity id, while
    // the path id may be the doctor's user id. Fail-open (assistant doctors have no row).
    const entityDoctorId =
      (await this.appointmentsService.resolveDoctorEntityId(doctorId, clinicId)) ?? doctorId;

    const todayKey = this.todayDayKey();
    const rangeFrom = from ? this.assertDayKey(from) : todayKey;
    const rangeTo = to ? this.assertDayKey(to) : this.addDaysKey(todayKey, 31);

    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorDayAvailability.findMany({
        where: {
          doctorId: entityDoctorId,
          clinicId,
          deletedAt: null,
          date: {
            gte: this.dayKeyToDate(rangeFrom),
            lte: this.dayKeyToDate(rangeTo),
          },
        },
        orderBy: { date: 'asc' },
        take: 60,
      });
    });
    return (rows ?? []).map(row => this.toResponse(row));
  }

  /** Cancel (soft-delete) an active override. Only the owner-doctor / clinic admin may cancel. */
  async cancelDayOverride(
    id: string,
    clinicId: string,
    actor: DayAvailabilityActor
  ): Promise<DoctorDayAvailabilityResponse> {
    if (!clinicId) throw new BadRequestException('Clinic context is required');
    const existing = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorDayAvailability.findUnique({ where: { id } });
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Day override not found');
    }
    await this.assertCanManageDoctor(existing.doctorId, actor);

    const updated = await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctorDayAvailability.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
      },
      {
        userId: actor.userId,
        clinicId,
        resourceType: 'DOCTOR_DAY_AVAILABILITY',
        operation: 'CANCEL',
        resourceId: id,
        userRole: actor.role,
        details: { doctorId: existing.doctorId },
      }
    );

    await this.refreshAvailability(clinicId, existing.doctorId);

    // Cancelling restores the weekly windows; existing PENDING proposals are left for the
    // doctor / clinic-admin to finish (the visit is no longer stranded, but no auto-undo of
    // the safe-auto moves is attempted — keep it simple, log only).
    void this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      'Day override cancelled; any pending reassignment proposals are left for manual review',
      SOURCE,
      { clinicId, doctorId: existing.doctorId, overrideId: id }
    );

    return this.toResponse(updated);
  }

  /**
   * The L3 cascade after a fresh override: runs in the background so the availability write is
   * never rolled back; a cascade failure is logged WARN.
   */
  private async runReassignmentCascadeFailOpen(input: {
    doctorId: string;
    clinicId: string;
    date: string;
    newSessions: Array<{ start: string; end: string }>;
    oldSessions: Array<{ start: string; end: string }>;
    locationId: string | null;
    reason: string | null;
  }): Promise<void> {
    try {
      await this.reassignmentCascadeService.runDayOverrideCascade(input);
    } catch (error) {
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        'Reassignment cascade for a day override failed (fail-open; availability change stands)',
        SOURCE,
        {
          doctorId: input.doctorId,
          clinicId: input.clinicId,
          date: input.date,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * The effective OPD windows BEFORE a new override: an active same-key override's sessions
   * (the L1 rows about to be superseded), else the doctor's weekly workingHours for the IST
   * weekday. `[]` when nothing was open (no removal to cascade).
   */
  private async resolveOldSessions(
    doctorId: string,
    clinicId: string,
    dateKey: string,
    locationId: string | null
  ): Promise<Array<{ start: string; end: string }>> {
    try {
      const rows = await this.databaseService.executeHealthcareRead(async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctorDayAvailability.findMany({
          where: {
            doctorId,
            clinicId,
            date: this.dayKeyToDate(dateKey),
            locationId: locationId ?? null,
            deletedAt: null,
          },
          select: { sessions: true },
        });
      });
      const fromOverride = (rows ?? []).flatMap(row => this.parseSessionsJson(row.sessions) ?? []);
      if (fromOverride.length > 0) return fromOverride;
      const doctor = await this.databaseService.executeHealthcareRead(async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctor.findUnique({
          where: { id: doctorId },
          select: { workingHours: true },
        });
      });
      if (!doctor) return [];
      return weeklySessionsForDay(doctor.workingHours, dateKey);
    } catch (error) {
      // Fail open: no old windows means the cascade treats nothing as removed.
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        'Could not resolve the pre-override OPD windows; the cascade sees nothing removed',
        SOURCE,
        {
          doctorId,
          clinicId,
          dateKey,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /** Resolve a doctor by Doctor.id or the doctor's User.id inside a clinic. */
  private async assertCanManageDoctor(
    doctorId: string,
    actor: DayAvailabilityActor
  ): Promise<void> {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'CLINIC_ADMIN') {
      if (!actor.clinicId) throw new BadRequestException('Clinic context is required');
      await this.assertDoctorInClinic(doctorId, actor.clinicId);
      return;
    }
    if (actor.role === 'DOCTOR' || actor.role === 'ASSISTANT_DOCTOR') {
      const clinicId = actor.clinicId;
      if (!clinicId) throw new BadRequestException('Clinic context is required');
      // Own Doctor row, scoped to the session's clinic: a doctor who works at several
      // clinics may only manage overrides (and fire the L3 cascade) inside the clinic of
      // their current session, never in a foreign one. Mirrors resolveDoctorEntityId's
      // clinic-scoped lookup (doctor id OR the doctor's user id, linked to this clinic).
      const doctor = await this.databaseService.executeHealthcareRead(async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctor.findFirst({
          where: {
            OR: [{ id: doctorId }, { userId: doctorId }],
            clinics: { some: { clinicId } },
          },
          select: { id: true, userId: true },
        });
      });
      if (!doctor) throw new NotFoundException('Doctor not found in this clinic');
      if (doctor.id !== actor.userId && doctor.userId !== actor.userId) {
        throw new BadRequestException('Doctors can only manage their own day overrides');
      }
      return;
    }
    throw new BadRequestException('Insufficient permissions to manage day overrides');
  }

  /** The doctor must have a Doctor record that is assigned to the clinic. */
  private async assertDoctorInClinic(doctorId: string, clinicId: string): Promise<void> {
    const link = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorClinic.findFirst({
        where: {
          clinicId,
          doctor: {
            ...(doctorId ? { OR: [{ id: doctorId }, { userId: doctorId }] } : {}),
          },
        },
        select: { doctorId: true },
      });
    });
    if (!link) {
      throw new NotFoundException('Doctor not found in this clinic');
    }
  }

  /**
   * Bust the doctor's cached availability grids and broadcast the change — same event the
   * working-hours / appointment flows already emit, so connected clients refetch.
   */
  private async refreshAvailability(clinicId: string, doctorId: string): Promise<void> {
    try {
      // Grids are registered under the `doctor_availability` collection tag (clinic-scoped)
      // and the doctor's own `doctor:<id>` entity tag.
      await this.cacheService.invalidateCollectionTags(['doctor_availability'], clinicId);
      await this.cacheService.invalidateCacheByTag(`doctor:${doctorId}`);
      // Best-effort clinic-scoped availability patterns (see LeaveService.refreshAvailability).
      await this.cacheService.invalidateClinicAvailabilityCache(clinicId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Could not clear cached doctor availability after a day-override change',
        SOURCE,
        { clinicId, doctorId, error: error instanceof Error ? error.message : String(error) }
      );
    }
    try {
      await this.eventService.emit('doctor.availability.changed', {
        clinicId,
        doctorId,
        source: `${SOURCE}.dayOverride`,
        timestamp: nowIso(),
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to emit doctor.availability.changed after a day-override change',
        SOURCE,
        { clinicId, doctorId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private toResponse(row: {
    id: string;
    doctorId: string;
    clinicId: string;
    locationId: string | null;
    date: Date | string;
    sessions: unknown;
    reason: string | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): DoctorDayAvailabilityResponse {
    return {
      id: row.id,
      doctorId: row.doctorId,
      clinicId: row.clinicId,
      locationId: row.locationId ?? null,
      date: this.dateToDayKey(row.date),
      sessions: this.parseSessionsJson(row.sessions) ?? [],
      reason: row.reason ?? null,
      createdBy: row.createdBy ?? null,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt:
        row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      deleted: row.deletedAt != null,
    };
  }

  private parseSessionsJson(value: unknown): Array<{ start: string; end: string }> | null {
    let raw = value;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }
    if (!Array.isArray(raw)) return null;
    return raw
      .map(item => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        return { start: String(record['start']), end: String(record['end']) };
      })
      .filter(
        (x): x is { start: string; end: string } =>
          x !== null && x.start !== 'undefined' && x.end !== 'undefined'
      );
  }

  /** Today's IST calendar day key, YYYY-MM-DD. */
  private todayDayKey(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /** Assert a YYYY-MM-DD key is today-or-later (IST); return it. */
  private assertFutureDayKey(value: string): string {
    const key = this.assertDayKey(value);
    if (key < this.todayDayKey()) {
      throw new BadRequestException('Day overrides can only be set for today or a future day');
    }
    return key;
  }

  private assertDayKey(value: string): string {
    if (typeof value !== 'string' || !DAY_KEY.test(value.trim())) {
      throw new BadRequestException('date must be an IST calendar day YYYY-MM-DD');
    }
    return value.trim();
  }

  private addDaysKey(dayKey: string, days: number): string {
    const base = this.dayKeyToDate(dayKey);
    base.setUTCDate(base.getUTCDate() + days);
    return dayKeyToDateKey(base);
  }

  private dayKeyToDate(dayKey: string): Date {
    return new Date(`${dayKey}T00:00:00.000Z`);
  }

  private dateToDayKey(value: Date | string): string {
    return dayKeyToDateKey(value);
  }
}

/** A DATE column value (Prisma returns it as UTC midnight) -> YYYY-MM-DD. */
function dayKeyToDateKey(value: Date | string): string {
  if (typeof value === 'string') {
    const match = DAY_KEY.exec(value.trim());
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
