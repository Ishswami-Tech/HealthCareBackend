import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventService } from '@infrastructure/events/event.service';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { QueueService } from '@infrastructure/queue';
import { NotificationPreferenceService } from '@services/notification/notification-preference.service';
import { LogType, LogLevel, AppointmentStatus } from '@core/types';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
import { AppointmentType } from '@core/types/enums.types';
import { formatDateKeyInIST, formatDateInIST } from '@utils/date-time.util';

type AppointmentCreatedEventPayload = {
  appointmentId: string;
  clinicId: string;
  doctorId: string;
  patientId?: string;
  status?: string;
  appointment?: Record<string, unknown>;
  context?: { userId?: string };
  [k: string]: unknown;
};

/**
 * Doctor Appointment Event Listener
 * ==================================
 * Listens to appointment.created events and enqueues a doctor daily summary
 * job so the doctor receives an updated WhatsApp with all CONFIRMED
 * appointments for the day whenever a new booking is made.
 *
 * Behavior:
 * - Only confirmed appointments are included in the doctor's WhatsApp body.
 * - Respects the doctor's NotificationPreferenceService flags
 *   (both whatsappEnabled AND appointmentEnabled must be true).
 * - Uses a deterministic jobId (doctor-summary:{userId}:{clinicId}:{date})
 *   so multiple rapid back-to-back bookings coalesce into one message.
 * - 5-minute cooldown before sending to batch rapid bookings.
 */
@Injectable()
export class DoctorAppointmentEventListener {
  private readonly SUMMARY_COOLDOWN_MS = 5 * 60 * 1000;

  constructor(
    private readonly eventService: EventService,
    private readonly databaseService: DatabaseService,
    private readonly queueService: QueueService,
    private readonly notificationPreferenceService: NotificationPreferenceService,
    private readonly loggingService: LoggingService
  ) {}

  @OnEvent('appointment.created')
  async onAppointmentCreated(payload: AppointmentCreatedEventPayload) {
    const doctorId = payload.doctorId;
    const clinicId = payload.clinicId;

    if (!doctorId || !clinicId) {
      return;
    }

    try {
      // 1. Resolve doctorUserId from doctorId
      const doctorUserId = await this.resolveDoctorUserId(doctorId);
      if (!doctorUserId) {
        return;
      }

      // 2. Check doctor's notification preferences (both flags must be true)
      const preferences = await this.notificationPreferenceService.getPreferences(doctorUserId);
      if (!preferences.whatsappEnabled || !preferences.appointmentEnabled) {
        return;
      }

      // 3. Resolve doctor's phone and last name in one DB call
      const doctorUser = await this.databaseService.findUserByIdSafe(doctorUserId);
      const phone = doctorUser?.phone;
      if (!phone) {
        return;
      }
      const doctorLastName = doctorUser?.lastName ?? doctorUser?.name ?? 'Doctor';

      // 4. Build deterministic jobId for coalescing (IST date)
      const todayKey = formatDateKeyInIST(new Date());
      const deterministicJobId = `doctor-summary:${doctorUserId}:${clinicId}:${todayKey}`;

      // 5. Coalesce: skip if a job for today already exists
      const existingJob = await this.queueService.getJob('healthcare-queue', deterministicJobId);
      if (existingJob) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.DEBUG,
          `Coalescing doctor summary for doctor ${doctorUserId} — existing job ${deterministicJobId} covers new booking`,
          'DoctorAppointmentEventListener',
          { doctorUserId, clinicId, appointmentId: payload.appointmentId }
        );
        return;
      }

      // 6. Query all CONFIRMED appointments for today (IST boundaries)
      const { summaryStart, summaryEnd, todayLabel } = this.buildTodayRange();

      const appointments = await this.databaseService.executeHealthcareRead<
        Array<{
          time: string | null;
          type: string | null;
          patient: { user: { name: string | null } } | null;
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
                    patient: { user: { name: string | null } } | null;
                    clinic: { name: string | null } | null;
                  }>
                >)
              | undefined
          )?.({
            where: {
              doctorId,
              date: { gte: summaryStart, lt: summaryEnd },
              status: {
                in: [AppointmentStatus.CONFIRMED] as unknown as string[],
              },
            },
            select: {
              time: true,
              type: true,
              patient: {
                select: { user: { select: { name: true } } },
              },
              clinic: { select: { name: true } },
            },
            orderBy: { time: 'asc' },
          }) ?? []
        );
      });

      // 7. Format the appointment list
      const appointmentsList = this.formatAppointmentsList(appointments);
      const totalCount = String(appointments.length);

      // 8. Enqueue the doctor summary job with deterministic jobId
      await this.queueService.addJob(
        JobType.DOCTOR_SUMMARY,
        'send-doctor-daily-summary',
        {
          phone,
          doctorId,
          doctorLastName,
          dateLabel: todayLabel,
          appointmentsList,
          totalCount,
          triggeredBy: 'appointment_created',
        },
        {
          priority: JobPriorityLevel.NORMAL,
          correlationId: deterministicJobId,
          delay: this.SUMMARY_COOLDOWN_MS,
          attempts: 3,
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Enqueued doctor summary job (triggeredBy: appointment_created) for doctor ${doctorUserId} after appointment ${payload.appointmentId}`,
        'DoctorAppointmentEventListener',
        {
          doctorUserId,
          doctorId,
          clinicId,
          appointmentId: payload.appointmentId,
          totalAppointments: appointments.length,
          jobId: deterministicJobId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to enqueue doctor summary for appointment ${payload.appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DoctorAppointmentEventListener',
        {
          doctorId,
          clinicId,
          appointmentId: payload.appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private async resolveDoctorUserId(doctorId: string): Promise<string | null> {
    const record: { id: string; userId: string } | null =
      await this.databaseService.executeHealthcareRead<{
        id: string;
        userId: string;
      } | null>(async client => {
        const prismaClient = client as unknown as Record<string, unknown>;
        const result = (
          (prismaClient['doctor'] as Record<string, unknown> | undefined)?.['findUnique'] as
            | ((args: unknown) => Promise<{ id: string; userId: string } | null>)
            | undefined
        )?.({
          where: { id: doctorId },
          select: { id: true, userId: true },
        });
        return result ?? null;
      });

    return record?.userId ?? null;
  }

  /**
   * Build IST midnight-to-midnight range for "today" and a human label.
   * Uses formatDateKeyInIST to avoid depending on server-local hours.
   */
  private buildTodayRange(): {
    summaryStart: Date;
    summaryEnd: Date;
    todayLabel: string;
  } {
    const todayKey = formatDateKeyInIST(new Date()); // "YYYY-MM-DD" in IST
    const [yearStr, monthStr, dayStr] = todayKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1; // JS months: 0-indexed
    const day = Number(dayStr);

    // IST midnight start → inclusive
    const summaryStart = new Date(year, month, day, 0, 0, 0, 0);
    // Next IST midnight → exclusive
    const summaryEnd = new Date(year, month, day + 1, 0, 0, 0, 0);

    const todayLabel = formatDateInIST(summaryStart, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    return { summaryStart, summaryEnd, todayLabel };
  }

  /**
   * Build newline-separated appointment lines for the WhatsApp body.
   * Only confirmed appointments are passed in (filtered by the DB query).
   */
  private formatAppointmentsList(
    appointments: Array<{
      time: string | null;
      type: string | null;
      patient: { user: { name: string | null } } | null;
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
      const typeLabel = this.formatAppointmentType(apt.type);
      const clinicLabel = apt.clinic?.name ? ` @ ${apt.clinic.name}` : '';
      lines.push(`${timeLabel} - ${patientName}${clinicLabel} (${typeLabel})`);
    }

    return lines.join('\n');
  }

  private formatAppointmentType(type: string | null): string {
    if (type === AppointmentType.VIDEO_CALL) return 'Video';
    if (type === AppointmentType.IN_PERSON) return 'In-person';
    if (type === AppointmentType.HOME_VISIT) return 'Home visit';
    if (!type) return 'Consultation';
    return type.toLowerCase().replace(/_/g, ' ');
  }
}
