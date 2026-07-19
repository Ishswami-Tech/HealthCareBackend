import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventService } from '@infrastructure/events/event.service';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { QueueService } from '@infrastructure/queue';
import { DoctorSummaryService } from '@communication/services/doctor-summary.service';
import { LogType, LogLevel } from '@core/types';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
import { formatDateKeyInIST } from '@utils/date-time.util';

type AppointmentConfirmedEventPayload = {
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
 * Listens to `appointment.confirmed` events and enqueues a doctor daily
 * summary job. The summary is computed at process time (in the queue
 * processor) so it always reflects the latest confirmed appointments,
 * not stale data captured at enqueue time.
 *
 * Behavior:
 * - Only confirmed appointments trigger this (the summary only counts CONFIRMED).
 * - Job IDs use 15-minute IST buckets to coalesce rapid back-to-back bookings
 *   without colliding with the per-day dedup table (BullMQ keeps completed jobs).
 * - A pre-check via `getJob` short-circuits if a job for this bucket exists.
 * - Summary content (appointmentsList, totalCount) is computed at process time.
 */
@Injectable()
export class DoctorAppointmentEventListener {
  private readonly SUMMARY_DELAY_MS = 15 * 60 * 1000;

  constructor(
    private readonly eventService: EventService,
    private readonly databaseService: DatabaseService,
    private readonly queueService: QueueService,
    private readonly doctorSummaryService: DoctorSummaryService,
    private readonly loggingService: LoggingService
  ) {}

  @OnEvent('appointment.confirmed')
  async onAppointmentConfirmed(rawPayload: unknown) {
    // Unwrap the enterprise envelope: events may be emitted as
    // {eventId, ..., payload: {doctorId, clinicId, ...}} or as flat payloads.
    const payload = (
      rawPayload && typeof rawPayload === 'object' && 'payload' in (rawPayload as object)
        ? ((rawPayload as { payload: unknown }).payload as AppointmentConfirmedEventPayload)
        : (rawPayload as AppointmentConfirmedEventPayload)
    ) as AppointmentConfirmedEventPayload;

    const doctorId = payload.doctorId;
    const clinicId = payload.clinicId;

    if (!doctorId || !clinicId) {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.DEBUG,
        'DoctorAppointmentEventListener: missing doctorId/clinicId in event payload',
        'DoctorAppointmentEventListener',
        { hasDoctorId: Boolean(doctorId), hasClinicId: Boolean(clinicId) }
      );
      return;
    }

    try {
      // 1. Resolve doctorUserId (cheap pre-check — no prefs/phone query yet)
      const doctorUserId = await this.resolveDoctorUserId(doctorId);
      if (!doctorUserId) {
        void this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.DEBUG,
          `DoctorAppointmentEventListener: doctor ${doctorId} not found`,
          'DoctorAppointmentEventListener',
          { doctorId, clinicId }
        );
        return;
      }

      // 2. Build 15-minute bucketed jobId (IST date) — fixes the dedup collision
      const todayKey = formatDateKeyInIST(new Date());
      const minutesOfDay =
        new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours() * 60 +
        new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getMinutes();
      const bucket = Math.floor(minutesOfDay / 15);
      const bucketedJobId = `doctor-summary:${doctorUserId}:${clinicId}:${todayKey}:${bucket}`;

      // 3. Short-circuit if a job for this bucket already exists
      const existingJob = await this.queueService.getJob('healthcare-queue', bucketedJobId);
      if (existingJob) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.DEBUG,
          `Coalescing doctor summary for doctor ${doctorUserId} — existing job ${bucketedJobId} covers new booking`,
          'DoctorAppointmentEventListener',
          { doctorUserId, clinicId, appointmentId: payload.appointmentId }
        );
        return;
      }

      // 4. Enqueue a thin job — summary content is computed at process time.
      await this.queueService.addJob(
        JobType.DOCTOR_SUMMARY,
        'send-doctor-daily-summary',
        {
          doctorId,
          doctorUserId,
          clinicId,
          triggeredBy: 'appointment_confirmed',
        },
        {
          priority: JobPriorityLevel.NORMAL,
          correlationId: bucketedJobId,
          delay: this.SUMMARY_DELAY_MS,
          attempts: 3,
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Enqueued doctor summary job (triggeredBy: appointment_confirmed) for doctor ${doctorUserId} after appointment ${payload.appointmentId}`,
        'DoctorAppointmentEventListener',
        {
          doctorUserId,
          doctorId,
          clinicId,
          appointmentId: payload.appointmentId,
          jobId: bucketedJobId,
          bucket,
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
}
