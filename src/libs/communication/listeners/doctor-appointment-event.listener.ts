import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventService } from '@infrastructure/events/event.service';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { QueueService } from '@infrastructure/queue';
import { DoctorSummaryService } from '@communication/services/doctor-summary.service';
import { LogType, LogLevel } from '@core/types';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
import { formatDateKeyInIST, getClockPartsInIST } from '@utils/date-time.util';
import { loadDoctorSummaryInputs } from '@services/appointments/doctor-summary-data';
import { isWithinDoctorSummaryDay } from '@services/appointments/doctor-summary-schedule.util';

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
 * - Job IDs are per-doctor-per-day (`doctor-summary-{userId}-{clinicId}-{dateKey}-event`),
 *   so only ONE event-driven summary is enqueued per doctor per day regardless of
 *   how many appointments are confirmed.
 * - A pre-check via `getJob()` short-circuits if a job for this doctor+clinic+date
 *   already exists in the queue (BullMQ retains completed jobs for monitoring).
 * - A 30-second in-memory dedup prevents the same appointment confirmation from
 *   billing + appointment services firing twice from creating extra jobs.
 * - Summary content (appointmentsList, totalCount) is computed at process time.
 * - Only bookings for today, only between the day's first scheduled summary and the end of the
 *   doctor's last window (clinic / doctor settings; see doctor-summary-schedule.util.ts), and
 *   never for the appointment.confirmed that check-in re-emits.
 */
@Injectable()
export class DoctorAppointmentEventListener {
  private readonly SUMMARY_DELAY_MS = 5 * 60 * 1000; // 5 minutes after appointment confirmation
  private readonly doctorSummaryDedup = new Map<string, number>();
  private readonly doctorSummaryDedupTtlMs = 30_000;

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

    // Fast in-memory dedup: appointment.confirmed can fire twice from billing +
    // appointment services for the same appointment. Skip duplicates within 30s.
    const dedupKey = `appointment.confirmed|${payload.appointmentId ?? ''}`;
    const now = Date.now();
    const lastSeen = this.doctorSummaryDedup.get(dedupKey);
    if (lastSeen && now - lastSeen < this.doctorSummaryDedupTtlMs) {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.DEBUG,
        `DoctorAppointmentEventListener: skipping duplicate appointment.confirmed for appointment ${payload.appointmentId}`,
        'DoctorAppointmentEventListener',
        { appointmentId: payload.appointmentId, doctorId, clinicId }
      );
      return;
    }
    this.doctorSummaryDedup.set(dedupKey, now);
    if (this.doctorSummaryDedup.size > 500) {
      for (const [key, timestamp] of this.doctorSummaryDedup.entries()) {
        if (now - timestamp >= this.doctorSummaryDedupTtlMs) {
          this.doctorSummaryDedup.delete(key);
        }
      }
    }

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

    // Check-in re-emits appointment.confirmed for a visit already in the summary; reacting to it
    // would use up the day's one update before a real new booking arrives.
    if (payload['checkInMethod'] !== undefined || payload['checkedInAt'] !== undefined) {
      return;
    }

    // The summary lists today's visits: a booking for another day changes nothing in it.
    const nowDate = new Date();
    const todayKey = formatDateKeyInIST(nowDate);
    const appointmentDate = payload.appointment?.['date'];
    const appointmentDayKey =
      typeof appointmentDate === 'string' || appointmentDate instanceof Date
        ? formatDateKeyInIST(appointmentDate)
        : '';
    if (appointmentDayKey && appointmentDayKey !== todayKey) {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.DEBUG,
        'DoctorAppointmentEventListener: booking is for another day — no summary update',
        'DoctorAppointmentEventListener',
        { doctorId, clinicId, appointmentId: payload.appointmentId }
      );
      return;
    }

    try {
      // 1. The doctor-clinic pair with its stored hours and the clinic's summary timing.
      const clock = getClockPartsInIST(nowDate);
      const { pairs, overrides } = await loadDoctorSummaryInputs(this.databaseService, todayKey, {
        doctorId,
        clinicId,
      });
      const pair = pairs[0];
      if (!pair || !clock) {
        void this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.DEBUG,
          `DoctorAppointmentEventListener: doctor ${doctorId} is not linked to active clinic ${clinicId}`,
          'DoctorAppointmentEventListener',
          { doctorId, clinicId }
        );
        return;
      }
      const doctorUserId = pair.doctorUserId;

      // Only between the day's first scheduled summary (earlier bookings are in it) and the
      // end of the doctor's last window; both come from the clinic / doctor settings.
      const nowMinutes = clock.hour * 60 + clock.minute;
      if (!isWithinDoctorSummaryDay(pair, overrides, todayKey, nowMinutes)) {
        void this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.DEBUG,
          'DoctorAppointmentEventListener: skipping event-driven summary — outside the doctor summary day',
          'DoctorAppointmentEventListener',
          { doctorId, clinicId, nowMinutes }
        );
        return;
      }

      // 2. Build per-day jobId — ensures only ONE event-driven summary per doctor per day.
      //    The scheduled summaries use "-cron" / "-<window>-window" suffixes, so no collision.
      const dedupJobId = `doctor-summary-${doctorUserId}-${clinicId}-${todayKey}-event`;
      const existingEventJob = await this.queueService.getJob('healthcare-queue', dedupJobId);
      if (existingEventJob) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.DEBUG,
          `Coalescing doctor summary for doctor ${doctorUserId} — existing job ${dedupJobId} covers new booking`,
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
          dateKey: todayKey,
        },
        {
          priority: JobPriorityLevel.NORMAL,
          correlationId: dedupJobId,
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
          jobId: dedupJobId,
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
}
