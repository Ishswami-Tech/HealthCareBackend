/**
 * Creates the OPD visit of an appointment as a draft when the doctor starts the consultation, so
 * the case sheet exists while the patient is in front of the doctor (or on the call).
 * Listens to the existing consultation-start events; it adds no route. Never throws: a failed
 * draft must not break the start of a consultation, the doctor can still start the case sheet by
 * hand from the appointment.
 */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { PatientVisitsService } from '@services/patient-visits/patient-visits.service';

interface ConsultationStartEvent {
  clinicId?: string;
  userId?: string;
  payload?: { appointmentId?: string; userRole?: string };
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

  /** Video consultation: only when the doctor starts, never when the patient joins. */
  @OnEvent('video.consultation.started')
  async onVideoConsultationStarted(event: ConsultationStartEvent): Promise<void> {
    if (String(event.payload?.userRole ?? '').toLowerCase() !== 'doctor') {
      return;
    }
    await this.ensureDraft(event, event.payload?.appointmentId);
  }

  private async ensureDraft(
    event: ConsultationStartEvent,
    appointmentId: string | undefined
  ): Promise<void> {
    const clinicId = event.clinicId;
    if (!appointmentId || !clinicId) {
      return;
    }
    try {
      await this.visitsService.ensureDraftVisitForAppointment(appointmentId, clinicId, {
        ...(event.userId ? { userId: event.userId } : {}),
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
