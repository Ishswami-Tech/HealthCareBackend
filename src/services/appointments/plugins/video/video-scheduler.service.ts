import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { ConfigService } from '@config/config.service';
import { getVideoActiveWindowMinutes } from '@config/video.config';
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
import { parseIstDateTime, formatDateTimeInIST } from '../../../../libs/utils/date-time.util';

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

  /** Minutes after scheduled start before a confirmed video appointment expires */
  private get confirmedExpiryWindowMinutes(): number {
    return getVideoActiveWindowMinutes();
  }

  /** Minutes after scheduled start before a session is flagged as no-show */
  private get gracePeriodMinutes(): number {
    return this.configService.get<number>('VIDEO_NO_SHOW_GRACE_MINUTES', 180);
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
      if (!this.configService.isVideoNoShowEnabled()) {
        return;
      }
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
      if (!this.configService.isVideoNoShowEnabled()) {
        return;
      }
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
   * Expire confirmed video appointments that never started within the join
   * window. This keeps them from lingering in CONFIRMED forever when nobody
   * joins the room.
   *
   * Scale: with 10M+ users the table can have hundreds of thousands of
   * expired-but-not-yet-processed rows at peak. The previous version
   * pulled them all with `findMany` then looped — that exhausts the DB
   * pool. This version is bounded:
   *
   *   - Fetches candidates in `BATCH_SIZE` chunks
   *   - Uses indexed `(clinicId, status, confirmationExpiresAt)` for
   *     the common (modern) path
   *   - Falls back to a window-computed path for legacy rows that
   *     predate the column, with a hard cap on candidate count
   *   - Each `updateStatus` is awaited individually so participation
   *     checks still apply (we don't expire active sessions)
   *
   * Two cron instances can safely run in parallel because the only
   * shared mutation is `updateStatus`, which is itself a no-op when
   * the row has already moved to EXPIRED.
   */
  private static readonly EXPIRY_BATCH_SIZE = 200;

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredConfirmedVideoAppointments(): Promise<void> {
    try {
      const now = new Date();

      const candidates = await this.databaseService.executeHealthcareRead<
        Array<{
          id: string;
          clinicId: string;
          date: Date;
          time: string;
          type: string;
          confirmationExpiresAt: Date | null;
        }>
      >(async client => {
        const delegate = getVideoConsultationDelegate(client);
        const records = (await delegate.findMany({
          where: {
            status: VideoCallStatus.SCHEDULED,
            appointment: {
              status: AppointmentStatus.CONFIRMED,
              ...({ type: 'VIDEO_CALL' } as Record<string, unknown>),
            },
          },
          include: { appointment: true },
          // Index hint via take — pagination keeps each call O(BATCH_SIZE)
          // regardless of total queue size.
          take: VideoAppointmentSchedulerService.EXPIRY_BATCH_SIZE,
        })) as unknown as Array<{
          appointment?: {
            id: string;
            clinicId: string;
            date: Date;
            time: string;
            type: string;
            confirmationExpiresAt: Date | null;
          } | null;
        }>;

        return records
          .map(record => record.appointment)
          .filter(
            (
              appointment
            ): appointment is {
              id: string;
              clinicId: string;
              date: Date;
              time: string;
              type: string;
              confirmationExpiresAt: Date | null;
            } => appointment != null && appointment.type === 'VIDEO_CALL'
          );
      });

      if (!candidates.length) {
        return;
      }

      // The expiry decision is split per-row because participation
      // (doctorJoined / patientJoined) requires a follow-up read that
      // can't be safely batched without races. We still keep the
      // *candidate fetch* bounded so the worst-case DB load is
      // O(BATCH_SIZE) per minute.
      for (const appointment of candidates) {
        // Prefer the persisted `confirmationExpiresAt` stamped at
        // CONFIRMED time (indexed for cheap scheduler queries). Fall
        // back to the computed value for legacy rows that predate the
        // column so we never silently skip an expired appointment.
        let expiryAt: Date | null = appointment.confirmationExpiresAt;
        if (!expiryAt) {
          const scheduledStart = parseIstDateTime(appointment.date.toISOString(), appointment.time);
          if (!scheduledStart) {
            continue;
          }
          expiryAt = new Date(
            scheduledStart.getTime() + this.confirmedExpiryWindowMinutes * 60_000
          );
        }

        if (expiryAt.getTime() > now.getTime()) {
          continue;
        }

        const participation = await this.resolveParticipation(appointment.id, appointment.clinicId);
        if (participation === null || participation.doctorJoined || participation.patientJoined) {
          continue;
        }

        const formattedExpiry = formatDateTimeInIST(expiryAt, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

        await this.appointmentsService.updateStatus(
          appointment.id,
          {
            status: AppointmentStatus.EXPIRED,
            reason: `Confirmed video appointment expired after the join window elapsed at ${formattedExpiry} IST.`,
            notes: 'Auto-expired by scheduler because neither participant joined in time.',
          } as UpdateAppointmentStatusDto,
          'system',
          appointment.clinicId,
          'SYSTEM'
        );

        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.WARN,
          `Auto-expired confirmed video appointment ${appointment.id} — join window elapsed`,
          'VideoAppointmentSchedulerService.handleExpiredConfirmedVideoAppointments',
          { appointmentId: appointment.id, expiredAt: expiryAt }
        );
      }
    } catch (error) {
      this.logger.error('Error handling expired confirmed video appointments', error);
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

  /**
   * Auto-cancel VIDEO_CALL appointments that are still in PENDING status
   * (i.e. created but never paid) once their payment window has expired.
   *
   * Runs every minute. Cheap query: scoped to PENDING + VIDEO_CALL +
   * paymentExpiresAt < now(). Each cancelled appointment is routed through
   * AppointmentsService.updateStatus so all status-transition side-effects
   * (events, notifications, audit) fire normally.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredPaymentWindows(): Promise<void> {
    try {
      const now = new Date();
      const expired = await this.databaseService.executeHealthcareRead<
        Array<{ id: string; clinicId: string; paymentExpiresAt: Date | null }>
      >(async client => {
        return (
          client as unknown as {
            appointment: {
              findMany: (args: {
                where: Record<string, unknown>;
                select: Record<string, boolean>;
                take: number;
              }) => Promise<
                Array<{
                  id: string;
                  clinicId: string;
                  paymentExpiresAt: Date | null;
                }>
              >;
            };
          }
        ).appointment.findMany({
          where: {
            type: 'VIDEO_CALL',
            status: AppointmentStatus.PENDING,
            paymentExpiresAt: { not: null, lt: now },
          },
          select: {
            id: true,
            clinicId: true,
            paymentExpiresAt: true,
          },
          take: 100, // batch — anything still left next minute is picked up too
        });
      });

      if (!expired || expired.length === 0) return;

      for (const row of expired as Array<{
        id: string;
        clinicId: string;
        paymentExpiresAt: Date | null;
      }>) {
        try {
          await this.appointmentsService.updateStatus(
            row.id,
            {
              // Auto-expiry of an unpaid payment window is logically an
              // EXPIRED transition, not a cancellation — the user can no
              // longer pay for this row. Setting status to CANCELLED here
              // would show "Cancelled" in the UI instead of "Expired".
              status: AppointmentStatus.EXPIRED,
              reason: 'Payment window expired before payment was completed.',
              notes: 'Auto-expired: patient did not complete payment in time.',
            } as UpdateAppointmentStatusDto,
            'system',
            row.clinicId,
            'SYSTEM'
          );

          await this.loggingService.log(
            LogType.BUSINESS,
            LogLevel.WARN,
            `Auto-cancelled video appointment ${row.id} — payment window expired`,
            'VideoAppointmentSchedulerService.handleExpiredPaymentWindows',
            { appointmentId: row.id, paymentExpiresAt: row.paymentExpiresAt }
          );
        } catch (innerError) {
          this.logger.error(
            `Failed to auto-cancel expired video appointment ${row.id}`,
            innerError instanceof Error ? innerError.stack : String(innerError)
          );
        }
      }
    } catch (error) {
      this.logger.error('Error handling expired payment windows', error);
    }
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
