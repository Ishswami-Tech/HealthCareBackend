import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { NotificationPreferenceService } from '@services/notification/notification-preference.service';
import {
  LogType,
  LogLevel,
  AppointmentStatus,
  AppointmentTypeEnum as AppointmentType,
} from '@core/types';
import type { DoctorSummaryTypeFilter, DoctorSummaryWindowKind } from '@core/types/queue.types';
import { formatDateKeyInIST, formatDateInIST } from '@utils/date-time.util';

/**
 * DoctorSummaryService — single source of truth for building doctor daily
 * appointment summaries. Used by:
 *   - DoctorAppointmentEventListener (event-triggered updates)
 *   - AppointmentsService cron job (daily 7AM IST push)
 *   - AppointmentsService window summaries (15 min before each consultation window opens;
 *     `typeFilter` limits the list to that window's visits, e.g. only VIDEO_CALL)
 *
 * All callers should call buildSummary() which returns null (with a DEBUG log)
 * when a pre-condition gate fails, rather than swallowing errors silently.
 */
@Injectable()
export class DoctorSummaryService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly notificationPreferenceService: NotificationPreferenceService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Build a doctor's daily appointment summary.
   *
   * @returns null if prefs/phone gate fails (with a DEBUG log explaining why),
   *   otherwise an object ready for the WhatsApp template formatter.
   */
  async buildSummary(
    doctorId: string,
    clinicId: string,
    options: {
      typeFilter?: DoctorSummaryTypeFilter;
      dateKey?: string;
      /** A window summary: named in the message, so it never reads as a repeat of the morning one. */
      window?: { kind: DoctorSummaryWindowKind; start: string; end: string };
    } = {}
  ) {
    // 1. Resolve doctorUserId
    const doctorRecord = await this.databaseService.executeHealthcareRead<{
      id: string;
      userId: string;
    } | null>(async client => {
      const prismaClient = client as unknown as Record<string, unknown>;
      return (
        (
          (prismaClient['doctor'] as Record<string, unknown> | undefined)?.['findUnique'] as
            ((args: unknown) => Promise<{ id: string; userId: string } | null>) | undefined
        )?.({ where: { id: doctorId }, select: { id: true, userId: true } }) ?? null
      );
    });

    if (!doctorRecord) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.DEBUG,
        `DoctorSummaryService: doctor ${doctorId} not found — skipping summary`,
        'DoctorSummaryService',
        { doctorId, clinicId }
      );
      return null;
    }

    const doctorUserId = doctorRecord.userId;

    // 2. Check preferences
    const preferences = await this.notificationPreferenceService.getPreferences(doctorUserId);
    if (!preferences.whatsappEnabled || !preferences.appointmentEnabled) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.DEBUG,
        `DoctorSummaryService: prefs gate failed for doctor ${doctorUserId} (whatsappEnabled=${preferences.whatsappEnabled}, appointmentEnabled=${preferences.appointmentEnabled})`,
        'DoctorSummaryService',
        { doctorId, doctorUserId, clinicId }
      );
      return null;
    }

    // 3. Check phone
    const doctorUser = await this.databaseService.findUserByIdSafe(doctorUserId);
    const phone = doctorUser?.phone;
    if (!phone) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.DEBUG,
        `DoctorSummaryService: no phone for doctor ${doctorUserId} — skipping summary`,
        'DoctorSummaryService',
        { doctorId, doctorUserId, clinicId }
      );
      return null;
    }

    // 4. Query the day's CONFIRMED appointments at THIS clinic (IST-correct boundaries). The day
    //    is the job's own dateKey when set, so a job that runs after midnight lists its day.
    const todayKey =
      options.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(options.dateKey)
        ? options.dateKey
        : formatDateKeyInIST(new Date());
    const summaryStart = new Date(`${todayKey}T00:00:00+05:30`);
    const summaryEnd = new Date(`${todayKey}T00:00:00+05:30`);
    summaryEnd.setDate(summaryEnd.getDate() + 1);

    const appointments = await this.databaseService.executeHealthcareRead<
      Array<{
        time: string | null;
        type: string | null;
        patient: { user: { name: string | null; phone: string | null } } | null;
        clinic: { name: string | null } | null;
      }>
    >(async client => {
      const prismaClient = client as unknown as Record<string, unknown>;
      return (
        (
          (prismaClient['appointment'] as Record<string, unknown> | undefined)?.['findMany'] as
            | ((args: unknown) => Promise<
                Array<{
                  time: string | null;
                  type: string | null;
                  patient: { user: { name: string | null; phone: string | null } } | null;
                  clinic: { name: string | null } | null;
                }>
              >)
            | undefined
        )?.({
          where: {
            doctorId,
            clinicId,
            date: { gte: summaryStart, lt: summaryEnd },
            status: {
              in: [AppointmentStatus.CONFIRMED] as unknown as string[],
            },
            ...(options.typeFilter ? { type: options.typeFilter } : {}),
          },
          select: {
            time: true,
            type: true,
            patient: {
              select: { user: { select: { name: true, phone: true } } },
            },
            clinic: { select: { name: true } },
          },
          orderBy: { time: 'asc' },
        }) ?? []
      );
    });

    // 5. Skip if no appointments — no need to send an empty summary message
    if (appointments.length === 0) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.DEBUG,
        `DoctorSummaryService: 0 appointments for doctor ${doctorUserId} at ${clinicId} on ${todayKey} — skipping summary`,
        'DoctorSummaryService',
        { doctorId, doctorUserId, clinicId, todayKey, typeFilter: options.typeFilter }
      );
      return null;
    }

    // 6. Format single-line list
    const appointmentsList = this.formatAppointmentsList(appointments);
    const totalCount = String(appointments.length);
    const dayLabel = formatDateInIST(summaryStart, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const windowLabel = options.window ? this.formatWindowLabel(options.window) : null;
    const dateLabel = windowLabel ? `${dayLabel} (${windowLabel})` : dayLabel;
    const doctorLastName = doctorUser?.lastName || doctorUser?.name || 'Doctor';

    return {
      doctorId,
      doctorUserId,
      clinicId,
      phone,
      doctorLastName,
      dateLabel,
      appointmentsList,
      totalCount,
    };
  }

  /**
   * "video consultations 2:00 PM - 5:00 PM" / "OPD 9:00 AM - 5:00 PM", or null when the times are
   * not HH:MM. Single line: it goes into a WhatsApp template parameter.
   */
  formatWindowLabel(window: {
    kind: DoctorSummaryWindowKind;
    start: string;
    end: string;
  }): string | null {
    const clock = (time: string): string | null => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return null;
      const hour12 = hours % 12 === 0 ? 12 : hours % 12;
      return `${hour12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
    };
    const start = clock(window.start);
    const end = clock(window.end);
    if (!start || !end) return null;
    const name = window.kind === 'video' ? 'video consultations' : 'OPD';
    return `${name} ${start} - ${end}`;
  }

  /**
   * Format appointments as a single-line list joined with " | ".
   * Meta rejects newlines/tabs in template parameters.
   */
  private formatAppointmentsList(
    appointments: Array<{
      time: string | null;
      type: string | null;
      patient: { user: { name: string | null; phone: string | null } } | null;
      clinic: { name: string | null } | null;
    }>
  ): string {
    if (appointments.length === 0) {
      return 'No confirmed appointments for today.';
    }

    const lines: string[] = [];
    for (const apt of appointments) {
      const timeLabel = apt.time
        ? new Date(`1970-01-01T${apt.time}`).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        : 'TBD';
      const patientName = apt.patient?.user?.name || 'Unknown';
      const patientPhone = apt.patient?.user?.phone || '';
      const phoneLabel = patientPhone ? ` ${patientPhone}` : '';
      const typeLabel = this.formatAppointmentType(apt.type);
      lines.push(`${timeLabel} - ${patientName}${phoneLabel} (${typeLabel})`);
    }

    return lines.join(' | ');
  }

  private formatAppointmentType(type: string | null): string {
    if (type === AppointmentType.VIDEO_CALL) return 'Video';
    if (type === AppointmentType.IN_PERSON) return 'In-person';
    if (type === AppointmentType.HOME_VISIT) return 'Home visit';
    if (!type) return 'Consultation';
    return type.toLowerCase().replace(/_/g, ' ');
  }
}
