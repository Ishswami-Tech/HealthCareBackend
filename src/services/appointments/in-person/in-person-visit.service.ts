/**
 * In-person visit read model (V2): stage, token, people ahead and ETA for patients, the doctor's
 * queue and the reception desk. Read only; every write goes through InPersonCheckInService or the
 * existing doctor-only queue / complete flows.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { AppointmentQueueService } from '@infrastructure/queue';
import { CacheService } from '@infrastructure/cache/cache.service';
import { BoundedLru } from '@utils/bounded-lru.util';
import { Role } from '@core/types/enums.types';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { resolveReceptionistLocationOrThrow } from '@utils/staff-location.util';
import {
  checkInWindowState,
  computeCheckInWindow,
  computeQueuePlaces,
  deriveInPersonStage,
  isBookingInCheckInScope,
  queueTokenLabel,
  readWalkInFlag,
  isVideoVisit,
  rankLocationsByDistance,
  slotMinutesOf,
  type GeoPoint,
  type InPersonStage,
  type QueueLine,
} from '@utils/in-person-flow.util';
import {
  CLINIC_IN_PERSON_MINUTES_CACHE_TTL_SECONDS,
  clinicInPersonMinutesCacheKey,
  resolveClinicVisitDurations,
} from '@utils/visit-duration.util';
import { isAppointmentOwnedByPatientUser } from '../core/appointment-access.util';
import type {
  BookingLocation,
  InPersonActor,
  InPersonDeskBoard,
  InPersonVisit,
} from './in-person.types';

interface PersonName {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
}

/** The appointment columns the read model needs. */
export interface InPersonAppointmentRow {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  userId: string | null;
  familyMemberId: string | null;
  locationId: string | null;
  type: string;
  status: string;
  date: Date;
  time: string;
  duration: number | null;
  priority: string | null;
  checkedInAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Booking metadata (walk-in tag). Optional: older selects / fixtures omit it. */
  metadata?: unknown;
  /** Durable token stored at check-in (fallback when the live queue entry is missing). */
  tokenNumber?: number | null;
  tokenLabel?: string | null;
  patient: { user: PersonName | null } | null;
  doctor: { user: PersonName | null } | null;
  location: { name: string } | null;
}

interface LocationRow {
  id: string;
  name: string;
  address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  checkInLocations: Array<{ id: string; isActive: boolean }>;
}

interface ReadClient {
  appointment: {
    findFirst: (args: unknown) => Promise<InPersonAppointmentRow | null>;
    findMany: (args: unknown) => Promise<InPersonAppointmentRow[]>;
    count?: (args: unknown) => Promise<number>;
  };
  clinicLocation: {
    findMany: (args: unknown) => Promise<LocationRow[]>;
    findFirst: (args: unknown) => Promise<{ id: string; name: string } | null>;
  };
  patient: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  clinic?: { findUnique: (args: unknown) => Promise<{ settings?: unknown } | null> };
}

/** One day in ms: the patient booking lookup spans the previous .. next IST day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Upper bound of the reception desk board (one location, one day). 200-500 patients per doctor
 * per day at a multi-doctor location stays well inside it; above it the board answers
 * `truncated: true` with the real `total` instead of silently dropping patients.
 */
export const DESK_BOARD_MAX_ROWS = 3000;

const NAME_SELECT = { select: { name: true, firstName: true, lastName: true } };

export const IN_PERSON_APPOINTMENT_SELECT = {
  id: true,
  clinicId: true,
  patientId: true,
  doctorId: true,
  userId: true,
  familyMemberId: true,
  locationId: true,
  type: true,
  status: true,
  date: true,
  time: true,
  duration: true,
  priority: true,
  checkedInAt: true,
  startedAt: true,
  completedAt: true,
  metadata: true,
  tokenNumber: true,
  tokenLabel: true,
  patient: { select: { user: NAME_SELECT } },
  doctor: { select: { user: NAME_SELECT } },
  location: { select: { name: true } },
} as const;

/** Page of the desk board (`?page=&limit=`); absent page = the whole day (unchanged). */
interface DeskPaging {
  page: number;
  limit: number;
  offset: number;
}

export const DESK_PAGE_MAX_LIMIT = 500;

export function parseDeskPaging(page?: string, limit?: string): DeskPaging | null {
  const rawPage = Number(page);
  if (page === undefined || page === '' || !Number.isFinite(rawPage) || rawPage < 1) return null;
  const rawLimit = Number(limit);
  const size =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), DESK_PAGE_MAX_LIMIT)
      : 100;
  const pageNumber = Math.floor(rawPage);
  return { page: pageNumber, limit: size, offset: (pageNumber - 1) * size };
}

const DESK_STAGE_KEY: Record<InPersonStage, keyof InPersonDeskBoard['counts']> = {
  BOOKED: 'booked',
  CHECKED_IN: 'checkedIn',
  WITH_DOCTOR: 'withDoctor',
  COMPLETED: 'completed',
  NO_SHOW: 'noShow',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

function emptyDeskCounts(): InPersonDeskBoard['counts'] {
  return {
    booked: 0,
    checkedIn: 0,
    withDoctor: 0,
    completed: 0,
    noShow: 0,
    expired: 0,
    cancelled: 0,
  };
}

/** Staff roles that may read any in-person visit of their clinic (reception: own location). */
const VISIT_READER_ROLES: ReadonlySet<string> = new Set([
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.CLINIC_ADMIN,
  Role.CLINIC_LOCATION_HEAD,
  Role.SUPER_ADMIN,
  Role.NURSE,
]);

function personName(user: PersonName | null | undefined, fallback: string): string {
  const parts = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return user?.name?.trim() || parts || fallback;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** userId -> Patient.id of the patient poll path (GET /in-person/me/today): bounded, 10 min. */
const PATIENT_ID_LRU_MAX_ENTRIES = 5000;
const PATIENT_ID_LRU_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class InPersonVisitService {
  /**
   * A user's Patient row never changes id once created, so only found ids are kept (a user
   * without a profile yet is re-read until one exists).
   */
  private readonly patientIdByUserId = new BoundedLru<string, string>({
    maxEntries: PATIENT_ID_LRU_MAX_ENTRIES,
    ttlMs: PATIENT_ID_LRU_TTL_MS,
  });

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly queue: AppointmentQueueService,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cache?: CacheService
  ) {}

  /** Patient.id of a user (in-process LRU in front of the indexed userId lookup). */
  private async patientIdOfUser(userId: string): Promise<string | null> {
    const cached = this.patientIdByUserId.get(userId);
    if (cached) return cached;
    const profile = await this.read(client =>
      client.patient.findFirst({ where: { userId }, select: { id: true } })
    );
    if (profile?.id) this.patientIdByUserId.set(userId, profile.id);
    return profile?.id ?? null;
  }

  private read<T>(operation: (client: ReadClient) => Promise<T>): Promise<T> {
    return this.database.executeHealthcareRead<T>(client =>
      operation(client as unknown as ReadClient)
    );
  }

  // ------------------------------------------------------------------ access

  /** The receptionist's allotted location (fail closed, see resolveReceptionistLocationOrThrow). */
  resolveReceptionistLocation(userId: string, clinicId: string): Promise<string> {
    return resolveReceptionistLocationOrThrow(this.database, userId, clinicId);
  }

  /** 404 for another clinic's / missing appointment, 400 for video, 403 for no access. */
  async loadForActor(
    appointmentId: string,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonAppointmentRow> {
    const row = await this.read(client =>
      client.appointment.findFirst({
        where: { id: appointmentId, clinicId },
        select: IN_PERSON_APPOINTMENT_SELECT,
      })
    );
    if (!row) throw new NotFoundException('Appointment not found');
    await this.assertCanRead(row, clinicId, actor);
    if (isVideoVisit(row.type)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VIDEO_VISIT',
        message: 'Video visits have no clinic check-in or queue.',
      });
    }
    return row;
  }

  private async assertCanRead(
    row: InPersonAppointmentRow,
    clinicId: string,
    actor: InPersonActor
  ): Promise<void> {
    const role = upper(actor.role);
    if (role === String(Role.PATIENT)) {
      const owned = await isAppointmentOwnedByPatientUser(this.database, row, actor.userId);
      if (!owned) throw new ForbiddenException('You can only view your own appointments');
      return;
    }
    if (!VISIT_READER_ROLES.has(role)) throw new ForbiddenException('Not allowed');
    if (role === String(Role.RECEPTIONIST)) {
      const locationId = await this.resolveReceptionistLocation(actor.userId, clinicId);
      if (row.locationId !== locationId) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'RECEPTION_WRONG_LOCATION',
          message: 'This appointment is at another clinic location.',
        });
      }
    }
  }

  // ------------------------------------------------------------------ reads

  async getVisit(
    appointmentId: string,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonVisit> {
    const row = await this.loadForActor(appointmentId, clinicId, actor);
    const [visit] = await this.toVisits([row]);
    return visit as InPersonVisit;
  }

  /** The caller's own (and dependents' bookings they made) in-person visits today. */
  async listMineToday(
    clinicId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<InPersonVisit[]> {
    const rows = await this.findPatientBookingsToday(clinicId, userId, now);
    return this.toVisits(rows, now);
  }

  async findPatientBookingsToday(
    clinicId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<InPersonAppointmentRow[]> {
    const patientId = await this.patientIdOfUser(userId);
    const patientIds = [userId, patientId].filter((id): id is string => Boolean(id));
    // Previous .. next IST day, then filtered: a late (23:45) or early (00:10) slot's check-in
    // window crosses midnight, so "today" means today's slots plus any slot whose window is open.
    const rows = await this.read(client =>
      client.appointment.findMany({
        where: {
          clinicId,
          type: { not: 'VIDEO_CALL' },
          date: {
            gte: startOfIstDay(new Date(now.getTime() - DAY_MS)),
            lte: endOfIstDay(new Date(now.getTime() + DAY_MS)),
          },
          OR: [{ userId }, { patientId: { in: patientIds } }],
        },
        select: IN_PERSON_APPOINTMENT_SELECT,
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: 40,
      })
    );
    return rows.filter(row => isBookingInCheckInScope(row, now)).slice(0, 20);
  }

  /** Every in-person appointment of one location on one IST day (reception desk). */
  async getDeskBoard(
    clinicId: string,
    actor: InPersonActor,
    requested: { date?: string; locationId?: string; page?: string; limit?: string }
  ): Promise<InPersonDeskBoard> {
    const role = upper(actor.role);
    const locationId =
      role === String(Role.RECEPTIONIST)
        ? await this.resolveReceptionistLocation(actor.userId, clinicId)
        : requested.locationId;
    if (!locationId) throw new BadRequestException('locationId is required');

    const location = await this.read(client =>
      client.clinicLocation.findFirst({
        where: { id: locationId, clinicId },
        select: { id: true, name: true },
      })
    );
    if (!location) throw new NotFoundException('Location not found');

    const day =
      requested.date && /^\d{4}-\d{2}-\d{2}$/.test(requested.date)
        ? requested.date
        : formatDateKeyInIST(new Date());
    const where = {
      clinicId,
      locationId,
      type: { not: 'VIDEO_CALL' },
      date: { gte: startOfIstDay(day), lte: endOfIstDay(day) },
    };
    const paging = parseDeskPaging(requested.page, requested.limit);
    if (paging) {
      return this.getDeskBoardPage(where, paging, { locationId, name: location.name, day });
    }
    const fetched = await this.read(client =>
      client.appointment.findMany({
        where,
        select: IN_PERSON_APPOINTMENT_SELECT,
        orderBy: [{ time: 'asc' }, { id: 'asc' }],
        take: DESK_BOARD_MAX_ROWS + 1,
      })
    );
    const truncated = fetched.length > DESK_BOARD_MAX_ROWS;
    const rows = truncated ? fetched.slice(0, DESK_BOARD_MAX_ROWS) : fetched;
    const total = truncated
      ? await this.read(client =>
          client.appointment.count
            ? client.appointment.count({ where })
            : Promise.resolve(fetched.length)
        )
      : rows.length;
    const visits = await this.toVisits(rows);
    const counts = emptyDeskCounts();
    for (const visit of visits) counts[DESK_STAGE_KEY[visit.stage]] += 1;
    return {
      locationId,
      locationName: location.name,
      date: day,
      counts,
      visits,
      total,
      truncated,
    };
  }

  /**
   * One page of the desk board (M6). The counts and `total` cover the whole day from ONE light read
   * (id / status / arrival only); the full rows (names, token, queue place) are read and mapped for
   * the page alone, in the board order (slot time, then id).
   */
  private async getDeskBoardPage(
    where: Record<string, unknown>,
    paging: DeskPaging,
    meta: { locationId: string; name: string | null; day: string }
  ): Promise<InPersonDeskBoard> {
    const light = await this.read(client =>
      client.appointment.findMany({
        where,
        select: { id: true, status: true, checkedInAt: true },
        orderBy: [{ time: 'asc' }, { id: 'asc' }],
        take: DESK_BOARD_MAX_ROWS + 1,
      })
    );
    const truncated = light.length > DESK_BOARD_MAX_ROWS;
    const dayRows = truncated ? light.slice(0, DESK_BOARD_MAX_ROWS) : light;
    const total = truncated
      ? await this.read(client =>
          client.appointment.count
            ? client.appointment.count({ where })
            : Promise.resolve(light.length)
        )
      : dayRows.length;
    const counts = emptyDeskCounts();
    for (const row of dayRows) counts[DESK_STAGE_KEY[deriveInPersonStage(row)]] += 1;

    const pageIds = dayRows.slice(paging.offset, paging.offset + paging.limit).map(row => row.id);
    const pageRows =
      pageIds.length === 0
        ? []
        : await this.read(client =>
            client.appointment.findMany({
              where: { id: { in: pageIds } },
              select: IN_PERSON_APPOINTMENT_SELECT,
            })
          );
    const byId = new Map(pageRows.map(row => [row.id, row]));
    const ordered = pageIds
      .map(id => byId.get(id))
      .filter((row): row is InPersonAppointmentRow => Boolean(row));
    return {
      locationId: meta.locationId,
      locationName: meta.name,
      date: meta.day,
      counts,
      visits: await this.toVisits(ordered),
      total,
      truncated,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.max(1, Math.ceil(dayRows.length / paging.limit)),
    };
  }

  /** Active clinic locations for booking, nearest first when the caller sends a position. */
  async listBookingLocations(
    clinicId: string,
    origin: GeoPoint | null
  ): Promise<BookingLocation[]> {
    const rows = await this.read(client =>
      client.clinicLocation.findMany({
        where: { clinicId, isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          latitude: true,
          longitude: true,
          checkInLocations: { select: { id: true, isActive: true } },
        },
        take: 100,
      })
    );
    return rankLocationsByDistance(rows, origin).map(row => ({
      locationId: row.id,
      name: row.name,
      address: row.address,
      city: row.city ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      distanceMeters: row.distanceMeters,
      isNearest: row.isNearest,
      checkInEnabled: row.checkInLocations.some(qr => qr.isActive),
    }));
  }

  // ------------------------------------------------------------------ mapping

  /**
   * Rows -> visits. The live queue (one read per doctor + location) supplies token, people
   * ahead and ETA for the checked-in ones; a queue outage only blanks those fields.
   */
  async toVisits(
    rows: readonly InPersonAppointmentRow[],
    now: Date = new Date()
  ): Promise<InPersonVisit[]> {
    const today = formatDateKeyInIST(now);
    const queues = new Map<string, QueueLine[]>();
    // Queue places per doctor/location line, computed once per line (not once per row).
    const placesByLine = new Map<string, ReturnType<typeof computeQueuePlaces>>();
    const lineEntries = new Map<string, Map<string, QueueLine>>();
    for (const row of rows) {
      const stage = deriveInPersonStage(row);
      const queued = stage === 'CHECKED_IN' || stage === 'WITH_DOCTOR';
      if (!queued || formatDateKeyInIST(row.date) !== today) continue;
      const key = `${row.doctorId}|${row.locationId ?? ''}`;
      if (queues.has(key)) continue;
      queues.set(key, await this.readQueue(row.doctorId, row.clinicId, today, row.locationId));
    }
    // ETA uses each clinic's in-person visit length (clinic setting), read once per clinic.
    const consultMinutes = new Map<string, number>();
    if (queues.size > 0) {
      for (const clinicId of new Set(rows.map(row => row.clinicId))) {
        consultMinutes.set(clinicId, await this.readInPersonMinutes(clinicId));
      }
    }

    return rows.map(row => {
      const stage = deriveInPersonStage(row);
      const line = queues.get(`${row.doctorId}|${row.locationId ?? ''}`) ?? [];
      // The live entry, else the token stored on the appointment at check-in (cache outage).
      const lineKeyOfRow = `${row.doctorId}|${row.locationId ?? ''}`;
      let byAppointment = lineEntries.get(lineKeyOfRow);
      if (!byAppointment) {
        byAppointment = new Map();
        for (const entry of line) {
          if (!byAppointment.has(entry.appointmentId))
            byAppointment.set(entry.appointmentId, entry);
        }
        lineEntries.set(lineKeyOfRow, byAppointment);
      }
      const live = byAppointment.get(row.id);
      const mine =
        live ??
        (typeof row.tokenNumber === 'number' && row.tokenNumber > 0
          ? {
              appointmentId: row.id,
              tokenNumber: row.tokenNumber,
              tokenLabel: row.tokenLabel ?? null,
            }
          : undefined);
      const lineKey = `${row.doctorId}|${row.locationId ?? ''}|${row.clinicId}`;
      let places = placesByLine.get(lineKey);
      if (!places && (stage === 'CHECKED_IN' || stage === 'WITH_DOCTOR')) {
        places = computeQueuePlaces(line, consultMinutes.get(row.clinicId));
        placesByLine.set(lineKey, places);
      }
      const place =
        stage === 'CHECKED_IN' || stage === 'WITH_DOCTOR' ? (places?.get(row.id) ?? null) : null;
      const window = computeCheckInWindow(row);
      return {
        appointmentId: row.id,
        patientId: row.patientId,
        patientName: personName(row.patient?.user, 'Patient'),
        doctorId: row.doctorId,
        doctorName: personName(row.doctor?.user, 'Doctor'),
        locationId: row.locationId,
        locationName: row.location?.name ?? null,
        date: formatDateKeyInIST(row.date),
        time: row.time,
        durationMinutes: slotMinutesOf(row.duration),
        stage,
        appointmentStatus: upper(row.status),
        checkedInAt: iso(row.checkedInAt),
        startedAt: iso(row.startedAt),
        completedAt: iso(row.completedAt),
        tokenNumber: mine?.tokenNumber ?? null,
        token: queueTokenLabel(mine),
        /** Same value as `token` (name used by GET /queue and GET /appointments rows). */
        tokenLabel: queueTokenLabel(mine),
        isWalkIn: readWalkInFlag(row.metadata) === true,
        position: place ? place.position : null,
        peopleAhead: place ? place.peopleAhead : null,
        etaMinutes: place ? place.etaMinutes : null,
        isNext: stage === 'CHECKED_IN' && Boolean(place?.isNext),
        nowServingToken: place?.nowServingTokenLabel ?? null,
        checkInWindow: window
          ? {
              opensAt: window.opensAt.toISOString(),
              closesAt: window.closesAt.toISOString(),
              state: checkInWindowState(window, now),
            }
          : null,
        priority: row.priority ?? null,
      };
    });
  }

  /** The clinic's in-person visit length (clinic settings, defaults on a read failure). */
  private async readInPersonMinutes(clinicId: string): Promise<number> {
    const cacheKey = clinicInPersonMinutesCacheKey(clinicId);
    const cached = await this.readCachedMinutes(cacheKey);
    if (cached !== null) return cached;
    try {
      const clinic = await this.read(client =>
        client.clinic
          ? client.clinic.findUnique({ where: { id: clinicId }, select: { settings: true } })
          : Promise.resolve(null)
      );
      const minutes = resolveClinicVisitDurations(clinic?.settings).inPersonMinutes;
      // Busted by ClinicService.updateClinic; the TTL bounds any other settings writer.
      await this.cache
        ?.set(cacheKey, minutes, CLINIC_IN_PERSON_MINUTES_CACHE_TTL_SECONDS)
        .catch(() => undefined);
      return minutes;
    } catch {
      return resolveClinicVisitDurations(undefined).inPersonMinutes;
    }
  }

  /** A cached visit length, or null on a miss / cache outage (then the DB is read). */
  private async readCachedMinutes(cacheKey: string): Promise<number | null> {
    if (!this.cache) return null;
    try {
      const value = await this.cache.get<number>(cacheKey);
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private async readQueue(
    doctorId: string,
    clinicId: string,
    date: string,
    locationId: string | null
  ): Promise<QueueLine[]> {
    try {
      const response = await this.queue.getDoctorQueue(
        doctorId,
        clinicId,
        date,
        'clinic',
        locationId ?? undefined
      );
      return response.queue.map(entry => ({
        appointmentId: entry.appointmentId,
        status: entry.status,
        tokenNumber: typeof entry.tokenNumber === 'number' ? entry.tokenNumber : null,
        tokenLabel: typeof entry.tokenLabel === 'string' ? entry.tokenLabel : null,
      }));
    } catch {
      return [];
    }
  }
}
