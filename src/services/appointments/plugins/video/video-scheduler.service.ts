import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { ConfigService } from '@nestjs/config';
import { LogType, LogLevel } from '@core/types';
import { AppointmentStatus, UpdateAppointmentStatusDto } from '@dtos/appointment.dto';
import {
  VideoCallStatus,
  VideoParticipantRole,
} from '@infrastructure/database/prisma/generated/client';
import { AuditInfo } from '@core/types/database.types';
import { Role as RoleType } from '@core/types/rbac.types';
import {
  getVideoConsultationDelegate,
  VideoConsultationDbModel,
} from '@core/types/video-database.types';
import {
  VideoConsultationTracker,
  ConsultationMetrics,
  ParticipantStatus,
} from '@services/video/video-consultation-tracker.service';
import { AppointmentsService } from '@services/appointments/appointments.service';

/** Represents the join-status of both parties for a single appointment */
interface ParticipationStatus {
  doctorJoined: boolean;
  patientJoined: boolean;
}

/** Extended VideoConsultation with relations included from DB */
interface VideoConsultationWithAppointment extends VideoConsultationDbModel {
  appointment: {
    clinicId: string;
    doctorId: string;
    patientId: string;
    status: string;
  };
  participants: Array<{
    userId: string;
    role: string;
    joinedAt: Date | null;
  }>;
}

@Injectable()
export class VideoAppointmentSchedulerService {
  private readonly logger = new Logger(VideoAppointmentSchedulerService.name);

  /** Minutes after scheduled start before a session is flagged as no-show */
  private get gracePeriodMinutes(): number {
    return this.configService.get<number>('VIDEO_NO_SHOW_GRACE_MINUTES', 15);
  }

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => VideoConsultationTracker))
    private readonly consultationTracker: VideoConsultationTracker,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Crons — single responsibility per method
  // ─────────────────────────────────────────────────────────────

  /** Check for doctor no-shows: sessions that never started */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleDoctorNoShows(): Promise<void> {
    try {
      const graceTime = this.getGraceTime();
      const audit = this.buildSystemAudit();

      await this.databaseService.executeHealthcareWrite(async client => {
        const delegate = getVideoConsultationDelegate(client);
        const potentialNoShows = (await delegate.findMany({
          where: {
            status: VideoCallStatus.SCHEDULED,
            startTime: { lt: graceTime },
            appointment: {
              status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.SCHEDULED] },
            },
          },
          include: { appointment: true },
        })) as unknown as VideoConsultationWithAppointment[];

        for (const consultation of potentialNoShows) {
          if (!consultation.appointment) continue;

          const participation = await this.resolveParticipation(
            consultation.appointmentId,
            consultation.appointment.clinicId
          );

          if (participation === null) continue;

          if (!participation.doctorJoined) {
            await this.markNoShow(
              consultation.appointmentId,
              consultation.appointment.clinicId,
              'Doctor failed to join within grace period.',
              'Marked as Doctor No-Show (Session not started)'
            );

            await this.loggingService.log(
              LogType.BUSINESS,
              LogLevel.WARN,
              `Marked appointment ${consultation.appointmentId} as Doctor No-Show`,
              'VideoAppointmentSchedulerService.handleDoctorNoShows',
              { consultationId: consultation.id }
            );
          }
        }
      }, audit);
    } catch (error) {
      this.logger.error('Error handling doctor no-shows', error);
    }
  }

  /** Check for patient no-shows: active sessions where patient never joined */
  @Cron(CronExpression.EVERY_MINUTE)
  async handlePatientNoShows(): Promise<void> {
    try {
      const graceTime = this.getGraceTime();
      const audit = this.buildSystemAudit();

      await this.databaseService.executeHealthcareWrite(async client => {
        const delegate = getVideoConsultationDelegate(client);
        const activeConsultations = (await delegate.findMany({
          where: {
            status: VideoCallStatus.ACTIVE,
            startTime: { lt: graceTime },
            appointment: {
              status: {
                in: [
                  AppointmentStatus.CONFIRMED,
                  AppointmentStatus.SCHEDULED,
                  AppointmentStatus.IN_PROGRESS,
                ],
              },
            },
          },
          include: { participants: true, appointment: true },
        })) as unknown as VideoConsultationWithAppointment[];

        for (const consultation of activeConsultations) {
          if (!consultation.appointment) continue;

          const participation = await this.resolveParticipation(
            consultation.appointmentId,
            consultation.appointment.clinicId
          );

          if (participation === null) continue;

          if (participation.doctorJoined && !participation.patientJoined) {
            await this.markNoShow(
              consultation.appointmentId,
              consultation.appointment.clinicId,
              'Patient failed to join within grace period.',
              'Marked as Patient No-Show'
            );

            await this.loggingService.log(
              LogType.BUSINESS,
              LogLevel.WARN,
              `Marked appointment ${consultation.appointmentId} as Patient No-Show`,
              'VideoAppointmentSchedulerService.handlePatientNoShows',
              { consultationId: consultation.id }
            );
          } else if (!participation.doctorJoined && !participation.patientJoined) {
            await this.markNoShow(
              consultation.appointmentId,
              consultation.appointment.clinicId,
              'Neither participant joined within grace period.',
              'No-Show (Both parties)'
            );
          }
        }
      }, audit);
    } catch (error) {
      this.logger.error('Error handling patient no-shows', error);
    }
  }

  /**
   * Expire pending video appointment proposals that have passed their deadline.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleExpiredProposals(): Promise<void> {
    // Placeholder for future implementation
  }

  // ─────────────────────────────────────────────────────────────
  // Private shared helpers (DRY)
  // ─────────────────────────────────────────────────────────────

  /**
   * Check who actually joined via the consultation tracker (real-time metrics).
   * Falls back to the VideoConsultation DB record when tracker has no data.
   * Returns null if we should skip no-show processing (e.g. session already happened).
   */
  private async resolveParticipation(
    appointmentId: string,
    _clinicId: string
  ): Promise<ParticipationStatus | null> {
    const metrics: ConsultationMetrics | null =
      await this.consultationTracker.getConsultationMetrics(appointmentId);

    if (metrics?.participants) {
      const doctor = metrics.participants.find((p: ParticipantStatus) => p.userRole === 'doctor');
      const patient = metrics.participants.find((p: ParticipantStatus) => p.userRole === 'patient');
      return {
        doctorJoined: !!(doctor && (doctor.joinedAt || doctor.isOnline)),
        patientJoined: !!(patient && (patient.joinedAt || patient.isOnline)),
      };
    }

    // Fallback: Check DB VideoConsultation record status
    const videoConsultation = (await this.databaseService.executeHealthcareRead(async client => {
      const delegate = getVideoConsultationDelegate(client);
      return delegate.findFirst({
        where: { appointmentId },
        include: { participants: true, appointment: true },
      });
    })) as unknown as VideoConsultationWithAppointment | null;

    if (
      videoConsultation?.status === VideoCallStatus.COMPLETED ||
      videoConsultation?.status === VideoCallStatus.ACTIVE
    ) {
      const doctorJoined = videoConsultation.participants?.some(
        p =>
          (p.userId === videoConsultation.appointment.doctorId ||
            p.role === VideoParticipantRole.HOST) &&
          p.joinedAt
      );
      const patientJoined = videoConsultation.participants?.some(
        p =>
          (p.userId === videoConsultation.appointment.patientId ||
            p.role === VideoParticipantRole.PARTICIPANT) &&
          p.joinedAt
      );

      return {
        doctorJoined: !!doctorJoined,
        patientJoined: !!patientJoined,
      };
    }

    return { doctorJoined: false, patientJoined: false };
  }

  /** Centralized no-show marker using AppointmentsService state machine */
  private async markNoShow(
    appointmentId: string,
    clinicId: string,
    reason: string,
    notes: string
  ): Promise<void> {
    await this.appointmentsService.updateStatus(
      appointmentId,
      { status: AppointmentStatus.NO_SHOW, reason, notes } as UpdateAppointmentStatusDto,
      'system',
      clinicId,
      'SYSTEM'
    );

    // Also cancel the video session record
    await this.databaseService.executeHealthcareWrite(async client => {
      const delegate = getVideoConsultationDelegate(client);
      await delegate.updateMany({
        where: { appointmentId, status: { not: VideoCallStatus.CANCELLED } },
        data: { status: VideoCallStatus.CANCELLED },
      });
    }, this.buildSystemAudit());
  }

  /** Returns the point-in-time before which an unstarted session is a no-show */
  private getGraceTime(): Date {
    return new Date(Date.now() - this.gracePeriodMinutes * 60_000);
  }

  /** Builds the standard system audit object — single source of truth */
  private buildSystemAudit(): AuditInfo {
    return {
      userId: 'system-scheduler',
      userRole: 'SYSTEM' as unknown as RoleType,
      ipAddress: '127.0.0.1',
      userAgent: 'VideoAppointmentScheduler',
      operation: 'UPDATE',
      resourceType: 'appointment',
      clinicId: 'system',
    };
  }
}
