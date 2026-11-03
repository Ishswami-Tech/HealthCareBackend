/**
 * GET /in-person/desk/fees-due: the unpaid consultation bills (walk-in desk fees) of today's
 * in-person visits at the desk's location, so the receptionist sees what is still to collect on
 * the check-in list and the Collect payment screen. Read only and uncached (it changes with every
 * payment); collecting goes through the billing record-payment route.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { InPersonVisitService } from './in-person-visit.service';
import {
  DESK_FEE_BILL_TYPES,
  DESK_FEE_OPEN_STATUSES,
  buildDeskFeesDue,
  type DeskFeeInvoiceRow,
  type DeskFeeVisitRef,
  type DeskFeesDue,
} from './desk-fees.util';
import type { InPersonActor } from './in-person.types';

/** Most visits of one location/day the fee lookup joins (same order as the desk board cap). */
const DESK_FEE_MAX_VISITS = 3000;

interface PersonName {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface FeeVisitRow {
  id: string;
  patientId: string;
  time: string | null;
  status: string;
  patient: { userId: string; user: PersonName | null } | null;
  doctor: { user: PersonName | null } | null;
}

interface DeskFeeClient {
  clinicLocation: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  appointment: {
    findMany: (args: unknown) => Promise<FeeVisitRow[]>;
  };
  invoice: {
    findMany: (args: unknown) => Promise<DeskFeeInvoiceRow[]>;
  };
}

const NAME_SELECT = { select: { name: true, firstName: true, lastName: true } };

function personName(user: PersonName | null | undefined, fallback: string): string {
  const parts = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return user?.name?.trim() || parts || fallback;
}

/** `Appointment.time` is the IST "HH:mm" of the slot (`date` is only the IST day key). */
function visitTime(row: FeeVisitRow): string {
  return row.time && /^\d{2}:\d{2}/.test(row.time) ? row.time.slice(0, 5) : '';
}

@Injectable()
export class InPersonDeskFeesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly visits: InPersonVisitService,
    private readonly logging: LoggingService
  ) {}

  private read<T>(operation: (client: DeskFeeClient) => Promise<T>): Promise<T> {
    return this.database.executeHealthcareRead<T>(client =>
      operation(client as unknown as DeskFeeClient)
    );
  }

  /** RECEPTIONIST: its allotted location. Others: the requested one, or the whole clinic. */
  private async resolveLocation(
    clinicId: string,
    actor: InPersonActor,
    requested?: string
  ): Promise<string | null> {
    if (actor.role === String(Role.RECEPTIONIST)) {
      return this.visits.resolveReceptionistLocation(actor.userId, clinicId);
    }
    if (!requested) return null;
    const found = await this.read(client =>
      client.clinicLocation.findFirst({
        where: { id: requested, clinicId },
        select: { id: true },
      })
    );
    if (!found) throw new NotFoundException('Location not found');
    return found.id;
  }

  async getFeesDue(
    clinicId: string,
    actor: InPersonActor,
    requested: { date?: string; locationId?: string }
  ): Promise<DeskFeesDue> {
    const day = requested.date ?? formatDateKeyInIST(new Date());
    const dayStart = /^\d{4}-\d{2}-\d{2}$/.test(day) ? startOfIstDay(day) : null;
    const dayEnd = dayStart ? endOfIstDay(day) : null;
    // "2026-13-01" / "2026-02-31" are refused (400), never sent to the database as a bad range.
    if (!dayStart || !dayEnd || formatDateKeyInIST(dayStart) !== day) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD day');
    }
    const role = String(actor.role ?? '').toUpperCase();
    const locationId = await this.resolveLocation(
      clinicId,
      { ...actor, role },
      requested.locationId
    );
    try {
      const rows = await this.read(client =>
        client.appointment.findMany({
          where: {
            clinicId,
            ...(locationId ? { locationId } : {}),
            type: { not: 'VIDEO_CALL' },
            date: { gte: dayStart, lte: dayEnd },
          },
          select: {
            id: true,
            patientId: true,
            time: true,
            status: true,
            patient: { select: { userId: true, user: NAME_SELECT } },
            doctor: { select: { user: NAME_SELECT } },
          },
          take: DESK_FEE_MAX_VISITS,
        })
      );
      if (rows.length === 0) return buildDeskFeesDue([], [], { locationId, date: day });
      const visitRefs: DeskFeeVisitRef[] = rows.map(row => ({
        appointmentId: row.id,
        patientId: row.patientId,
        patientUserId: row.patient?.userId ?? '',
        patientName: personName(row.patient?.user, 'Patient'),
        doctorName: personName(row.doctor?.user, 'Doctor'),
        time: visitTime(row),
        appointmentStatus: String(row.status),
      }));
      const invoices = await this.read(client =>
        client.invoice.findMany({
          where: {
            clinicId,
            appointmentId: { in: rows.map(row => row.id) },
            billType: { in: [...DESK_FEE_BILL_TYPES] },
            status: { in: [...DESK_FEE_OPEN_STATUSES] },
          },
          select: {
            id: true,
            invoiceNumber: true,
            appointmentId: true,
            patientId: true,
            userId: true,
            totalAmount: true,
            status: true,
            description: true,
            metadata: true,
            createdAt: true,
            payments: { select: { amount: true, status: true } },
          },
        })
      );
      return buildDeskFeesDue(invoices, visitRefs, { locationId, date: day });
    } catch (error) {
      void this.logging.log(
        LogType.BUSINESS,
        LogLevel.ERROR,
        'Desk fees due could not be read',
        'InPersonDeskFeesService',
        {
          clinicId,
          locationId,
          date: day,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}
