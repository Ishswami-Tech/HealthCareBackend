/**
 * Case sheets open without a second step:
 * - on clinic check-in, `appointment.checked_in` (emitted only after the SCHEDULED -> CONFIRMED
 *   status is committed, by every in-clinic entry point) auto-creates the appointment's OPD visit
 *   when none is linked yet — the doctor just opens the chart;
 * - when the consultation starts (in person or video), a draft visit is created so notes can be
 *   written during the visit.
 * Listens to the existing events; it adds no route. Never throws: a failed draft must not break
 * check-in or the start of a consultation — the doctor can still start the case sheet by hand
 * from the appointment. Idempotency: `ensureDraftVisitForAppointment` is find-first (one visit per
 * appointment) and a concurrent race on the unique link returns the winner's visit.
 */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { PatientVisitsService } from '@services/patient-visits/patient-visits.service';

interface ConsultationStartEvent {
  clinicId?: string;
  userId?: string;
  payload?: { appointmentId?: string; userRole?: string; userId?: string };
  metadata?: { appointmentId?: string };
}

/**
 * The `appointment.checked_in` envelope (see `buildCheckInEventPayload` and `liftEnvelopeFields`):
 * the envelope carries `clinicId` at the top level and the routing ids in `metadata`, while the
 * original payload (with `appointment` and `metadata` inside) sits under `payload`. Every in-clinic
 * check-in emits it after the CONFIRMED status is committed; video appointments never do (clinic
 * check-in rejects them).
 */
interface AppointmentCheckedInEvent {
  appointmentId?: string;
  clinicId?: string;
  payload?: {
    appointmentId?: string;
    checkedInBy?: string;
    appointment?: { appointmentId?: string; clinicId?: string };
    metadata?: { appointmentId?: string; checkedInBy?: string };
  };
  metadata?: { appointmentId?: string };
}

@Injectable()
export class PatientVisitEventsListener {
  constructor(
    private readonly visitsService: PatientVisitsService,
    private readonly loggingService: LoggingService
  ) {}

  /** In-person (or staff-started) consultation. */
  @OnEvent('appointment.consultation_started')
  async onConsultationStarted(event: ConsultationStartEvent): Promise<void> {
    await this.ensureDraft(event, event.payload?.appointmentId ?? event.metadata?.appointmentId);
  }

  /**
   * Clinic check-in: the appointment's OPD visit (the case sheet) is auto-created so the doctor
   * only opens the chart. `appointment.checked_in` is emitted after the CONFIRMED status is
   * committed and only by the in-clinic check-in paths — a video appointment is rejected by
   * clinic check-in, so this never creates a visit for one.
   *
   * `appointment.confirmed` is deliberately NOT hooked: payment completion emits it as well, so
   * it is not a clean check-in signal.
   */
  @OnEvent('appointment.checked_in')
  async onAppointmentCheckedIn(event: AppointmentCheckedInEvent): Promise<void> {
    const appointmentId =
      event.appointmentId ??
      event.payload?.appointmentId ??
      event.payload?.appointment?.appointmentId ??
      event.metadata?.appointmentId;
    const clinicId = event.clinicId ?? event.payload?.appointment?.clinicId;
    if (!appointmentId || !clinicId) {
      return;
    }

    try {
      // Find-first: a visit already linked to this appointment (created by the receptionist, by
      // the consultation-start listener, or by an earlier check-in) is left untouched.
      const existing = await this.visitsService.findVisitForAppointment(appointmentId, clinicId);
      if (existing) {
        return;
      }

      const actorUserId = event.payload?.checkedInBy ?? event.payload?.metadata?.checkedInBy;
      const visit = await this.visitsService.ensureDraftVisitForAppointment(
        appointmentId,
        clinicId,
        {
          ...(actorUserId ? { userId: actorUserId } : {}),
          role: 'system',
        }
      );
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `[CheckIn] Auto-created OPD visit ${visit.opdNumber} for appointment ${appointmentId}`,
        'PatientVisitEventsListener',
        { appointmentId, clinicId, visitId: visit.id, opdNumber: visit.opdNumber }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `[CheckIn] Auto-visit creation failed for appointment ${appointmentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'PatientVisitEventsListener',
        { appointmentId, clinicId }
      );
    }
  }

  /** Video consultation: only when the doctor starts, never when the patient joins. */
  @OnEvent('video.consultation.started')
  async onVideoConsultationStarted(event: ConsultationStartEvent): Promise<void> {
    if (String(event.payload?.userRole ?? '').toLowerCase() !== 'doctor') {
      return;
    }
    // The envelope's userId is the patient (the notification target); the doctor who started the
    // call is in the payload, and is the actor of the draft visit.
    await this.ensureDraft(event, event.payload?.appointmentId, event.payload?.userId);
  }

  private async ensureDraft(
    event: ConsultationStartEvent,
    appointmentId: string | undefined,
    actorUserId: string | undefined = event.userId
  ): Promise<void> {
    const clinicId = event.clinicId;
    if (!appointmentId || !clinicId) {
      return;
    }
    try {
      await this.visitsService.ensureDraftVisitForAppointment(appointmentId, clinicId, {
        ...(actorUserId ? { userId: actorUserId } : {}),
        role: 'system',
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Could not create the draft OPD visit: ${error instanceof Error ? error.message : String(error)}`,
        'PatientVisitEventsListener',
        { appointmentId, clinicId }
      );
    }
  }
}
