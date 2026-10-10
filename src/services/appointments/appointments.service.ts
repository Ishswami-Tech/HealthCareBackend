import {
  Injectable,
  Inject,
  forwardRef,
  HttpException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@config/config.service';
import { getVideoActiveWindowMinutes, getVideoEarlyJoinMinutes } from '@config/video.config';

// Infrastructure Services
import { CacheService } from '@infrastructure/cache/cache.service';
import { QueueService, AppointmentQueueService } from '@infrastructure/queue';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
import type { EnterpriseEventPayload } from '@core/types/event.types';
import { HealthcareErrorsService } from '@core/errors';
import { HealthcareError } from '@core/errors';
import { RbacService } from '@core/rbac/rbac.service';
import {
  parseIstDateTime,
  formatDateInIST,
  formatDateTimeInIST,
  formatDateKeyInIST,
  IST_TIMEZONE,
  nowIso,
} from '../../libs/utils/date-time.util';

// Core Services
import { CoreAppointmentService } from './core/core-appointment.service';
import type { AppointmentContext, AppointmentResult } from '@core/types/appointment.types';
import { ConflictResolutionService } from './core/conflict-resolution.service';
import { AppointmentWorkflowEngine } from './core/appointment-workflow-engine.service';
import { BusinessRulesEngine } from './core/business-rules-engine.service';

// Plugin System - Hybrid approach: Direct injection for hot paths + Registry for cross-service
import { EnterprisePluginRegistry, EnterprisePluginManager } from '@core/plugin-interface';
import type { PluginContext } from '@core/types';

// Direct Plugin Imports - Hot-path plugins (top 5 most frequently used)
// These are directly injected for performance (10M+ users scale)

import { ClinicCheckInPlugin } from './plugins/checkin/clinic-checkin.plugin';
import { ClinicNotificationPlugin } from './plugins/notifications/clinic-notification.plugin';
import { ClinicConfirmationPlugin } from './plugins/confirmation/clinic-confirmation.plugin';
import { ClinicLocationPlugin } from './plugins/location/clinic-location.plugin';
import { ClinicFollowUpPlugin } from './plugins/followup/clinic-followup.plugin';
import { AppointmentReminderService } from './plugins/reminders/appointment-reminder.service';
import { ClinicVideoPlugin } from './plugins/video/clinic-video.plugin';
import { CheckInService } from './plugins/checkin/check-in.service';

// DTOs and Types
import { Prisma, $Enums } from '@infrastructure/database/prisma/generated/client';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
  AppointmentFilterDto,
  AppointmentStatus,
  AppointmentType,
  TreatmentType,
  AppointmentServiceMetadataDto,
  AppointmentPriority,
  ProcessCheckInDto,
  CompleteAppointmentDto,
  BulkCompleteAppointmentDto,
  StartConsultationDto,
  ProposeVideoSlotsDto,
  ConfirmVideoSlotDto,
  ConfirmVideoFinalSlotDto,
  AppointmentDailySummaryDto,
} from '@dtos/appointment.dto';
import { Role } from '@core/types/enums.types';
import { isPaidPaymentStatus, normalizePaymentStatus } from '@utils/currency.util';
import {
  findTreatmentCatalogEntry,
  getAppointmentTreatmentCatalog,
} from '@core/types/treatment-catalog.types';
import { isVideoCallAppointmentType } from '@core/types/appointment-guards.types';
import {
  APPOINTMENT_TERMINAL_STATUSES,
  PATIENT_STATUS_CHANGE_MESSAGE,
  getGenericStatusChangeRefusal,
  isAppointmentStaffRole,
  isAppointmentSystemRole,
  isSystemOnlyStatusTransition,
  isValidAppointmentStatusTransition,
  isVideoSlotAwaitingConfirmation,
} from './core/appointment-state-contract';
import { isAppointmentPaid } from './core/appointment-payment.util';
import {
  isRescheduleStatusAllowed,
  isVideoAppointmentType,
  reschedulePinnedWhere,
  rescheduleStatusRefusal,
  shouldDropFromQueueAfterMove,
  statusAfterReschedule,
} from './core/reschedule-policy';
import {
  findConflictingSlotKind,
  loadDoctorDayAppointments,
  slotConflictMessage,
} from './core/appointment-slot-conflict.util';
import {
  isAppointmentOwnedByPatientUser,
  isReceptionistAssignedToAppointmentLocation,
} from './core/appointment-access.util';

// Legacy imports for backward compatibility
import { DatabaseService } from '@infrastructure/database';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { QrService } from '@utils/QR';

// Auth Integration
import { AuthService } from '@services/auth/auth.service';
import { NotificationPreferenceService } from '@services/notification/notification-preference.service';
import { BillingService } from '@services/billing/billing.service';

// Use centralized types
import type { AppointmentWithRelations } from '@core/types/database.types';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import { getVideoConsultationDelegate } from '@core/types/video-database.types';
import { startOfIstDay, endOfIstDay } from '@utils/clock.util';

type AssistantDoctorCoverageEntry = {
  assistantDoctorId: string;
  primaryDoctorIds: string[];
  isActive: boolean;
};

type AssistantDoctorCoverageAssignmentRecord = {
  assistantDoctorId: string;
  primaryDoctorId: string;
  isActive: boolean;
};

/** The appointment columns completion decides on, read fresh (never from the detail cache). */
interface CompletionAppointmentRow {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  userId: string;
  type: string;
  status: string;
  date?: Date | string | null;
  time?: string | null;
  metadata?: unknown;
  completedAt?: Date | string | null;
  doctor?: { id: string; userId: string } | null;
  payment?: { status?: string | null; invoice?: { status?: string | null } | null } | null;
  subscriptionId?: string | null;
  isSubscriptionBased?: boolean | null;
}

/** The appointment columns the generic update decides on, read fresh (never from the detail cache). */
interface AppointmentStatusSnapshot {
  id: string;
  type: string;
  status: string;
}

/** A row the expiry crons scan: just the columns needed to decide whether it is due. */
interface ExpiryCandidate {
  id: string;
  patientId: string;
  userId: string;
  doctorId: string;
  clinicId: string;
  date: Date;
  time: string;
  duration?: number | null;
  status: string;
  type: string;
  /** Only read when the scan asks for it (withPayment): whether the visit was paid or comped. */
  subscriptionId?: string | null;
  isSubscriptionBased?: boolean | null;
  payment?: { status?: string | null; invoice?: { status?: string | null } | null } | null;
}

/** The appointment columns a reschedule decides on, read fresh (never from the detail cache). */
interface RescheduleAppointmentRow {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  /** Booking user (the patient's User id): the dashboard summary cache is tagged with it. */
  userId?: string | null;
  locationId?: string | null;
  type: string;
  status: string;
  date: Date;
  time: string;
  checkedInAt?: Date | string | null;
  metadata?: unknown;
}

/**
 * Enhanced Appointments Service
 *
 * This service integrates with the new enhanced service layer architecture:
 * - Uses CoreAppointmentService for enterprise-grade operations
 * - Integrates with plugin system for extensible functionality (Hybrid Approach)
 * - Maintains backward compatibility with existing code
 * - Provides enhanced features through the new architecture
 *
 * Plugin System - Hybrid Approach (Optimized for 10M+ Users):
 * ============================================================
 *
 * HOT-PATH PLUGINS (Direct Injection):
 * - ClinicQueuePlugin: Queue operations (very frequent)
 * - ClinicCheckInPlugin: Check-in operations (very frequent)
 * - ClinicNotificationPlugin: Notifications (every appointment action)
 * - ClinicConfirmationPlugin: Confirmations (common)
 * - ClinicLocationPlugin: Location queries (moderate frequency)
 *
 * Performance Benefits:
 * - Direct injection eliminates registry lookup overhead (~0.1ms per call)
 * - Full TypeScript type safety with IDE autocomplete
 * - Zero overhead for hot-path operations
 * - Critical for 10M+ concurrent users - handles 80% of traffic
 *
 * REGISTRY-BASED PLUGINS (Less Frequent):
 * - ClinicAnalyticsPlugin: Analytics (batch/background jobs)
 * - ClinicReminderPlugin: Reminders (scheduled jobs)
 * - ClinicVideoPlugin: Video consultations (medium-low frequency)
 * - ClinicPaymentPlugin: Payment processing (only when needed)
 * - Others: Lower frequency operations
 *
 * Registry Benefits:
 * - Cross-service plugin discovery
 * - Dynamic plugin loading
 * - Feature flags and conditional plugins
 * - Health monitoring and metrics
 *
 * All plugins are automatically registered via AppointmentPluginInitializer
 * on module startup, ensuring both direct and registry access work seamlessly.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    // Enhanced Services
    @Inject(forwardRef(() => CoreAppointmentService))
    private readonly coreAppointmentService: CoreAppointmentService,
    @Inject(forwardRef(() => ConflictResolutionService))
    private readonly conflictResolutionService: ConflictResolutionService,
    @Inject(forwardRef(() => AppointmentWorkflowEngine))
    private readonly workflowEngine: AppointmentWorkflowEngine,
    @Inject(forwardRef(() => BusinessRulesEngine))
    private readonly businessRules: BusinessRulesEngine,

    // Plugin System - Hybrid Approach (Optimized for 10M+ users)
    // Registry-based: For cross-service discovery, dynamic loading, and less frequent plugins
    @Inject(forwardRef(() => EnterprisePluginRegistry))
    private readonly pluginRegistry: EnterprisePluginRegistry,
    @Inject(forwardRef(() => EnterprisePluginManager))
    private readonly pluginManager: EnterprisePluginManager,

    // Direct Injection: Hot-path plugins (top 5 most frequently used)
    // Performance: Direct access eliminates registry lookup overhead (~0.1ms saved per call)
    // Type Safety: Full TypeScript support with IDE autocomplete
    // Scale: Critical for 10M+ concurrent users - these plugins handle 80% of traffic
    @Inject(forwardRef(() => ClinicCheckInPlugin))
    private readonly clinicCheckInPlugin: ClinicCheckInPlugin, // Hot path: Check-in operations (very frequent)
    @Inject(forwardRef(() => CheckInService))
    private readonly checkInService: CheckInService,
    @Inject(forwardRef(() => ClinicNotificationPlugin))
    private readonly clinicNotificationPlugin: ClinicNotificationPlugin, // Hot path: Notifications (every appointment action)
    @Inject(forwardRef(() => ClinicConfirmationPlugin))
    private readonly clinicConfirmationPlugin: ClinicConfirmationPlugin, // Hot path: Confirmations (common)
    @Inject(forwardRef(() => ClinicLocationPlugin))
    private readonly clinicLocationPlugin: ClinicLocationPlugin, // Medium: Location queries (moderate frequency)
    @Inject(forwardRef(() => ClinicFollowUpPlugin))
    private readonly clinicFollowUpPlugin: ClinicFollowUpPlugin, // Medium: Follow-up operations (moderate frequency)
    @Inject(forwardRef(() => AppointmentReminderService))
    private readonly appointmentReminderService: AppointmentReminderService,
    @Inject(forwardRef(() => ClinicVideoPlugin))
    private readonly clinicVideoPlugin: ClinicVideoPlugin, // Video consultations (medium-low frequency)

    // Infrastructure Services
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService)) private readonly cacheService: CacheService,
    // Queue Service - BullMQ-based queue system
    // Use QueueService from @infrastructure/queue (migrated from Bull to BullMQ)
    // All jobs now route through HEALTHCARE_QUEUE via JobType enum
    @Inject(forwardRef(() => QueueService)) private readonly queueService: QueueService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly appointmentQueueService: AppointmentQueueService,
    @Inject(forwardRef(() => EventService)) private readonly eventService: EventService,
    @Inject(forwardRef(() => ConfigService)) private readonly configService: ConfigService,

    // Legacy Services (for backward compatibility)
    @Inject(forwardRef(() => DatabaseService)) private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => QrService)) private readonly qrService: QrService,

    // Auth Integration
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    @Inject(forwardRef(() => WhatsAppService)) private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => NotificationPreferenceService))
    private readonly notificationPreferenceService: NotificationPreferenceService,

    // Error Handling & RBAC
    @Inject(forwardRef(() => HealthcareErrorsService))
    private readonly errors: HealthcareErrorsService,
    @Inject(forwardRef(() => RbacService))
    private readonly rbacService: RbacService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService
  ) {}

  // =============================================
  // NO-SHOW CANCELLATION CRON JOB
  // =============================================

  private readonly DEFAULT_NO_SHOW_SETTINGS = {
    checkDaysBefore: 1, // Check yesterday's appointments
    checkStatuses: ['SCHEDULED', 'CONFIRMED'] as const,
    sendPatientNotifications: true,
  };

  private readonly DEFAULT_SLOT_CONFIRMATION_EXPIRY_SETTINGS = {
    graceMinutes: 0,
    checkStatuses: [AppointmentStatus.SCHEDULED] as const,
  };

  private async emitAppointmentEnterpriseEvent(
    eventType:
      | 'appointment.created'
      | 'appointment.updated'
      | 'appointment.reassigned'
      | 'appointment.cancelled'
      | 'appointment.completed'
      | 'appointment.noshow'
      | 'appointment.expired'
      | 'appointment.consultation_started',
    params: {
      eventId: string;
      clinicId: string;
      payload: Record<string, unknown>;
      userId?: string;
      metadata?: Record<string, unknown>;
      priority?: EventPriority;
      source?: string;
    }
  ): Promise<void> {
    await this.eventService.emitEnterprise(eventType, {
      eventId: params.eventId,
      eventType,
      category: EventCategory.APPOINTMENT,
      priority: params.priority ?? EventPriority.HIGH,
      timestamp: nowIso(),
      source: params.source ?? 'AppointmentsService',
      version: '1.0.0',
      ...(params.userId ? { userId: params.userId } : {}),
      clinicId: params.clinicId,
      ...(params.metadata ? { metadata: params.metadata } : {}),
      payload: params.payload,
    } as EnterpriseEventPayload);
  }

  private resolveAppointmentReminderScheduledFor(
    appointmentDate: string | undefined,
    appointmentTime: string | undefined,
    hoursBefore: number
  ): Date {
    const appointmentDateTime =
      parseIstDateTime(appointmentDate, appointmentTime) ??
      (appointmentDate ? new Date(appointmentDate) : null);

    if (appointmentDateTime instanceof Date && !Number.isNaN(appointmentDateTime.getTime())) {
      return new Date(appointmentDateTime.getTime() - hoursBefore * 60 * 60 * 1000);
    }

    return new Date(Date.now() + hoursBefore * 60 * 60 * 1000);
  }

  async processExpiredVideoSessionClosures(settings?: {
    scheduledThresholdMinutes?: number;
    inProgressThresholdMinutes?: number;
  }): Promise<{
    totalChecked: number;
    closed: number;
    failed: number;
    details: Array<{
      appointmentId: string;
      clinicId: string;
      closedAt: Date;
      reason: string;
    }>;
  }> {
    const mergedSettings = {
      scheduledThresholdMinutes: 15,
      inProgressThresholdMinutes: 45,
      ...settings,
    };

    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + istOffset);

    const candidates = await this.databaseService.executeHealthcareRead(async client => {
      const prismaClient = client as unknown as Prisma.TransactionClient;
      return await prismaClient.$queryRaw<
        Array<{
          id: string;
          appointmentId: string;
          patientId: string;
          doctorId: string;
          clinicId: string;
          status: string;
          startTime: Date | null;
          createdAt: Date;
        }>
      >`
        SELECT id, "appointmentId", "patientId", "doctorId", "clinicId",
               status, "startTime", "createdAt"
        FROM video_consultations
        WHERE status IN ('SCHEDULED', 'IN_PROGRESS')
          AND (
            (status = 'SCHEDULED' AND "createdAt" < ${new Date(
              nowIST.getTime() - mergedSettings.scheduledThresholdMinutes * 60 * 1000
            )}::timestamp)
            OR
            (status = 'IN_PROGRESS' AND "startTime" IS NOT NULL
             AND "startTime" < ${new Date(
               nowIST.getTime() - mergedSettings.inProgressThresholdMinutes * 60 * 1000
             )}::timestamp)
          )
      `;
    });

    const details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      clinicId: string;
      closedAt: Date;
      reason: string;
    }> = [];
    let closedCount = 0;
    let failedCount = 0;

    for (const consultation of candidates) {
      const threshold =
        consultation.status === 'SCHEDULED'
          ? mergedSettings.scheduledThresholdMinutes
          : mergedSettings.inProgressThresholdMinutes;

      const formattedStart = consultation.startTime
        ? formatDateTimeInIST(consultation.startTime, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : formatDateTimeInIST(consultation.createdAt, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });

      let reason: string;
      if (consultation.status === 'SCHEDULED') {
        reason =
          `Auto-expired: video consultation was not joined within ${threshold} minutes of creation (${formattedStart} IST). ` +
          `The session has been closed.`;
      } else {
        reason =
          `Auto-closed: video session exceeded the ${threshold}-minute hard cap (started at ${formattedStart} IST). ` +
          `The session has been closed.`;
      }

      try {
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const prismaClient = client as unknown as Prisma.TransactionClient;
            const delegate = getVideoConsultationDelegate(prismaClient);

            const endTime = nowIST;
            const startTime = consultation.startTime
              ? new Date(consultation.startTime)
              : new Date(consultation.createdAt);
            const durationSeconds = Math.max(
              0,
              Math.floor((endTime.getTime() - startTime.getTime()) / 1000)
            );

            await delegate.update({
              where: { id: consultation.id },
              data: {
                status: 'COMPLETED',
                endTime,
                duration: durationSeconds,
              },
            });

            const existing = await prismaClient.appointment.findUnique({
              where: { id: consultation.appointmentId },
              select: { id: true, status: true },
            });

            if (existing) {
              const existingStatus = existing.status as unknown as AppointmentStatus;
              if (
                existingStatus !== AppointmentStatus.COMPLETED &&
                existingStatus !== AppointmentStatus.EXPIRED &&
                existingStatus !== AppointmentStatus.CANCELLED
              ) {
                await prismaClient.appointment.update({
                  where: { id: consultation.appointmentId },
                  data: { status: AppointmentStatus.COMPLETED },
                });
              }
            }
          },
          {
            userId: 'system',
            userRole: 'SYSTEM',
            clinicId: consultation.clinicId,
            operation: 'UPDATE_VIDEO_CONSULTATION',
            resourceType: 'VIDEO_CONSULTATION',
            resourceId: consultation.id,
            timestamp: nowIST,
            details: {
              appointmentId: consultation.appointmentId,
              doctorId: consultation.doctorId,
              status: 'COMPLETED',
              reason,
            },
          }
        );

        await this.emitAppointmentEnterpriseEvent('appointment.completed', {
          eventId: `video-session-closed-${consultation.appointmentId}-${Date.now()}`,
          clinicId: consultation.clinicId,
          priority: EventPriority.HIGH,
          userId: consultation.patientId,
          payload: {
            appointmentId: consultation.appointmentId,
            doctorId: consultation.doctorId,
            clinicId: consultation.clinicId,
            patientId: consultation.patientId,
            videoConsultationId: consultation.id,
            reason,
            appointment: {
              id: consultation.appointmentId,
              status: AppointmentStatus.COMPLETED,
            },
          },
        });

        closedCount++;
        details.push({
          appointmentId: consultation.appointmentId,
          patientId: consultation.patientId,
          doctorId: consultation.doctorId,
          clinicId: consultation.clinicId,
          closedAt: nowIST,
          reason,
        });
      } catch (error) {
        failedCount++;
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          `Failed to auto-close video session: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          'AppointmentsService.processExpiredVideoSessionClosures',
          {
            videoConsultationId: consultation.id,
            appointmentId: consultation.appointmentId,
            clinicId: consultation.clinicId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    return {
      totalChecked: candidates.length,
      closed: closedCount,
      failed: failedCount,
      details,
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNoShowCancellationCron() {
    await this.processNoShowCancellations();
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: IST_TIMEZONE })
  async handleDoctorDailyAppointmentSummaryCron() {
    await this.triggerDoctorDailySummary({ triggeredBy: 'cron' });
  }

  /**
   * Shared implementation for the 7 AM cron and the manual-trigger endpoint.
   * Enqueues one DOCTOR_SUMMARY job per doctor-clinic pair.
   */
  async triggerDoctorDailySummary(opts: { triggeredBy?: string; dateKey?: string } = {}) {
    const runStart = Date.now();
    const todayKey = opts.dateKey || formatDateKeyInIST(new Date());
    const triggeredBy = opts.triggeredBy || 'manual';

    const istDay = new Date(
      new Date().toLocaleString('en-US', { timeZone: IST_TIMEZONE })
    ).getDay();
    if (istDay === 0 || istDay === 6) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.DEBUG,
        'Doctor daily appointment summary skipped — weekend',
        'AppointmentsService',
        { todayKey, istDay, triggeredBy }
      );
      return {
        skipped: true,
        reason: 'weekend',
        todayKey,
        enqueuedCount: 0,
        skipCount: 0,
        totalDoctors: 0,
      };
    }

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      'Doctor daily appointment summary started',
      'AppointmentsService',
      { todayKey, triggeredBy }
    );

    const doctorClinics = await this.databaseService.executeHealthcareRead<
      Array<{ doctor: { id: string; userId: string }; clinicId: string }>
    >(async client => {
      const prismaClient = client as unknown as Prisma.TransactionClient;
      return await prismaClient.doctorClinic.findMany({
        select: {
          doctorId: true,
          clinicId: true,
          doctor: { select: { id: true, userId: true } },
        },
      });
    });

    let enqueuedCount = 0;
    let skipCount = 0;

    for (const dc of doctorClinics) {
      try {
        const deterministicJobId = `doctor-summary-${dc.doctor.userId}-${dc.clinicId}-${todayKey}-${triggeredBy}`;

        const existingJob = await this.queueService.getJob('healthcare-queue', deterministicJobId);
        if (existingJob) {
          skipCount++;
          continue;
        }

        await this.queueService.addJob(
          JobType.DOCTOR_SUMMARY,
          'send-doctor-daily-summary',
          {
            doctorId: dc.doctor.id,
            doctorUserId: dc.doctor.userId,
            clinicId: dc.clinicId,
            triggeredBy,
          },
          {
            priority: JobPriorityLevel.NORMAL,
            correlationId: deterministicJobId,
            attempts: 3,
          }
        );
        enqueuedCount++;
      } catch (error) {
        void this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.ERROR,
          `Failed to enqueue doctor summary for doctor ${dc.doctor.userId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'AppointmentsService',
          { doctorId: dc.doctor.id, error }
        );
      }
    }

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      'Doctor daily appointment summary completed — jobs enqueued',
      'AppointmentsService',
      {
        todayKey,
        totalDoctors: doctorClinics.length,
        enqueuedCount,
        skipCount,
        durationMs: Date.now() - runStart,
        triggeredBy,
      }
    );

    return {
      skipped: false,
      todayKey,
      enqueuedCount,
      skipCount,
      totalDoctors: doctorClinics.length,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredVideoSlotConfirmationCron() {
    await this.processExpiredVideoSlotConfirmations();
  }

  async processExpiredVideoSlotConfirmations(settings?: {
    graceMinutes?: number;
    checkStatuses?: readonly AppointmentStatus[];
    clinicId?: string;
  }): Promise<{
    totalChecked: number;
    cancelled: number;
    failed: number;
    details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      expiredAt: Date;
      reason: string;
    }>;
  }> {
    const mergedSettings = { ...this.DEFAULT_SLOT_CONFIRMATION_EXPIRY_SETTINGS, ...settings };
    const now = new Date();
    const expiryCutoff = new Date(now.getTime() - mergedSettings.graceMinutes * 60 * 1000);

    const cacheKey = `cron:appointments:expired-slot:${Math.floor(now.getTime() / 60000)}`;
    const candidates = await this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.executeHealthcareRead(async client => {
          const prismaClient = client as unknown as Prisma.TransactionClient;
          return await prismaClient.appointment.findMany({
            where: {
              type: AppointmentType.VIDEO_CALL,
              status: { in: mergedSettings.checkStatuses as unknown as $Enums.AppointmentStatus[] },
              confirmedSlotIndex: null,
              ...(mergedSettings.clinicId ? { clinicId: mergedSettings.clinicId } : {}),
            },
            select: {
              id: true,
              patientId: true,
              doctorId: true,
              clinicId: true,
              date: true,
              time: true,
              proposedSlots: true,
              status: true,
            },
          });
        });
      },
      { ttl: 60, compress: false }
    );

    const details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      expiredAt: Date;
      reason: string;
    }> = [];
    let cancelledCount = 0;
    let failedCount = 0;

    for (const appointment of candidates) {
      const expiryAt = this.resolveVideoSlotConfirmationExpiry(appointment);
      if (!expiryAt || expiryAt.getTime() > expiryCutoff.getTime()) {
        continue;
      }

      const formattedExpiry = formatDateTimeInIST(expiryAt, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const reason = `Auto-expired: payment/slot confirmation window expired at ${formattedExpiry} IST. The doctor did not confirm a slot within 3 hours, so the booking is void. Please retry the booking to continue.`;

      try {
        // Auto-expiry of the slot-confirmation window is logically an
        // EXPIRED transition (not a cancellation). Going through
        // `cancelAppointment` here would render "Cancelled" in the UI
        // and trigger the refund path. Use `updateStatus` with the
        // EXPIRED target so the row reflects "no longer actionable".
        const updateResult = await this.updateStatus(
          appointment.id,
          {
            status: AppointmentStatus.EXPIRED,
            reason,
            notes: 'Auto-expired by slot-confirmation scheduler.',
          } as UpdateAppointmentStatusDto,
          'system',
          appointment.clinicId,
          'SYSTEM'
        );

        const updateRecord = (updateResult as Record<string, unknown> | null) || {};
        const updateOk =
          updateResult !== null &&
          updateResult !== undefined &&
          (updateRecord['success'] === true ||
            updateRecord['success'] === undefined ||
            typeof updateRecord === 'object');

        if (!updateOk) {
          const updateMessage =
            typeof updateRecord['message'] === 'string'
              ? updateRecord['message']
              : typeof updateRecord['error'] === 'string'
                ? updateRecord['error']
                : 'Unknown update failure';

          failedCount++;
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            `Failed to auto-expire video slot confirmation: ${updateMessage}`,
            'AppointmentsService.processExpiredVideoSlotConfirmations',
            {
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              status: appointment.status,
            }
          );
          continue;
        }

        cancelledCount++;
        details.push({
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          expiredAt: expiryAt,
          reason,
        });
      } catch (error) {
        failedCount++;
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          `Failed to auto-cancel expired video slot confirmation: ${error instanceof Error ? error.message : String(error)}`,
          'AppointmentsService.processExpiredVideoSlotConfirmations',
          {
            appointmentId: appointment.id,
            clinicId: appointment.clinicId,
            status: appointment.status,
          }
        );
      }
    }

    if (details.length > 0 || failedCount > 0) {
      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Processed expired video slot confirmations',
        'AppointmentsService.processExpiredVideoSlotConfirmations',
        {
          totalChecked: candidates.length,
          cancelled: cancelledCount,
          failed: failedCount,
        }
      );
    }

    return {
      totalChecked: candidates.length,
      cancelled: cancelledCount,
      failed: failedCount,
      details,
    };
  }

  /**
   * Closes every video visit that is still open when its window ends (scheduled start +
   * VIDEO_ACTIVE_WINDOW_MINUTES, 5 hours by default): confirmed visits nobody joined and
   * visits the doctor started but never completed. They become EXPIRED, never COMPLETED.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePastVideoCallClosureCron(): Promise<void> {
    // One replica per tick. The lock is deliberately not released: it expires just before the
    // next tick, so a replica whose cron fires a moment later still sees it and skips.
    const acquired = await this.acquireCronLock(
      AppointmentsService.PAST_VIDEO_CLOSURE_LOCK_KEY,
      AppointmentsService.PAST_VIDEO_CLOSURE_LOCK_TTL_SECONDS,
      'AppointmentsService.handlePastVideoCallClosureCron'
    );
    if (!acquired) {
      return;
    }
    await this.processPastVideoCallClosures();
  }

  /**
   * Expires in-clinic visits that never happened, hourly (at :20, away from the 3 AM no-show
   * cron). Only SCHEDULED and CONFIRMED rows are ever touched: a visit that was started or ended
   * is left alone. The payment is not touched either; the patient simply books again.
   *
   * Which cron ends a row: paid (or plan-covered) visits and checked-in visits end here as
   * EXPIRED, never cancelled, so billing sees no cancellation. Unpaid visits nobody arrived for are
   * left to the 3 AM no-show cron, which skips everything this one handles.
   */
  @Cron('20 * * * *')
  async handleExpiredInPersonAppointmentsCron(): Promise<void> {
    const acquired = await this.acquireCronLock(
      AppointmentsService.IN_PERSON_EXPIRY_LOCK_KEY,
      AppointmentsService.IN_PERSON_EXPIRY_LOCK_TTL_SECONDS,
      'AppointmentsService.handleExpiredInPersonAppointmentsCron'
    );
    if (!acquired) {
      return;
    }
    await this.processExpiredInPersonAppointments();
  }

  private static readonly PAST_VIDEO_CLOSURE_LOCK_KEY = 'lock:cron:appointments:past-video-closure';
  private static readonly PAST_VIDEO_CLOSURE_LOCK_TTL_SECONDS = 240;
  private static readonly IN_PERSON_EXPIRY_LOCK_KEY = 'lock:cron:appointments:in-person-expiry';
  private static readonly IN_PERSON_EXPIRY_LOCK_TTL_SECONDS = 3300;
  /** Candidates read per page. The scan keeps paging until none are left (or time runs out). */
  private static readonly EXPIRY_BATCH_SIZE = 200;
  /** A scan stops after this long, safely inside the 240 s video lock, and the next tick resumes. */
  private static readonly EXPIRY_MAX_RUNTIME_MS = 200_000;
  /** In-clinic SCHEDULED visit nobody arrived for: expires this long after its slot ends. */
  private static readonly IN_PERSON_NO_SHOW_GRACE_MINUTES = 180;
  /** In-clinic CONFIRMED (checked-in, queued) visit never started: expires this long after its day ends. */
  private static readonly IN_PERSON_QUEUED_GRACE_MINUTES = 120;

  private async acquireCronLock(
    lockKey: string,
    ttlSeconds: number,
    source: string
  ): Promise<boolean> {
    const acquired = await this.cacheService.acquireLock(lockKey, ttlSeconds);
    if (!acquired) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Cron run skipped: its lock is held by another replica, or the cache is unavailable',
        source,
        { lockKey }
      );
    }
    return acquired;
  }

  /**
   * Pages through every row matching `baseWhere`, oldest first, with a (date, id) keyset cursor,
   * and hands each to `visit`. Rows the visitor skips or fails on cannot hold up the scan: the
   * cursor moves past them. Stops when the rows are exhausted or the runtime budget is spent.
   */
  private async forEachExpiryCandidate(
    baseWhere: Record<string, unknown>,
    visit: (candidate: ExpiryCandidate) => Promise<void>,
    source: string,
    options: { withPayment?: boolean } = {}
  ): Promise<{ scanned: number }> {
    const batchSize = AppointmentsService.EXPIRY_BATCH_SIZE;
    const deadline = Date.now() + AppointmentsService.EXPIRY_MAX_RUNTIME_MS;
    let cursor: { date: Date; id: string } | null = null;
    let scanned = 0;

    while (Date.now() < deadline) {
      const afterCursor: { date: Date; id: string } | null = cursor;
      const batch: ExpiryCandidate[] = await this.databaseService.executeHealthcareRead(
        async client => {
          const delegate = client['appointment'] as unknown as {
            findMany: (args: PrismaDelegateArgs) => Promise<ExpiryCandidate[]>;
          };
          return await delegate.findMany({
            where: {
              ...baseWhere,
              ...(afterCursor
                ? {
                    OR: [
                      { date: { gt: afterCursor.date } },
                      { date: afterCursor.date, id: { gt: afterCursor.id } },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              patientId: true,
              userId: true,
              doctorId: true,
              clinicId: true,
              date: true,
              time: true,
              duration: true,
              status: true,
              type: true,
              ...(options.withPayment
                ? {
                    subscriptionId: true,
                    isSubscriptionBased: true,
                    payment: { select: { status: true, invoice: { select: { status: true } } } },
                  }
                : {}),
            },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
            take: batchSize,
          } as PrismaDelegateArgs);
        }
      );

      let outOfTime = false;
      for (const candidate of batch) {
        if (Date.now() >= deadline) {
          outOfTime = true;
          break;
        }
        scanned++;
        await visit(candidate);
      }
      if (outOfTime) {
        break;
      }

      const last = batch[batch.length - 1];
      if (batch.length < batchSize || !last) {
        return { scanned };
      }
      cursor = { date: last.date, id: last.id };
    }

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      'Expiry scan stopped at its time budget; the remaining rows are picked up by the next run',
      source,
      { scanned }
    );
    return { scanned };
  }

  async processPastVideoCallClosures(settings?: {
    graceHours?: number;
    checkStatuses?: readonly AppointmentStatus[];
    clinicId?: string;
  }): Promise<{
    totalChecked: number;
    closed: number;
    failed: number;
    details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      closedAt: Date;
      reason: string;
    }>;
  }> {
    const source = 'AppointmentsService.processPastVideoCallClosures';
    const mergedSettings = {
      graceHours: 0,
      checkStatuses: [
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.SCHEDULED,
        AppointmentStatus.IN_PROGRESS,
      ] as readonly AppointmentStatus[],
      ...settings,
    };

    const now = new Date();
    const windowMinutes = getVideoActiveWindowMinutes();
    const windowMs = windowMinutes * 60_000;
    const graceMs = mergedSettings.graceHours * 60 * 60 * 1000;
    const windowLabel =
      windowMinutes % 60 === 0 ? `${windowMinutes / 60}-hour` : `${windowMinutes}-minute`;

    const details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      closedAt: Date;
      reason: string;
    }> = [];
    let failedCount = 0;

    const { scanned } = await this.forEachExpiryCandidate(
      {
        type: AppointmentType.VIDEO_CALL,
        status: { in: mergedSettings.checkStatuses as unknown as $Enums.AppointmentStatus[] },
        // The stored date is the IST midnight of the visit's day and the visit starts at or after
        // it, so a row can only be due once its date is a full window (and grace) in the past.
        // This keeps every not-yet-due row out of the scan without ever hiding a due one.
        date: { lte: new Date(now.getTime() - windowMs - graceMs) },
        ...(mergedSettings.clinicId ? { clinicId: mergedSettings.clinicId } : {}),
      },
      async appointment => {
        // The slot is IST wall-clock on the appointment's IST day; parseIstDateTime gives the
        // real instant whatever timezone the server runs in.
        const scheduledStart = parseIstDateTime(appointment.date, appointment.time);
        if (!scheduledStart) {
          // Skipped, not retried in this scan: the cursor moves past it.
          void this.loggingService.log(
            LogType.BUSINESS,
            LogLevel.WARN,
            'Past video call skipped: its scheduled time cannot be parsed',
            source,
            {
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              time: appointment.time,
            }
          );
          return;
        }

        if (now.getTime() < scheduledStart.getTime() + windowMs + graceMs) {
          return;
        }

        const formattedStart = formatDateTimeInIST(scheduledStart, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const reason =
          `Auto-closed: video appointment scheduled for ${formattedStart} IST ` +
          `has passed its ${windowLabel} window without being completed. ` +
          `The appointment is now closed.`;

        const closed = await this.expireDueAppointment(appointment, {
          reason,
          notes: 'Auto-closed by past-video-call closure cron.',
          source,
        });
        if (closed) {
          details.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            closedAt: new Date(),
            reason,
          });
        } else {
          failedCount++;
        }
      },
      source
    );

    if (details.length > 0 || failedCount > 0) {
      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Processed past video call closures',
        source,
        {
          totalChecked: scanned,
          closed: details.length,
          failed: failedCount,
        }
      );
    }

    return {
      totalChecked: scanned,
      closed: details.length,
      failed: failedCount,
      details,
    };
  }

  /**
   * Expires one due appointment as the system, through the status flow (so the state contract
   * and the core's status-conditional write decide): a visit a doctor completed a moment ago
   * stays COMPLETED. Returns true only for a visit that really closed; only then is it announced.
   */
  private async expireDueAppointment(
    appointment: ExpiryCandidate,
    params: { reason: string; notes: string; source: string }
  ): Promise<boolean> {
    try {
      const closeResult = (await this.updateStatus(
        appointment.id,
        {
          status: AppointmentStatus.EXPIRED,
          reason: params.reason,
          notes: params.notes,
        } as unknown as UpdateAppointmentStatusDto,
        'system',
        appointment.clinicId,
        'SYSTEM'
      )) as AppointmentResult;

      // The status change can be refused (for example it was completed a moment ago).
      if (!closeResult.success) {
        void this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.WARN,
          `Appointment was not expired: ${closeResult.message || closeResult.error || 'status change refused'}`,
          params.source,
          {
            appointmentId: appointment.id,
            clinicId: appointment.clinicId,
            status: appointment.status,
          }
        );
        return false;
      }

      await this.announceExpiry(appointment, params.reason);
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to auto-expire appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        params.source,
        {
          appointmentId: appointment.id,
          clinicId: appointment.clinicId,
          status: appointment.status,
        }
      );
      return false;
    }
  }

  private async announceExpiry(appointment: ExpiryCandidate, reason: string): Promise<void> {
    await this.emitAppointmentEnterpriseEvent('appointment.expired', {
      eventId: `appointment-expired-${appointment.id}-${Date.now()}`,
      clinicId: appointment.clinicId,
      priority: EventPriority.HIGH,
      userId: appointment.patientId,
      payload: {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        patientName: '',
        doctorName: '',
        date: appointment.date,
        time: appointment.time,
        appointmentType: String(appointment.type),
        reason,
        appointment,
      },
    });
  }

  /**
   * When an in-clinic visit that was never started is due to expire, or null when its schedule
   * cannot be parsed. A SCHEDULED visit (nobody arrived) is due after its slot plus the
   * check-in window; a CONFIRMED visit (checked in, in the doctor's queue) after its whole day,
   * so a patient who is still waiting is never expired.
   */
  private resolveInPersonExpiryDue(
    appointment: ExpiryCandidate,
    noShowGraceMs: number,
    queuedGraceMs: number
  ): Date | null {
    const scheduledStart = parseIstDateTime(appointment.date, appointment.time);
    if (!scheduledStart) {
      return null;
    }

    if (String(appointment.status).toUpperCase() === String(AppointmentStatus.CONFIRMED)) {
      const dayEnd = endOfIstDay(appointment.date);
      return dayEnd ? new Date(dayEnd.getTime() + queuedGraceMs) : null;
    }

    const slotMs = (appointment.duration || 30) * 60_000;
    return new Date(scheduledStart.getTime() + slotMs + noShowGraceMs);
  }

  async processExpiredInPersonAppointments(settings?: {
    noShowGraceMinutes?: number;
    queuedGraceMinutes?: number;
    clinicId?: string;
  }): Promise<{
    totalChecked: number;
    expired: number;
    failed: number;
    details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      expiredAt: Date;
      reason: string;
    }>;
  }> {
    const source = 'AppointmentsService.processExpiredInPersonAppointments';
    const now = new Date();
    const noShowGraceMs =
      (settings?.noShowGraceMinutes ?? AppointmentsService.IN_PERSON_NO_SHOW_GRACE_MINUTES) *
      60_000;
    const queuedGraceMs =
      (settings?.queuedGraceMinutes ?? AppointmentsService.IN_PERSON_QUEUED_GRACE_MINUTES) * 60_000;

    const details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      expiredAt: Date;
      reason: string;
    }> = [];
    let failedCount = 0;

    const { scanned } = await this.forEachExpiryCandidate(
      {
        type: { not: AppointmentType.VIDEO_CALL },
        // Never IN_PROGRESS and never a terminal status: only visits that were never started.
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        // The stored date is the IST midnight of the visit's day; nothing can be due before the
        // shortest grace has passed since that midnight.
        date: { lte: new Date(now.getTime() - noShowGraceMs) },
        ...(settings?.clinicId ? { clinicId: settings.clinicId } : {}),
      },
      async appointment => {
        const dueAt = this.resolveInPersonExpiryDue(appointment, noShowGraceMs, queuedGraceMs);
        if (!dueAt) {
          void this.loggingService.log(
            LogType.BUSINESS,
            LogLevel.WARN,
            'In-clinic appointment skipped: its scheduled time cannot be parsed',
            source,
            {
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              time: appointment.time,
            }
          );
          return;
        }
        if (now.getTime() < dueAt.getTime()) {
          return;
        }

        // One terminal path per row. A visit that was paid for (or is covered by a plan), and any
        // checked-in visit, ends here as EXPIRED. An unpaid visit nobody ever arrived for keeps its
        // old path, the 3 AM no-show cron, which cancels it and tells the patient.
        const neverConfirmedAndUnpaid =
          String(appointment.status).toUpperCase() === String(AppointmentStatus.SCHEDULED) &&
          !isAppointmentPaid(appointment);
        if (neverConfirmedAndUnpaid) {
          return;
        }

        const reason =
          'Auto-expired: the in-clinic appointment was not attended and its time has passed. ' +
          'The appointment is now closed; any payment is left as it is. Please book a new appointment.';
        const outcome = await this.expireInPersonAppointment(appointment, reason, source);
        if (outcome === 'expired') {
          details.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            expiredAt: new Date(),
            reason,
          });
        } else if (outcome === 'failed') {
          failedCount++;
        }
      },
      source,
      { withPayment: true }
    );

    if (details.length > 0 || failedCount > 0) {
      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Processed expired in-clinic appointments',
        source,
        { totalChecked: scanned, expired: details.length, failed: failedCount }
      );
    }

    return { totalChecked: scanned, expired: details.length, failed: failedCount, details };
  }

  /**
   * Expires one in-clinic appointment with a conditional, clinic-scoped write that only matches a
   * row that is still SCHEDULED or CONFIRMED. A visit that started, completed or was cancelled
   * since the scan read it is left exactly as it is ('moved-on'). It is the one terminal path of
   * these rows: payment, invoice and refund state are never touched here.
   */
  private async expireInPersonAppointment(
    appointment: ExpiryCandidate,
    reason: string,
    source: string
  ): Promise<'expired' | 'moved-on' | 'failed'> {
    const expiredAt = new Date();
    try {
      const claim = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              appointment: { updateMany: <T>(args: T) => Promise<{ count: number }> };
            }
          ).appointment.updateMany({
            where: {
              id: appointment.id,
              clinicId: appointment.clinicId,
              status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
            },
            data: {
              status: AppointmentStatus.EXPIRED,
              cancellationReason: reason,
              updatedAt: expiredAt,
            },
          });
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: appointment.clinicId,
          operation: 'EXPIRE_APPOINTMENT',
          resourceType: 'APPOINTMENT',
          resourceId: appointment.id,
          timestamp: expiredAt,
          details: { previousStatus: appointment.status, reason },
        }
      );

      if (claim.count === 0) {
        void this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'In-clinic appointment left untouched: it was started, closed or changed since it was read',
          source,
          { appointmentId: appointment.id, clinicId: appointment.clinicId }
        );
        return 'moved-on';
      }

      try {
        await this.appointmentQueueService.removePatientFromQueue(
          appointment.id,
          appointment.doctorId,
          appointment.clinicId,
          'clinic'
        );
      } catch (queueError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Queue cleanup after auto-expiry failed: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
          source,
          { appointmentId: appointment.id, doctorId: appointment.doctorId }
        );
      }

      try {
        await this.cacheService.invalidateAppointmentCache(
          appointment.id,
          appointment.patientId,
          appointment.doctorId,
          appointment.clinicId
        );
        this.invalidateBookingUserCache(appointment.userId);
      } catch (cacheError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Cache invalidation after auto-expiry failed: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
          source,
          { appointmentId: appointment.id }
        );
      }

      await this.announceExpiry(appointment, reason);
      return 'expired';
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to auto-expire in-clinic appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source,
        { appointmentId: appointment.id, clinicId: appointment.clinicId }
      );
      return 'failed';
    }
  }

  async processNoShowCancellations(settings?: {
    checkDaysBefore?: number;
    checkStatuses?: readonly string[];
    sendPatientNotifications?: boolean;
    clinicId?: string;
  }): Promise<{
    totalChecked: number;
    cancelled: number;
    failed: number;
    details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      appointmentDate: Date;
      reason: string;
    }>;
  }> {
    const mergedSettings = { ...this.DEFAULT_NO_SHOW_SETTINGS, ...settings };

    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      'Starting no-show cancellation check',
      'AppointmentsService',
      { settings: mergedSettings }
    );

    const today = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const todayIST = new Date(today.getTime() + istOffset);
    const cutoffDate = new Date(todayIST);
    cutoffDate.setDate(todayIST.getDate() - mergedSettings.checkDaysBefore);
    cutoffDate.setHours(0, 0, 0, 0);

    const cacheKey = `cron:appointments:no-show:${formatDateKeyInIST(cutoffDate)}`;
    const appointmentsToCheck = await this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.executeHealthcareRead(async client => {
          const prismaClient = client as unknown as Prisma.TransactionClient;
          return await prismaClient.appointment.findMany({
            where: {
              type: { not: AppointmentType.VIDEO_CALL },
              date: { lt: cutoffDate },
              status: { in: mergedSettings.checkStatuses as unknown as $Enums.AppointmentStatus[] },
              ...(mergedSettings.clinicId ? { clinicId: mergedSettings.clinicId } : {}),
            },
            select: {
              id: true,
              patientId: true,
              doctorId: true,
              date: true,
              time: true,
              status: true,
              clinicId: true,
              // Whether the visit was paid or is covered by a plan decides how it may end.
              subscriptionId: true,
              isSubscriptionBased: true,
              payment: { select: { status: true, invoice: { select: { status: true } } } },
            },
            orderBy: { date: 'asc' },
          });
        });
      },
      { ttl: 3600, compress: false }
    );

    const results: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      appointmentDate: Date;
      reason: string;
    }> = [];
    let cancelledCount = 0;
    let failedCount = 0;

    for (const appointment of appointmentsToCheck) {
      // A paid (or plan-covered) visit that never happened ends as EXPIRED, with its payment
      // left as it is, through the expiry cron: cancelling it here could release quota or start
      // a refund in billing. This cron only handles the unpaid, plan-less rows.
      if (isAppointmentPaid(appointment)) {
        continue;
      }

      try {
        const hasCheckIn = await this.hasPatientCheckedInForNoShow(
          appointment.patientId,
          appointment.date,
          appointment.clinicId
        );

        if (!hasCheckIn) {
          // Robustly cancel appointment using the existing verified service method
          await this.cancelAppointment(
            appointment.id,
            'No-show: Patient did not check in',
            'system',
            appointment.clinicId,
            'SYSTEM'
          );

          cancelledCount++;
          results.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            appointmentDate: appointment.date,
            reason: 'No-show: Patient did not check in',
          });

          if (mergedSettings.sendPatientNotifications) {
            await this.notifyPatientOfNoShowCancellation(appointment);
          }

          // Emit event for no-show cancellation reporting
          await this.emitAppointmentEnterpriseEvent('appointment.noshow', {
            eventId: `noshow-${appointment.id}-${Date.now()}`,
            clinicId: appointment.clinicId,
            priority: EventPriority.NORMAL,
            userId: appointment.patientId,
            payload: {
              appointmentId: appointment.id,
              doctorId: appointment.doctorId,
              date: appointment.date,
              reason: 'No-show',
              appointment,
            },
          });
        }
      } catch (error) {
        failedCount++;
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to process no-show for appointment ${appointment.id}: ${error instanceof Error ? error.message : String(error)}`,
          'AppointmentsService'
        );
      }
    }

    return {
      totalChecked: appointmentsToCheck.length,
      cancelled: cancelledCount,
      failed: failedCount,
      details: results,
    };
  }

  private async hasPatientCheckedInForNoShow(
    patientId: string,
    appointmentDate: Date,
    clinicId?: string
  ): Promise<boolean> {
    const startOfDay = startOfIstDay(appointmentDate) ?? appointmentDate;

    return (
      (await this.databaseService.executeHealthcareRead<number>(async client => {
        const prismaClient = client as unknown as Prisma.TransactionClient;

        return await prismaClient.checkIn.count({
          where: {
            patientId,
            checkedInAt: { gte: startOfDay },
            ...(clinicId ? { appointment: { clinicId } } : {}),
          },
        });
      })) > 0
    );
  }

  private async notifyPatientOfNoShowCancellation(appointment: {
    id: string;
    patientId: string;
    clinicId: string;
    date: Date;
  }): Promise<void> {
    try {
      await this.eventService.emitEnterprise('communication.patient.notification', {
        eventId: `noshow-notify-${appointment.id}-${Date.now()}`,
        eventType: 'communication.patient.notification',
        category: EventCategory.NOTIFICATION,
        priority: EventPriority.HIGH,
        timestamp: nowIso(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: appointment.patientId,
        clinicId: appointment.clinicId,
        payload: {
          type: 'SMS',
          priority: 'high',
          template: 'noshow_cancellation',
          data: {
            appointmentId: appointment.id,
            appointmentDate: appointment.date,
            reason: 'No-show: You did not check in for your appointment',
          },
        },
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to send no-show notification: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentsService'
      );
    }
  }

  getAppointmentServiceCatalog(): AppointmentServiceMetadataDto[] {
    return getAppointmentTreatmentCatalog() as AppointmentServiceMetadataDto[];
  }

  private getAppointmentServiceMetadata(
    treatmentType?: TreatmentType | string | null
  ): AppointmentServiceMetadataDto {
    return findTreatmentCatalogEntry(treatmentType) as AppointmentServiceMetadataDto;
  }

  private asMetadataRecord(metadata: unknown): Record<string, unknown> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  }

  private buildAppointmentScheduleLabel(date: Date | string, time: string): string {
    const formattedDate = formatDateInIST(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `${formattedDate} at ${time}`;
  }

  private resolveVideoSlotConfirmationExpiry(appointment: {
    date: Date;
    time: string;
    proposedSlots?: unknown;
  }): Date | null {
    const candidateSlots = Array.isArray(appointment.proposedSlots)
      ? (appointment.proposedSlots as Array<{ date?: string; time?: string }>)
      : [];

    const parsedSlotTimes = candidateSlots
      .map(slot => parseIstDateTime(slot?.date, slot?.time))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime());

    if (parsedSlotTimes.length > 0) {
      return parsedSlotTimes[0] ?? null;
    }

    return parseIstDateTime(appointment.date, appointment.time);
  }

  /**
   * Whether a video visit's join window has opened: its scheduled start minus the early-join
   * allowance has passed. Gates the CONFIRMED -> COMPLETED shortcut in completeAppointment so a
   * visit booked for later cannot be completed ahead of time. A row without a parseable schedule
   * fails closed.
   */
  private hasVideoJoinWindowOpened(appointment: {
    date?: Date | string | null;
    time?: string | null;
  }): boolean {
    if (!appointment.date || !appointment.time) {
      return false;
    }
    const date = appointment.date instanceof Date ? appointment.date : new Date(appointment.date);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    const scheduledStart = parseIstDateTime(date, appointment.time);
    if (!scheduledStart) {
      return false;
    }
    const opensAt = scheduledStart.getTime() - getVideoEarlyJoinMinutes() * 60_000;
    return Date.now() >= opensAt;
  }

  private resolveVideoAppointmentRescheduleDeadline(appointment: {
    date: Date;
    time: string;
  }): Date | null {
    const scheduledStart = parseIstDateTime(appointment.date, appointment.time);
    if (!scheduledStart) {
      return null;
    }

    return new Date(
      // Same boundary as expiry: the visit can be moved until its window closes, not after.
      scheduledStart.getTime() + getVideoActiveWindowMinutes() * 60_000
    );
  }

  private normalizeVideoSlotDate(slotDate: string): Date | null {
    return parseIstDateTime(slotDate, '12:00 am');
  }

  private async syncPaidAppointmentBillingAfterReschedule(
    appointment: AppointmentWithRelations,
    newDate: string,
    newTime: string,
    userId: string
  ): Promise<void> {
    const payments = await this.databaseService.findPaymentsSafe({
      appointmentId: appointment.id,
      clinicId: appointment.clinicId,
    });
    const completedPayment =
      payments
        .filter(payment => String(payment.status) === 'COMPLETED' && !!payment.invoiceId)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] || null;

    if (!completedPayment) {
      return;
    }

    const previousSchedule = this.buildAppointmentScheduleLabel(appointment.date, appointment.time);
    const rescheduledSchedule = this.buildAppointmentScheduleLabel(newDate, newTime);
    const serviceMetadata = this.getAppointmentServiceMetadata(appointment.treatmentType);
    const existingPaymentMetadata = this.asMetadataRecord(completedPayment.metadata);
    const invoice = completedPayment.invoiceId
      ? await this.databaseService.findInvoiceByIdSafe(completedPayment.invoiceId)
      : null;
    const existingInvoiceMetadata = this.asMetadataRecord(invoice?.metadata);
    const existingLineItems =
      invoice &&
      invoice.lineItems &&
      typeof invoice.lineItems === 'object' &&
      !Array.isArray(invoice.lineItems) &&
      'items' in (invoice.lineItems as Record<string, unknown>) &&
      Array.isArray((invoice.lineItems as Record<string, unknown>)['items'])
        ? ((invoice.lineItems as Record<string, unknown>)['items'] as Array<
            Record<string, unknown>
          >)
        : [];

    const updatedInvoiceItems =
      existingLineItems.length > 0
        ? existingLineItems.map((item, index) => ({
            ...item,
            ['description']:
              index === 0
                ? `${serviceMetadata.label} Appointment (${rescheduledSchedule})`
                : item['description'],
          }))
        : [
            {
              description: `${serviceMetadata.label} Appointment (${rescheduledSchedule})`,
              quantity: 1,
              unitPrice: completedPayment.amount,
              amount: completedPayment.amount,
            },
          ];

    await this.databaseService.updatePaymentSafe(completedPayment.id, {
      metadata: {
        ...existingPaymentMetadata,
        appointmentDate: newDate,
        appointmentTime: newTime,
        rescheduledAt: nowIso(),
        previousAppointmentDate: appointment.date.toISOString(),
        previousAppointmentTime: appointment.time,
        billingSyncUpdatedBy: userId,
      },
    });

    if (completedPayment.invoiceId) {
      await this.billingService.updateInvoice(completedPayment.invoiceId, {
        description: `Payment for ${serviceMetadata.label} appointment on ${rescheduledSchedule}`,
        lineItems: {
          items: updatedInvoiceItems,
        },
        metadata: {
          ...existingInvoiceMetadata,
          appointmentId: appointment.id,
          appointmentType: appointment.type,
          appointmentDate: newDate,
          appointmentTime: newTime,
          previousAppointmentDate: appointment.date.toISOString(),
          previousAppointmentTime: appointment.time,
          previousSchedule,
          rescheduledSchedule,
          rescheduledAt: nowIso(),
          billingSyncUpdatedBy: userId,
        },
      });
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Synchronized paid appointment billing after reschedule',
      'AppointmentsService',
      {
        appointmentId: appointment.id,
        paymentId: completedPayment.id,
        invoiceId: completedPayment.invoiceId,
        previousSchedule,
        rescheduledSchedule,
      }
    );
  }

  private mapCoverageAssignmentsToEntries(
    assignments: AssistantDoctorCoverageAssignmentRecord[]
  ): AssistantDoctorCoverageEntry[] {
    const grouped = new Map<string, AssistantDoctorCoverageEntry>();

    for (const assignment of assignments) {
      const existing = grouped.get(assignment.assistantDoctorId) || {
        assistantDoctorId: assignment.assistantDoctorId,
        primaryDoctorIds: [],
        isActive: assignment.isActive,
      };

      existing.isActive = existing.isActive || assignment.isActive;
      if (!existing.primaryDoctorIds.includes(assignment.primaryDoctorId)) {
        existing.primaryDoctorIds.push(assignment.primaryDoctorId);
      }

      grouped.set(assignment.assistantDoctorId, existing);
    }

    return Array.from(grouped.values()).sort((left, right) =>
      left.assistantDoctorId.localeCompare(right.assistantDoctorId)
    );
  }

  async syncClinicAssistantDoctorCoverage(
    clinicId: string,
    coverageEntries: AssistantDoctorCoverageEntry[]
  ): Promise<void> {
    const normalizedAssignments = coverageEntries
      .flatMap(entry =>
        entry.primaryDoctorIds.map(primaryDoctorId => ({
          assistantDoctorId: entry.assistantDoctorId,
          primaryDoctorId,
          isActive: entry.isActive,
        }))
      )
      .filter(
        assignment =>
          assignment.assistantDoctorId &&
          assignment.primaryDoctorId &&
          assignment.assistantDoctorId !== assignment.primaryDoctorId
      );

    // Validate doctor roles before saving
    const doctorIds = [
      ...normalizedAssignments.map(a => a.assistantDoctorId),
      ...normalizedAssignments.map(a => a.primaryDoctorId),
    ];

    const doctors = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.doctor.findMany({
        where: {
          id: { in: doctorIds },
          user: {
            role: {
              in: [Role.DOCTOR, Role.ASSISTANT_DOCTOR],
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      });
    });

    const doctorRoleMap = new Map<string, Role>();
    for (const doctor of doctors) {
      doctorRoleMap.set(doctor.id, doctor.user?.role as Role);
    }

    // Filter out invalid assignments (doctors with wrong roles or not found)
    const validatedAssignments = normalizedAssignments.filter(assignment => {
      const assistantRole = doctorRoleMap.get(assignment.assistantDoctorId);
      const primaryRole = doctorRoleMap.get(assignment.primaryDoctorId);

      if (!assistantRole || assistantRole !== Role.ASSISTANT_DOCTOR) {
        return false;
      }
      if (!primaryRole || primaryRole !== Role.DOCTOR) {
        return false;
      }

      return true;
    });

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as Prisma.TransactionClient & {
          assistantDoctorCoverageAssignment: {
            deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
            createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
          };
        };

        await typedClient.assistantDoctorCoverageAssignment.deleteMany({
          where: { clinicId },
        });

        if (validatedAssignments.length > 0) {
          await typedClient.assistantDoctorCoverageAssignment.createMany({
            data: validatedAssignments.map(assignment => ({
              clinicId,
              assistantDoctorId: assignment.assistantDoctorId,
              primaryDoctorId: assignment.primaryDoctorId,
              isActive: assignment.isActive,
            })),
            skipDuplicates: true,
          });
        }

        return { count: validatedAssignments.length };
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'CLINIC_SETTINGS',
        operation: 'UPDATE',
        resourceId: clinicId,
        userRole: 'system',
        details: {
          coverageAssignments: validatedAssignments.length,
        },
      }
    );
  }

  async getClinicAssistantDoctorCoverage(
    clinicId: string
  ): Promise<AssistantDoctorCoverageEntry[]> {
    // Single-source: Only read from relational AssistantDoctorCoverageAssignment model
    // Removed fallback to clinic.settings JSON for data consistency
    const relationalCoverage = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient & {
        assistantDoctorCoverageAssignment: {
          findMany: (
            args: PrismaDelegateArgs
          ) => Promise<AssistantDoctorCoverageAssignmentRecord[]>;
        };
      };

      return await typedClient.assistantDoctorCoverageAssignment.findMany({
        where: { clinicId },
        select: {
          assistantDoctorId: true,
          primaryDoctorId: true,
          isActive: true,
        },
        orderBy: [{ assistantDoctorId: 'asc' }, { primaryDoctorId: 'asc' }],
      });
    });

    if (relationalCoverage.length === 0) {
      // Return empty array if no relational coverage exists
      // Clinic admin should configure coverage via dedicated endpoints
      return [];
    }

    // Validate that doctors have correct roles
    const doctorIds = [
      ...relationalCoverage.map(r => r.assistantDoctorId),
      ...relationalCoverage.map(r => r.primaryDoctorId),
    ];

    const doctors = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.doctor.findMany({
        where: {
          id: { in: doctorIds },
          user: {
            role: {
              in: [Role.DOCTOR, Role.ASSISTANT_DOCTOR],
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      });
    });

    const doctorRoleMap = new Map<string, Role>();
    for (const doctor of doctors) {
      doctorRoleMap.set(doctor.id, doctor.user?.role as Role);
    }

    // Filter coverage to only include valid role assignments
    const validatedCoverage = relationalCoverage.filter(assignment => {
      const assistantRole = doctorRoleMap.get(assignment.assistantDoctorId);
      const primaryRole = doctorRoleMap.get(assignment.primaryDoctorId);

      // Assistant must have ASSISTANT_DOCTOR role
      if (!assistantRole || assistantRole !== Role.ASSISTANT_DOCTOR) {
        return false;
      }

      // Primary must have DOCTOR role
      if (!primaryRole || primaryRole !== Role.DOCTOR) {
        return false;
      }

      // Self-coverage should not exist (assistantDoctorId === primaryDoctorId)
      if (assignment.assistantDoctorId === assignment.primaryDoctorId) {
        return false;
      }

      return true;
    });

    return this.mapCoverageAssignmentsToEntries(validatedCoverage);
  }

  private isAssistantDoctorCoveredForPrimaryDoctor(
    coverageEntries: AssistantDoctorCoverageEntry[],
    assistantDoctorId: string,
    primaryDoctorId: string
  ): boolean {
    return coverageEntries.some(
      entry =>
        entry.isActive &&
        entry.assistantDoctorId === assistantDoctorId &&
        entry.primaryDoctorIds.includes(primaryDoctorId)
    );
  }

  async getAppointmentReassignmentCandidates(appointmentId: string, clinicId: string) {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          doctorId: true,
          treatmentType: true,
          clinicId: true,
          locationId: true,
          metadata: true,
        },
      });
    });

    if (!appointment || appointment.clinicId !== clinicId) {
      throw this.errors.recordNotFound(
        'appointment',
        'AppointmentsService.getAppointmentReassignmentCandidates'
      );
    }

    const currentMetadata = this.asMetadataRecord(appointment.metadata);
    const primaryDoctorId =
      typeof currentMetadata['primaryDoctorId'] === 'string' && currentMetadata['primaryDoctorId']
        ? currentMetadata['primaryDoctorId']
        : appointment.doctorId;
    const serviceMetadata = this.getAppointmentServiceMetadata(appointment.treatmentType);
    const assistantCoverage = await this.getClinicAssistantDoctorCoverage(clinicId);

    const doctors = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.doctor.findMany({
        where: {
          clinics: {
            some: {
              clinicId,
            },
          },
          user: {
            role: {
              in: [Role.DOCTOR, Role.ASSISTANT_DOCTOR],
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
          clinics: {
            where: { clinicId },
            select: {
              clinicId: true,
              locationId: true,
            },
          },
        },
        orderBy: {
          user: {
            name: 'asc',
          },
        },
      });
    });

    return doctors.map(doctor => {
      const doctorRole = doctor.user?.role as Role;
      const doctorName = doctor.user?.name || 'Unknown Doctor';
      const locationLink = Array.isArray(doctor.clinics) ? doctor.clinics[0] : null;
      let eligible = true;
      let reason: string | undefined;

      if (!locationLink) {
        eligible = false;
        reason = 'Doctor is not assigned to this clinic';
      } else if (
        appointment.locationId &&
        locationLink.locationId &&
        appointment.locationId !== locationLink.locationId
      ) {
        eligible = false;
        reason = 'Doctor is not assigned to the appointment location';
      } else if (doctorRole === Role.ASSISTANT_DOCTOR && !serviceMetadata.assistantDoctorEligible) {
        eligible = false;
        reason = `${serviceMetadata.label} cannot be delegated to an assistant doctor`;
      } else if (
        doctorRole === Role.ASSISTANT_DOCTOR &&
        !this.isAssistantDoctorCoveredForPrimaryDoctor(
          assistantCoverage,
          doctor.id,
          primaryDoctorId
        )
      ) {
        eligible = false;
        reason = 'Assistant coverage is not configured for this primary doctor';
      }

      return {
        id: doctor.id,
        name: doctorName,
        role: doctorRole,
        eligible,
        ...(reason ? { reason } : {}),
        isCurrent: doctor.id === appointment.doctorId,
        isPrimary: doctor.id === primaryDoctorId,
      };
    });
  }

  private async resolveEligibleInPersonSubscription(
    patientId: string,
    clinicId: string
  ): Promise<{ subscriptionId: string; patientUserId: string } | null> {
    const patient = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.patient.findFirst({
        where: {
          OR: [{ id: patientId }, { userId: patientId }],
        },
        select: { id: true, userId: true },
      });
    });

    if (!patient?.userId) {
      return null;
    }

    const subscriptions = await this.databaseService.findSubscriptionsSafe({
      userId: patient.userId,
      clinicId,
    });

    const eligibleSubscriptions = subscriptions
      .filter(
        subscription =>
          (String(subscription.status) === 'ACTIVE' ||
            String(subscription.status) === 'TRIALING') &&
          subscription.currentPeriodEnd > new Date()
      )
      .sort((left, right) => {
        const leftUnlimited = left.plan?.isUnlimitedAppointments ? 1 : 0;
        const rightUnlimited = right.plan?.isUnlimitedAppointments ? 1 : 0;
        if (leftUnlimited !== rightUnlimited) {
          return rightUnlimited - leftUnlimited;
        }

        return right.currentPeriodEnd.getTime() - left.currentPeriodEnd.getTime();
      });

    for (const subscription of eligibleSubscriptions) {
      const coverage = await this.billingService.canBookAppointment(subscription.id, 'IN_PERSON');
      if (coverage.allowed) {
        return {
          subscriptionId: subscription.id,
          patientUserId: patient.userId,
        };
      }
    }

    return null;
  }

  async resolveDoctorEntityId(doctorIdentifier: string, clinicId: string): Promise<string | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      const clinicScopedDoctor = await typedClient.doctor.findFirst({
        where: {
          clinics: {
            some: {
              clinicId,
            },
          },
          OR: [{ id: doctorIdentifier }, { userId: doctorIdentifier }],
        },
        select: { id: true },
      });

      if (clinicScopedDoctor?.id) {
        return clinicScopedDoctor.id;
      }

      // Fallback: some clinics persist appointment ownership by doctor entity ID
      // without a doctor-clinic link being populated yet. In that case we still
      // want the doctor workspace to resolve against the stored doctor record.
      const globalDoctor = await typedClient.doctor.findFirst({
        where: {
          OR: [{ id: doctorIdentifier }, { userId: doctorIdentifier }],
        },
        select: { id: true },
      });

      return globalDoctor?.id ?? null;
    });
  }

  // Note: Use DatabaseService safe methods instead of direct Prisma access
  // Example: await this.databaseService.findAppointmentByIdSafe(id)
  // Example: await this.databaseService.findUserByIdSafe(userId)

  // =============================================
  // ENHANCED APPOINTMENT OPERATIONS
  // =============================================

  /**
   * Create appointment using enhanced core service with auth integration
   */
  async createAppointment(
    createDto: CreateAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = Role.PATIENT,
    options?: {
      skipInPersonSubscriptionAutoLink?: boolean;
    }
  ): Promise<AppointmentResult> {
    // SECURITY: clinicId in body is allowed by DTO but ignored here in favor of context
    // We rely on the clinicId passed as argument (from ClinicGuard/Context)
    // to ensure isolation.
    // The previous check forbidding it in body contradicted the DTO validation.

    // RBAC: Check permission to create appointments
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'create',
    });

    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.createAppointment');
    }

    // SECURITY: a patient may book only for themselves or an active dependent. RbacGuard lets any
    // PATIENT through on appointments:create, and `patientId` comes from the request body, so
    // without this a patient who knows another patient's id could book into that chart.
    if (role.trim().toUpperCase() === Role.PATIENT && createDto.patientId) {
      const mayBook = await isAppointmentOwnedByPatientUser(
        this.databaseService,
        { patientId: createDto.patientId, familyMemberId: createDto.familyMemberId ?? null },
        userId
      );
      if (!mayBook) {
        throw this.errors.insufficientPermissions('AppointmentsService.createAppointment');
      }
    }

    // Context with forced clinicId from request context (not body)
    const context: AppointmentContext = {
      userId,
      role,
      clinicId, // Always from request context, never from body
      doctorId: createDto.doctorId,
      patientId: createDto.patientId,
    };

    const requiresSubscriptionCoverage =
      createDto.type === AppointmentType.IN_PERSON && !isVideoCallAppointmentType(createDto.type);
    const shouldAutoLinkInPersonSubscription = !options?.skipInPersonSubscriptionAutoLink;
    const shouldResolveInPersonCoverageBeforeCreate =
      requiresSubscriptionCoverage && shouldAutoLinkInPersonSubscription;

    const normalizedRole = role.trim().toUpperCase();
    const isAdministrativeRole = [
      Role.SUPER_ADMIN,
      Role.CLINIC_ADMIN,
      Role.RECEPTIONIST,
      Role.CLINIC_LOCATION_HEAD,
      Role.DOCTOR,
      Role.NURSE,
      Role.ASSISTANT_DOCTOR,
    ].includes(normalizedRole as Role);

    void Promise.allSettled([
      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Checking subscription for role: ${normalizedRole}, isAdministrative: ${isAdministrativeRole}`,
        'AppointmentsService',
        { role: normalizedRole, isAdministrativeRole }
      ),
    ]);

    let resolvedInPersonCoverage: { subscriptionId: string; patientUserId: string } | null = null;
    if (shouldResolveInPersonCoverageBeforeCreate && !isAdministrativeRole) {
      resolvedInPersonCoverage = await this.resolveEligibleInPersonSubscription(
        createDto.patientId,
        clinicId
      );

      if (!resolvedInPersonCoverage) {
        throw this.errors.businessRuleViolation(
          'An active plan is required before creating this in-person appointment',
          'AppointmentsService.createAppointment'
        );
      }
    }

    // Database layer will enforce clinic_id filtering on all queries
    const result = await this.coreAppointmentService.createAppointment(createDto, context);

    // Log security event for appointment creation
    if (result.success) {
      void Promise.allSettled([
        this.loggingService.log(
          LogType.SECURITY,
          LogLevel.INFO,
          'Appointment created successfully',
          'AppointmentsService',
          {
            appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
            doctorId: createDto.doctorId,
            patientId: createDto.patientId,
            userId,
            clinicId,
          }
        ),
      ]);

      // Invalidate related cache entries
      void this.cacheService.invalidateAppointmentCache(
        (result.data as Record<string, unknown>)?.['id'] as string,
        createDto.patientId,
        createDto.doctorId,
        clinicId
      );
      this.invalidateBookingUserCache(
        (result.data as Record<string, unknown>)?.['userId'] ?? userId
      );
      void Promise.all([
        this.cacheService.invalidateCacheByTag('appointments'),
        this.cacheService.invalidateCacheByTag('clinic_appointments'),
        this.cacheService.invalidateCacheByTag(`clinic:${clinicId}`),
        this.cacheService.invalidateCacheByTag(`user:${userId}`),
        this.cacheService.invalidateCacheByTag(`user:${createDto.patientId}`),
      ]);

      if (shouldResolveInPersonCoverageBeforeCreate && resolvedInPersonCoverage) {
        await this.billingService.bookAppointmentWithSubscription(
          resolvedInPersonCoverage.subscriptionId,
          (result.data as Record<string, unknown>)?.['id'] as string,
          {
            userId: resolvedInPersonCoverage.patientUserId,
            role: 'PATIENT',
            clinicId,
          }
        );
      }

      // Schedule the automatic reminder for this appointment.
      // The reminder plugin converts the appointment time into an actual delayed execution window.
      void this.appointmentReminderService
        .scheduleReminder(
          (result.data as Record<string, unknown>)?.['id'] as string,
          createDto.patientId,
          createDto.doctorId,
          clinicId,
          'appointment_reminder',
          0.25,
          ['email', 'whatsapp'],
          {
            patientName: 'Patient',
            doctorName: 'Doctor',
            appointmentDate: createDto.appointmentDate ?? formatDateKeyInIST(new Date()),
            appointmentTime:
              (createDto as CreateAppointmentDto & { time?: string }).time ?? '10:00',
            location: 'Clinic',
            clinicName: this.configService.getEnv('APP_NAME', 'Healthcare App'),
            appointmentType: createDto.type,
            notes: createDto.notes,
          },
          this.resolveAppointmentReminderScheduledFor(
            createDto.appointmentDate,
            (createDto as CreateAppointmentDto & { time?: string }).time,
            0.25
          )
        )
        .then(reminderResult => {
          if (!reminderResult.success) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.WARN,
              'Failed to schedule appointment reminder',
              'AppointmentsService.createAppointment',
              {
                appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
                error: reminderResult.error ?? 'Unknown reminder scheduling failure',
                reminderId: reminderResult.reminderId,
              }
            );
          }
        })
        .catch(reminderError => {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            'Failed to schedule appointment reminder',
            'AppointmentsService.createAppointment',
            {
              appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
              error: reminderError instanceof Error ? reminderError.message : String(reminderError),
              stack: reminderError instanceof Error ? reminderError.stack : undefined,
            }
          );
        });

      // Room creation for VIDEO_CALL appointments is handled dynamically during generateMeetingToken
      // No explicit pre-creation is needed.

      // Emit enterprise event for real-time WebSocket broadcasting
      void this.emitAppointmentEnterpriseEvent('appointment.created', {
        eventId: `appointment-created-${(result.data as Record<string, unknown>)?.['id'] as string}-${Date.now()}`,
        clinicId,
        userId: createDto.patientId,
        priority: EventPriority.HIGH,
        payload: {
          appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
          userId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId,
          status: (result.data as Record<string, unknown>)?.['status'] as string,
          appointmentType: createDto.type,
          createdBy: userId,
          appointment: result.data,
        },
      });
    }

    return result;
  }

  /**
   * Propose video appointment with exactly 3 time slots (patient flow).
   * Doctor will select one slot to confirm.
   */
  async proposeVideoAppointment(
    dto: ProposeVideoSlotsDto,
    userId: string,
    clinicId: string
  ): Promise<AppointmentResult> {
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'create',
    });
    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.proposeVideoAppointment');
    }

    const { patientId, doctorId } = await this.databaseService.executeHealthcareRead<{
      patientId: string | null;
      doctorId: string | null;
    }>(async client => {
      const prisma = client as unknown as {
        patient: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
        doctor: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
      };
      const patient = await prisma.patient.findFirst({
        where: {
          OR: [{ id: dto.patientId }, { userId: dto.patientId }],
        },
        select: { id: true },
      });
      const doctor = await prisma.doctor.findFirst({
        where: {
          OR: [{ id: dto.doctorId }, { userId: dto.doctorId }],
        },
        select: { id: true },
      });
      return {
        patientId: patient?.id ?? null,
        doctorId: doctor?.id ?? null,
      };
    });

    if (!patientId || !doctorId) {
      throw this.errors.validationError(
        'patientId',
        'Patient or doctor not found',
        'AppointmentsService.proposeVideoAppointment'
      );
    }

    // Deduplication: Reject creating a duplicate video appointment when the
    // patient has already proposed the same slot (or any active appointment
    // for the same doctor/time) within the last 10 minutes. This guards
    // against retries from the payment flow that would otherwise create
    // multiple rows for the same logical slot.
    const dedupWindowStart = new Date(Date.now() - 10 * 60 * 1000);
    const firstSlotForDedup = dto.proposedSlots[0];
    if (firstSlotForDedup) {
      const normalizedDedupDate = this.normalizeVideoSlotDate(firstSlotForDedup.date);
      if (normalizedDedupDate) {
        const existingRecent = (await this.databaseService.executeRead(async prisma => {
          const tx = prisma as unknown as Prisma.TransactionClient;
          return tx.appointment.findFirst({
            where: {
              patientId,
              doctorId,
              type: AppointmentType.VIDEO_CALL,
              date: normalizedDedupDate,
              time: firstSlotForDedup.time,
              createdAt: { gte: dedupWindowStart },
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            },
            orderBy: { createdAt: 'desc' },
          });
        })) as { id: string } | null;

        if (existingRecent) {
          await this.loggingService.log(
            LogType.BUSINESS,
            LogLevel.WARN,
            `Duplicate video appointment proposal detected; returning existing appointment ${existingRecent.id}`,
            'AppointmentsService.proposeVideoAppointment',
            { patientId, doctorId, existingId: existingRecent.id }
          );
          return {
            success: true,
            data: { id: existingRecent.id } as unknown as Record<string, unknown>,
            message: 'An active video appointment already exists for this slot.',
          };
        }
      }
    }

    const firstSlot = dto.proposedSlots[0];
    if (!firstSlot) {
      throw this.errors.validationError(
        'proposedSlots',
        'At least one slot is required',
        'AppointmentsService.proposeVideoAppointment'
      );
    }
    // const minAdvanceMs = 48 * 60 * 60 * 1000;
    // const now = Date.now();
    const uniqueDates = new Set<string>();

    if (dto.proposedSlots.length !== 3) {
      throw this.errors.validationError(
        'proposedSlots',
        'Exactly 3 time slots must be proposed',
        'AppointmentsService.proposeVideoAppointment'
      );
    }

    // Pre-fetch availability for all dates to optimize performance
    const availabilityMap = new Map<string, string[]>();
    for (const slot of dto.proposedSlots) {
      uniqueDates.add(slot.date);
    }

    for (const date of uniqueDates) {
      const availability = (await this.coreAppointmentService.getDoctorAvailability(
        doctorId,
        date,
        {
          clinicId,
          userId,
          role: 'USER',
          ...(dto.locationId ? { locationId: dto.locationId } : {}),
          appointmentType: AppointmentType.VIDEO_CALL,
        }
      )) as { availableSlots: string[] };
      availabilityMap.set(date, availability.availableSlots || []);
    }

    for (const slot of dto.proposedSlots) {
      const slotDateTime = parseIstDateTime(slot.date, slot.time);
      if (!slotDateTime) {
        throw this.errors.validationError(
          'proposedSlots',
          `Invalid date/time format: ${slot.date} ${slot.time}`,
          'AppointmentsService.proposeVideoAppointment'
        );
      }

      // Production policy: Enforce 2-day advance rule
      // if (slotDateTime.getTime() - now < minAdvanceMs) {
      //   throw this.errors.validationError(
      //     'proposedSlots',
      //     `Slot ${slot.date} ${slot.time} is too soon. Video appointments must be booked at least 2 days in advance.`,
      //     'AppointmentsService.proposeVideoAppointment'
      //   );
      // }

      // Testing mode: skip the 2-day advance rule and keep only slot availability validation.
      // 1. Check for conflicts / availability
      const availableSlots = availabilityMap.get(slot.date);
      if (!availableSlots || !availableSlots.includes(slot.time)) {
        throw this.errors.appointmentSlotUnavailable(
          `${slot.date} ${slot.time}`,
          'AppointmentsService.proposeVideoAppointment'
        );
      }
    }

    const { date: slotDate, time: slotTime } = firstSlot;
    const normalizedSlotDate = this.normalizeVideoSlotDate(slotDate);
    if (!normalizedSlotDate) {
      throw this.errors.validationError(
        'proposedSlots',
        `Invalid date format: ${slotDate}`,
        'AppointmentsService.proposeVideoAppointment'
      );
    }

    const appointmentData = {
      patientId,
      doctorId,
      clinicId,
      ...(dto.locationId ? { locationId: dto.locationId } : {}),
      type: AppointmentType.VIDEO_CALL,
      treatmentType: dto.treatmentType || TreatmentType.GENERAL_CONSULTATION,
      date: normalizedSlotDate,
      time: slotTime,
      duration: dto.duration,
      // New flow: patient selection creates a scheduled appointment.
      // Doctor confirmation moves it to CONFIRMED.
      status: AppointmentStatus.SCHEDULED,
      priority: AppointmentPriority.NORMAL,
      userId,
      notes: dto.notes,
      proposedSlots: dto.proposedSlots,
    };

    const appointment = await this.databaseService.createAppointmentSafe(
      appointmentData as Parameters<typeof this.databaseService.createAppointmentSafe>[0]
    );

    await this.eventService.emit('appointment.created', {
      appointmentId: appointment.id,
      clinicId,
      doctorId,
      patientId,
      status: AppointmentStatus.SCHEDULED,
      appointment,
      context: { userId },
    });

    return {
      success: true,
      data: appointment as unknown as Record<string, unknown>,
      message:
        'Video appointment scheduled with proposed slots. Doctor confirmation is required to finalize the slot.',
    };
  }

  /**
   * Confirm one slot from patient's proposed slots (doctor flow).
   */
  async confirmVideoSlot(
    appointmentId: string,
    dto: ConfirmVideoSlotDto,
    userId: string,
    clinicId: string
  ): Promise<AppointmentResult> {
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'update',
    });
    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.confirmVideoSlot');
    }

    // Validate appointment and check clinic isolation
    const appointment = (await this.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations;
    if (String(appointment.type) !== 'VIDEO_CALL') {
      throw this.errors.validationError(
        'type',
        'Only video appointments support slot confirmation',
        'AppointmentsService.confirmVideoSlot'
      );
    }
    const confirmedSlotIndex = (
      appointment as AppointmentWithRelations & { confirmedSlotIndex?: number | null }
    ).confirmedSlotIndex;
    const canConfirmSlot = isVideoSlotAwaitingConfirmation({
      type: appointment.type,
      status: appointment.status,
      proposedSlots: (appointment as AppointmentWithRelations & { proposedSlots?: unknown })
        .proposedSlots,
      confirmedSlotIndex,
    });
    if (!canConfirmSlot) {
      const appointmentStatus = String(appointment.status || '').toUpperCase();
      const alreadyConfirmed =
        appointmentStatus === String(AppointmentStatus.CONFIRMED) &&
        confirmedSlotIndex !== null &&
        confirmedSlotIndex !== undefined;

      if (alreadyConfirmed) {
        return {
          success: true,
          data: appointment as unknown as Record<string, unknown>,
          message: 'Video slot was already confirmed.',
        };
      }

      throw this.errors.validationError(
        'status',
        'Appointment is not awaiting doctor slot confirmation',
        'AppointmentsService.confirmVideoSlot'
      );
    }

    const proposedSlots = ((appointment as AppointmentWithRelations & { proposedSlots?: unknown })
      .proposedSlots ?? []) as Array<{ date: string; time: string }>;
    if (dto.confirmedSlotIndex < 0 || dto.confirmedSlotIndex >= proposedSlots.length) {
      throw this.errors.validationError(
        'confirmedSlotIndex',
        'Invalid slot index',
        'AppointmentsService.confirmVideoSlot'
      );
    }

    // Payment required before doctor can confirm: VIDEO_CALL is per-appointment, patient must pay first
    const payments = await this.databaseService.executeRead(async prisma => {
      const tx = prisma as unknown as Prisma.TransactionClient;
      return tx.payment.findMany({
        where: {
          appointmentId,
          status: 'COMPLETED',
        },
      });
    });
    if (!payments || payments.length === 0) {
      throw this.errors.validationError(
        'payment',
        'Patient must complete payment before the doctor can confirm the slot. Please remind the patient to pay.',
        'AppointmentsService.confirmVideoSlot'
      );
    }

    const slot = proposedSlots[dto.confirmedSlotIndex];
    if (!slot) {
      throw this.errors.validationError(
        'confirmedSlotIndex',
        'Invalid slot index',
        'AppointmentsService.confirmVideoSlot'
      );
    }
    const { date: slotDate, time: slotTime } = slot;
    const normalizedSlotDate = this.normalizeVideoSlotDate(slotDate);
    if (!normalizedSlotDate) {
      throw this.errors.validationError(
        'confirmedSlotIndex',
        `Invalid date format: ${slotDate}`,
        'AppointmentsService.confirmVideoSlot'
      );
    }

    const isAvailable = await this.databaseService.executeRead(async prisma => {
      // Use raw query or logic to check overlap
      // Assuming slots are 30 mins (or check duration)
      // Ideally reuse ConflictResolutionService or just check for existing appointments
      // Simple check:
      const tx = prisma as unknown as Prisma.TransactionClient;
      const conflicts = await tx.appointment.findMany({
        where: {
          doctorId: appointment.doctorId,
          date: normalizedSlotDate,
          time: slotTime,
          status: {
            in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
          },
          id: {
            not: appointmentId,
          },
        },
      });
      return conflicts.length === 0;
    });

    if (!isAvailable) {
      throw this.errors.appointmentSlotUnavailable(
        `${slotDate} ${slotTime}`,
        'AppointmentsService.confirmVideoSlot'
      );
    }

    const updated = await this.databaseService.updateAppointmentSafe(appointmentId, {
      date: normalizedSlotDate,
      time: slotTime,
      status: AppointmentStatus.CONFIRMED,
      confirmedSlotIndex: dto.confirmedSlotIndex,
    });

    // Room creation is handled dynamically during generateMeetingToken
    // No explicit pre-creation is needed.

    const appointmentWithRelations = appointment as AppointmentWithRelations & {
      patient?: { userId?: string };
      doctor?: { userId?: string };
    };

    await this.emitAppointmentEnterpriseEvent('appointment.updated', {
      eventId: `appointment-confirmed-slot-${appointmentId}-${Date.now()}`,
      clinicId,
      priority: EventPriority.NORMAL,
      ...(appointmentWithRelations.patient?.userId
        ? { userId: appointmentWithRelations.patient.userId }
        : {}),
      metadata: {
        appointmentId,
        clinicId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        confirmedSlotIndex: dto.confirmedSlotIndex,
        status: AppointmentStatus.CONFIRMED,
        source: 'AppointmentsService',
      },
      payload: {
        appointmentId,
        clinicId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        confirmedSlotIndex: dto.confirmedSlotIndex,
        status: AppointmentStatus.CONFIRMED,
        appointment: updated,
        context: { userId },
      },
    });

    await this.eventService.emit('appointment.confirmed', {
      appointmentId,
      clinicId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      confirmedSlotIndex: dto.confirmedSlotIndex,
      status: AppointmentStatus.CONFIRMED,
      appointment: updated,
      context: { userId },
    });

    await this.cacheService.invalidateAppointmentCache(
      appointmentId,
      appointment.patientId,
      appointment.doctorId,
      clinicId
    );
    this.invalidateBookingUserCache(appointment.userId);
    await this.eventService.emit('doctor.availability.changed', {
      clinicId,
      appointmentId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      source: 'AppointmentsService.confirmVideoSlot',
      timestamp: nowIso(),
    });

    return {
      success: true,
      data: updated as unknown as Record<string, unknown>,
      message: 'Video slot confirmed. Appointment is now confirmed and patient will be notified.',
    };
  }

  /**
   * Confirm the final video slot using either a proposed slot index or a custom doctor-picked slot.
   */
  async confirmFinalVideoSlot(
    appointmentId: string,
    dto: ConfirmVideoFinalSlotDto,
    userId: string,
    clinicId: string
  ): Promise<AppointmentResult> {
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'update',
    });
    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.confirmFinalVideoSlot');
    }

    const appointment = (await this.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations;
    if (String(appointment.type) !== 'VIDEO_CALL') {
      throw this.errors.validationError(
        'type',
        'Only video appointments support slot confirmation',
        'AppointmentsService.confirmFinalVideoSlot'
      );
    }

    const confirmedSlotIndex = (
      appointment as AppointmentWithRelations & { confirmedSlotIndex?: number | null }
    ).confirmedSlotIndex;
    const canConfirmSlot = isVideoSlotAwaitingConfirmation({
      type: appointment.type,
      status: appointment.status,
      proposedSlots: (appointment as AppointmentWithRelations & { proposedSlots?: unknown })
        .proposedSlots,
      confirmedSlotIndex,
    });
    if (!canConfirmSlot) {
      const appointmentStatus = String(appointment.status || '').toUpperCase();
      const alreadyConfirmed =
        appointmentStatus === String(AppointmentStatus.CONFIRMED) &&
        confirmedSlotIndex !== null &&
        confirmedSlotIndex !== undefined;

      if (alreadyConfirmed) {
        return {
          success: true,
          data: appointment as unknown as Record<string, unknown>,
          message: 'Final video slot was already confirmed.',
        };
      }

      throw this.errors.validationError(
        'status',
        'Appointment is not awaiting doctor slot confirmation',
        'AppointmentsService.confirmFinalVideoSlot'
      );
    }

    const hasConfirmedIndex =
      dto.confirmedSlotIndex !== null &&
      dto.confirmedSlotIndex !== undefined &&
      !Number.isNaN(Number(dto.confirmedSlotIndex));
    const hasCustomSlot = Boolean(dto.date && dto.time);

    if (!hasConfirmedIndex && !hasCustomSlot) {
      throw this.errors.validationError(
        'slot',
        'Provide either a confirmedSlotIndex or a custom date and time',
        'AppointmentsService.confirmFinalVideoSlot'
      );
    }

    // Payment required before final confirmation for video calls.
    const payments = await this.databaseService.executeRead(async prisma => {
      const tx = prisma as unknown as Prisma.TransactionClient;
      return tx.payment.findMany({
        where: {
          appointmentId,
          status: 'COMPLETED',
        },
      });
    });
    if (!payments || payments.length === 0) {
      throw this.errors.validationError(
        'payment',
        'Patient must complete payment before the doctor can confirm the slot. Please remind the patient to pay.',
        'AppointmentsService.confirmFinalVideoSlot'
      );
    }

    let finalDate!: string;
    let finalTime!: string;
    let confirmedSlotValue: number | null = null;

    if (hasConfirmedIndex) {
      const proposedSlots = ((appointment as AppointmentWithRelations & { proposedSlots?: unknown })
        .proposedSlots ?? []) as Array<{ date: string; time: string }>;
      if (dto.confirmedSlotIndex! < 0 || dto.confirmedSlotIndex! >= proposedSlots.length) {
        throw this.errors.validationError(
          'confirmedSlotIndex',
          'Invalid slot index',
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }
      const slot = proposedSlots[dto.confirmedSlotIndex!];
      if (!slot) {
        throw this.errors.validationError(
          'confirmedSlotIndex',
          'Invalid slot index',
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }
      finalDate = slot.date;
      finalTime = slot.time;
      confirmedSlotValue = dto.confirmedSlotIndex!;
      const normalizedFinalSlotDate = this.normalizeVideoSlotDate(finalDate);
      if (!normalizedFinalSlotDate) {
        throw this.errors.validationError(
          'confirmedSlotIndex',
          `Invalid date format: ${finalDate}`,
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }

      const isAvailable = await this.databaseService.executeRead(async prisma => {
        const tx = prisma as unknown as Prisma.TransactionClient;
        const conflicts = await tx.appointment.findMany({
          where: {
            doctorId: appointment.doctorId,
            date: normalizedFinalSlotDate,
            time: finalTime,
            status: {
              in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
            },
            id: {
              not: appointmentId,
            },
          },
        });
        return conflicts.length === 0;
      });

      if (!isAvailable) {
        throw this.errors.appointmentSlotUnavailable(
          `${finalDate} ${finalTime}`,
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }
    } else if (hasCustomSlot) {
      if (!dto.date || !dto.time) {
        throw this.errors.validationError(
          'slot',
          'Provide either a confirmedSlotIndex or a custom date and time',
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }
      finalDate = dto.date;
      finalTime = dto.time;
      const normalizedFinalSlotDate = this.normalizeVideoSlotDate(finalDate);
      if (!normalizedFinalSlotDate) {
        throw this.errors.validationError(
          'slot',
          `Invalid date format: ${finalDate}`,
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }
      const isAvailable = await this.databaseService.executeRead(async prisma => {
        const tx = prisma as unknown as Prisma.TransactionClient;
        const conflicts = await tx.appointment.findMany({
          where: {
            doctorId: appointment.doctorId,
            date: normalizedFinalSlotDate,
            time: finalTime,
            status: {
              in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
            },
            id: {
              not: appointmentId,
            },
          },
        });
        return conflicts.length === 0;
      });

      if (!isAvailable) {
        throw this.errors.appointmentSlotUnavailable(
          `${finalDate} ${finalTime}`,
          'AppointmentsService.confirmFinalVideoSlot'
        );
      }
    }

    const existingMetadata = (appointment.metadata as Record<string, unknown>) || {};
    const normalizedFinalSlotDate = this.normalizeVideoSlotDate(finalDate);
    if (!normalizedFinalSlotDate) {
      throw this.errors.validationError(
        'slot',
        `Invalid date format: ${finalDate}`,
        'AppointmentsService.confirmFinalVideoSlot'
      );
    }
    const updatePayload: Record<string, unknown> = {
      date: normalizedFinalSlotDate,
      time: finalTime,
      status: AppointmentStatus.CONFIRMED,
      metadata: {
        ...existingMetadata,
        finalSlotConfirmedBy: userId,
        finalSlotConfirmedAt: nowIso(),
        finalSlotSource: hasConfirmedIndex ? 'PROPOSED_SLOT' : 'CUSTOM_SLOT',
        finalSlotReason: dto.reason || null,
      },
    };
    if (hasConfirmedIndex && confirmedSlotValue !== null) {
      updatePayload['confirmedSlotIndex'] = confirmedSlotValue;
    }
    const updated = await this.databaseService.updateAppointmentSafe(
      appointmentId,
      updatePayload as never
    );

    await this.eventService.emit('appointment.slot.confirmed', {
      appointmentId,
      clinicId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      confirmedSlotIndex: confirmedSlotValue,
      finalSlot: { date: finalDate, time: finalTime },
      appointment: updated,
      source: hasConfirmedIndex ? 'proposed' : 'custom',
      context: { userId },
    });

    await this.eventService.emit('appointment.confirmed', {
      appointmentId,
      clinicId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      confirmedSlotIndex: confirmedSlotValue,
      finalSlot: { date: finalDate, time: finalTime },
      status: AppointmentStatus.CONFIRMED,
      appointment: updated,
      context: { userId },
    });

    await this.cacheService.invalidateAppointmentCache(
      appointmentId,
      appointment.patientId,
      appointment.doctorId,
      clinicId
    );
    this.invalidateBookingUserCache(appointment.userId);
    await this.eventService.emit('doctor.availability.changed', {
      clinicId,
      appointmentId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      source: 'AppointmentsService.confirmFinalVideoSlot',
      timestamp: nowIso(),
    });

    return {
      success: true,
      data: updated as unknown as Record<string, unknown>,
      message: hasConfirmedIndex
        ? 'Video slot confirmed. Appointment is now confirmed and patient will be notified.'
        : 'Custom final video slot confirmed. Appointment is now confirmed and patient will be notified.',
    };
  }

  /** Staff roles that may reschedule any appointment of their clinic (patients need ownership). */
  private static readonly RESCHEDULE_STAFF_ROLES: ReadonlySet<string> = new Set<string>([
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
  ]);

  /**
   * The appointment columns a reschedule decides on, read fresh (never from the detail cache) and
   * scoped to the caller's clinic. Whether it may move, how often it already moved and whether the
   * patient has arrived are decided on this row, inside the locks.
   */
  private async loadAppointmentForReschedule(
    appointmentId: string,
    clinicId: string
  ): Promise<RescheduleAppointmentRow> {
    const row = await this.databaseService.executeHealthcareRead(async client => {
      const delegate = client['appointment'] as unknown as {
        findFirst: (args: PrismaDelegateArgs) => Promise<RescheduleAppointmentRow | null>;
      };
      return await delegate.findFirst({
        where: { id: appointmentId, clinicId },
        select: {
          id: true,
          clinicId: true,
          patientId: true,
          doctorId: true,
          userId: true,
          locationId: true,
          type: true,
          status: true,
          date: true,
          time: true,
          checkedInAt: true,
          metadata: true,
        },
      } as PrismaDelegateArgs);
    });

    if (!row) {
      throw this.errors.appointmentNotFound(
        appointmentId,
        'AppointmentsService.rescheduleAppointment'
      );
    }
    return row;
  }

  /**
   * The patient dashboard summary (PatientsService.getDashboardSummary) is cached under the tag
   * `user:<User.id>` of the booking user, while CacheService.invalidateAppointmentCache only knows
   * the Patient.id. Every appointment write busts that user tag here so the dashboard never shows a
   * visit that was just booked, cancelled, moved, checked in or completed as stale. Fire-and-forget:
   * a cache miss is cheap, a failed invalidation must never fail the write.
   */
  private invalidateBookingUserCache(bookingUserId: unknown): void {
    if (typeof bookingUserId !== 'string' || !bookingUserId.trim()) return;
    void this.cacheService.invalidateCacheByTag(`user:${bookingUserId}`).catch(error => {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Booking-user cache invalidation failed: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentsService.invalidateBookingUserCache',
        { bookingUserId }
      );
    });
  }

  /**
   * Today's live queue state (token, position, estimated wait) folded onto the list rows. Only
   * in-person visits checked in today have an entry; everything else is left untouched. Read once
   * per (uncached) list load, and never allowed to fail the list.
   */
  private async attachLiveQueueState(
    result: AppointmentResult,
    clinicId: string
  ): Promise<AppointmentResult> {
    const data = result.data as { appointments?: unknown } | undefined;
    const rows = Array.isArray(data?.appointments) ? (data.appointments as unknown[]) : null;
    if (!rows || rows.length === 0) return result;

    try {
      const queue = await this.appointmentQueueService.getClinicQueue(
        clinicId,
        formatDateKeyInIST(new Date()),
        'clinic'
      );
      if (queue.length === 0) return result;

      const byAppointment = new Map<
        string,
        {
          tokenNumber: number | null;
          queuePosition: number | null;
          estimatedWaitTime: number | null;
        }
      >();
      for (const entry of queue) {
        if (!entry.appointmentId) continue;
        byAppointment.set(entry.appointmentId, {
          tokenNumber: typeof entry.tokenNumber === 'number' ? entry.tokenNumber : null,
          queuePosition: typeof entry.position === 'number' ? entry.position : null,
          estimatedWaitTime:
            typeof entry.estimatedWaitTime === 'number' ? entry.estimatedWaitTime : null,
        });
      }
      if (byAppointment.size === 0) return result;

      const appointments = rows.map(row => {
        const record = row as Record<string, unknown>;
        const live = typeof record['id'] === 'string' ? byAppointment.get(record['id']) : undefined;
        return live ? { ...record, ...live } : row;
      });
      return { ...result, data: { ...(result.data as Record<string, unknown>), appointments } };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Live queue state unavailable for appointment list: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentsService.attachLiveQueueState',
        { clinicId }
      );
      return result;
    }
  }

  /**
   * The reschedule policy, applied to the fresh row. Returns how many times the appointment has
   * already been moved.
   */
  private assertRescheduleAllowed(row: RescheduleAppointmentRow): number {
    const context = 'AppointmentsService.rescheduleAppointment';
    const status = String(row.status).toUpperCase();

    // Video visits move only while CONFIRMED; in-person visits move in any state except the
    // ones that are over or under way (see core/reschedule-policy.ts). A checked-in in-person
    // visit may move: claimReschedule resets it and the queue entry is dropped afterwards.
    const isInPersonVisit = !isVideoAppointmentType(row.type);
    if (!isRescheduleStatusAllowed(row.type, status)) {
      throw this.errors.validationError('status', rescheduleStatusRefusal(row.type), context);
    }

    // Video appointment: enforce 5-hour reschedule window
    if (!isInPersonVisit) {
      const rescheduleDeadline = this.resolveVideoAppointmentRescheduleDeadline({
        date: row.date,
        time: row.time,
      });

      if (!rescheduleDeadline) {
        throw this.errors.validationError(
          'date',
          'Unable to determine the appointment reschedule deadline.',
          context
        );
      }

      if (Date.now() >= rescheduleDeadline.getTime()) {
        throw this.errors.validationError(
          'date',
          'Rescheduling is only allowed until the 5-hour appointment window expires.',
          context
        );
      }
    }

    // Policy: Limit number of reschedules (e.g. max 2 times)
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const rescheduleCount = Number(metadata['rescheduleCount'] || 0);
    if (rescheduleCount >= AppointmentsService.MAX_RESCHEDULES) {
      throw this.errors.validationError(
        'metadata',
        `Maximum reschedule limit (${AppointmentsService.MAX_RESCHEDULES}) reached for this appointment.`,
        context
      );
    }

    return rescheduleCount;
  }

  /**
   * Moves the appointment with a conditional, clinic-scoped write: it only matches while the row
   * is still in a reschedulable status. A consultation start, completion or cancellation (or
   * another reschedule) that committed after the fresh read is therefore never overwritten; the
   * caller gets a 409 instead. The slot is written exactly as validated, in the same statement.
   */
  private async claimReschedule(params: {
    row: RescheduleAppointmentRow;
    newDate: string;
    newTime: string;
    rescheduleCount: number;
    userId: string;
    role: string;
    clinicId: string;
  }): Promise<void> {
    const { row, newDate, newTime, rescheduleCount, userId, role, clinicId } = params;
    const isVideo = String(row.type) === 'VIDEO_CALL';
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const movedAt = new Date();

    // Clear video-specific metadata so stale proposal data does not survive a reschedule:
    // proposedSlots and confirmedSlotIndex return to their defaults so a fresh cycle begins after
    // the new date/time is set. For VIDEO_CALL appointments the old paymentExpiresAt must also be
    // cleared: the scheduler treats it as the authoritative expiry moment, and leaving it set
    // would auto-expire the row by the OLD deadline even though the patient has a new future date.
    //
    // A video visit is only rescheduled while CONFIRMED (paid), and moving it does not undo the
    // payment, so it stays CONFIRMED on the new slot with its window re-stamped from the new
    // slot. An in-clinic visit keeps a booking-level status, and anything that implied arrival
    // (confirmed, checked in, waiting) goes back to SCHEDULED, with its arrival time cleared.
    const newVideoStart = isVideo ? parseIstDateTime(new Date(newDate), newTime) : null;
    const data: Record<string, unknown> = {
      date: new Date(newDate),
      time: newTime,
      status: statusAfterReschedule(row.type, row.status),
      ...(isVideo ? { paymentExpiresAt: null } : {}),
      ...(isVideo && newVideoStart
        ? {
            confirmationExpiresAt: new Date(
              newVideoStart.getTime() + getVideoActiveWindowMinutes() * 60_000
            ),
          }
        : {}),
      proposedSlots: [],
      confirmedSlotIndex: null,
      // A moved visit never keeps an arrival for the old slot.
      checkedInAt: null,
      metadata: {
        ...metadata,
        rescheduleCount: rescheduleCount + 1,
        lastRescheduledAt: movedAt,
      },
      updatedAt: movedAt,
    };

    const claim = await this.databaseService.executeHealthcareWrite(
      async client => {
        return await (
          client as unknown as {
            appointment: { updateMany: <T>(args: T) => Promise<{ count: number }> };
          }
        ).appointment.updateMany({
          where: {
            id: row.id,
            clinicId,
            ...reschedulePinnedWhere(row),
          },
          data,
        });
      },
      {
        userId,
        userRole: role,
        clinicId,
        operation: 'UPDATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: row.id,
        timestamp: movedAt,
        details: { action: 'RESCHEDULE', previousStatus: row.status, newDate, newTime },
      }
    );

    if (claim.count === 0) {
      throw this.errors.appointmentConflict(row.id, 'AppointmentsService.rescheduleAppointment');
    }
  }

  /** The rescheduled appointment with the relations the event and the API response carry. */
  private async loadAppointmentWithRelations(
    appointmentId: string,
    clinicId: string
  ): Promise<AppointmentWithRelations | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const delegate = client['appointment'] as unknown as {
        findFirst: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations | null>;
      };
      return await delegate.findFirst({
        where: { id: appointmentId, clinicId },
        include: {
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          clinic: true,
        },
      } as PrismaDelegateArgs);
    });
  }

  private static readonly MAX_RESCHEDULES = 2;

  /**
   * A checked-in in-person visit that was moved must not stay in today's queue for the old slot.
   * The queue lives in the cache, outside the database write, so this is best effort and logged.
   */
  private async dropMovedVisitFromQueue(
    before: RescheduleAppointmentRow,
    clinicId: string
  ): Promise<void> {
    // Not gated on before.checkedInAt: a check-in may have committed after that read, and removal
    // is a no-op for a visit that is not queued.
    if (!shouldDropFromQueueAfterMove(before) || !before.doctorId) return;
    try {
      await this.appointmentQueueService.removePatientFromQueue(
        before.id,
        before.doctorId,
        clinicId,
        'clinic'
      );
    } catch (queueError) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Queue cleanup after reschedule failed: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
        'AppointmentsService.rescheduleAppointment',
        { appointmentId: before.id, doctorId: before.doctorId, clinicId }
      );
    }
  }

  /**
   * Everything that must see the same appointment, under the locks: the fresh read and the policy
   * decision, the slot checks against live rows, and the conditional write. Returns the count of
   * reschedules before this one and the row as it was just before the move.
   */
  private async rescheduleUnderLocks(params: {
    appointmentId: string;
    newDate: string;
    newTime: string;
    userId: string;
    role: string;
    clinicId: string;
    cachedDoctorId: string;
  }): Promise<{ before: RescheduleAppointmentRow; rescheduleCount: number }> {
    const { appointmentId, newDate, newTime, userId, role, clinicId } = params;
    const context = 'AppointmentsService.rescheduleAppointment';

    const before = await this.loadAppointmentForReschedule(appointmentId, clinicId);

    // The slot lock was keyed on the doctor of the cached detail. If the visit was handed to
    // another doctor since, that lock protects the wrong doctor's slot: start over.
    if (before.doctorId !== params.cachedDoctorId) {
      throw this.errors.appointmentConflict(appointmentId, context);
    }

    const rescheduleCount = this.assertRescheduleAllowed(before);

    // Check availability for new slot on the same grid the visit was booked on: the
    // appointment's own type (video slots differ from in-clinic ones) and clinic location.
    const availability = (await this.coreAppointmentService.getDoctorAvailability(
      before.doctorId,
      newDate,
      {
        clinicId,
        userId,
        role: 'USER',
        ...(before.locationId ? { locationId: before.locationId } : {}),
        ...(before.type ? { appointmentType: String(before.type) } : {}),
      }
    )) as { availableSlots: string[] };

    if (!availability.availableSlots || !availability.availableSlots.includes(newTime)) {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.WARN,
        `Reschedule refused: ${newDate} ${newTime} is not an open slot for the doctor`,
        context,
        {
          appointmentId,
          doctorId: before.doctorId,
          appointmentType: before.type,
          requested: { newDate, newTime },
          openSlotCount: availability.availableSlots?.length ?? 0,
          openSlotsSample: (availability.availableSlots ?? []).slice(0, 8),
        }
      );
      throw this.errors.appointmentSlotUnavailable(`${newDate} ${newTime}`, context);
    }

    // Re-check against the live rows now that the lock is held (availability may have been
    // computed before a concurrent booking committed). A doctor may hold a video visit and an
    // in-clinic visit in the same slot, never two of the same kind; this appointment is excluded.
    const dayAppointments = await loadDoctorDayAppointments(this.databaseService, {
      doctorId: before.doctorId,
      clinicId,
      dayKey: formatDateKeyInIST(new Date(newDate)),
      excludeAppointmentId: appointmentId,
    });
    const conflictingKind = findConflictingSlotKind(dayAppointments, {
      type: before.type,
      time: newTime,
    });
    if (conflictingKind) {
      throw new ConflictException(slotConflictMessage(conflictingKind));
    }

    await this.claimReschedule({
      row: before,
      newDate,
      newTime,
      rescheduleCount,
      userId,
      role,
      clinicId,
    });

    return { before, rescheduleCount };
  }

  /**
   * Reschedule appointment with policy enforcement (24h notice).
   */
  async rescheduleAppointment(
    appointmentId: string,
    newDate: string,
    newTime: string,
    userId: string,
    clinicId: string,
    role?: string
  ): Promise<AppointmentResult> {
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'update',
      resourceId: appointmentId,
    });
    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.rescheduleAppointment');
    }

    const appointment = (await this.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations;

    if (!appointment) {
      throw this.errors.notFound(
        'Appointment',
        appointmentId,
        'AppointmentsService.rescheduleAppointment'
      );
    }

    // Clinic scoping, asserted again here so it holds whatever the read above returned.
    if (appointment.clinicId !== clinicId) {
      throw this.errors.appointmentNotFound(
        appointmentId,
        'AppointmentsService.rescheduleAppointment'
      );
    }

    // RbacGuard passes any PATIENT (blanket appointments:update), so ownership is enforced here
    // for every caller: a patient may only move their own appointment or an owned dependent's.
    // Staff are scoped to the clinic only. An unknown or missing role is treated like a patient.
    const normalizedRole = String(role ?? '').toUpperCase();
    if (!AppointmentsService.RESCHEDULE_STAFF_ROLES.has(normalizedRole)) {
      const ownsAppointment = await isAppointmentOwnedByPatientUser(
        this.databaseService,
        appointment,
        userId
      );
      if (!ownsAppointment) {
        throw this.errors.insufficientPermissions('AppointmentsService.rescheduleAppointment');
      }
    }

    // The new slot, validated before any lock is taken.
    const context = 'AppointmentsService.rescheduleAppointment';
    const newSlotStart = parseIstDateTime(newDate, newTime);
    if (!newSlotStart) {
      throw this.errors.validationError('date', 'The new date or time is not valid.', context);
    }

    // Whether the visit may move is decided on a fresh read inside two locks, never on the cached
    // detail above (it can be 30 minutes old, and a check-in or another reschedule may have landed
    // since). The slot lock is the very lock the create path takes, so a booking and a reschedule
    // of the same doctor slot serialize; the appointment lock serializes concurrent reschedules of
    // this one appointment, so two moves to different slots cannot both pass the reschedule limit.
    const bookingLockKey = `lock:booking:${appointment.doctorId}:${clinicId}:${newSlotStart.toISOString()}`;
    const appointmentLockKey = `lock:reschedule:${clinicId}:${appointmentId}`;

    const bookingLockAcquired = await this.cacheService.acquireLock(bookingLockKey, 15);
    if (!bookingLockAcquired) {
      // Another booking or reschedule holds this very slot right now (or the lock store is not
      // reachable: acquireLock reports both as "not acquired"). Say which request was refused.
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.WARN,
        `Reschedule refused: the slot lock for ${newDate} ${newTime} is held`,
        context,
        { appointmentId, doctorId: appointment.doctorId, requested: { newDate, newTime } }
      );
      throw this.errors.appointmentSlotUnavailable(`${newDate} ${newTime}`, context);
    }

    let outcome: { before: RescheduleAppointmentRow; rescheduleCount: number };
    try {
      const appointmentLockAcquired = await this.cacheService.acquireLock(appointmentLockKey, 15);
      if (!appointmentLockAcquired) {
        throw this.errors.appointmentConflict(appointmentId, context);
      }
      try {
        outcome = await this.rescheduleUnderLocks({
          appointmentId,
          newDate,
          newTime,
          userId,
          role: String(role ?? ''),
          clinicId,
          cachedDoctorId: appointment.doctorId,
        });
      } finally {
        await this.cacheService.releaseLock(appointmentLockKey);
      }
    } finally {
      await this.cacheService.releaseLock(bookingLockKey);
    }

    const { before, rescheduleCount } = outcome;

    await this.dropMovedVisitFromQueue(before, clinicId);

    // The write above bypasses the database layer's own invalidation: drop the stale detail and
    // list entries now so the read below, and any concurrent reader, see the new slot.
    try {
      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        before.patientId,
        before.doctorId,
        clinicId
      );
      this.invalidateBookingUserCache(before.userId);
    } catch (cacheError) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Cache invalidation after reschedule failed: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
        context,
        { appointmentId, clinicId }
      );
    }

    const updated =
      (await this.loadAppointmentWithRelations(appointmentId, clinicId)) ??
      ({ id: appointmentId, clinicId } as unknown as AppointmentWithRelations);

    await this.syncPaidAppointmentBillingAfterReschedule(appointment, newDate, newTime, userId);

    try {
      await this.appointmentReminderService.rescheduleReminder(
        appointmentId,
        appointment.patientId,
        appointment.doctorId,
        clinicId,
        'appointment_reminder',
        0.25,
        ['email', 'whatsapp'],
        {
          patientName: 'Patient',
          doctorName: 'Doctor',
          appointmentDate: newDate,
          appointmentTime: newTime,
          location: 'Clinic',
          clinicName: this.configService.getEnv('APP_NAME', 'Healthcare App'),
          appointmentType: appointment.type,
          notes: appointment.notes ?? undefined,
        },
        this.resolveAppointmentReminderScheduledFor(newDate, newTime, 0.25)
      );
    } catch (reminderError) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to reschedule queued appointment reminder',
        'AppointmentsService.rescheduleAppointment',
        {
          appointmentId,
          error: reminderError instanceof Error ? reminderError.message : String(reminderError),
        }
      );
    }

    // Notify
    await this.eventService.emit('appointment.rescheduled', {
      appointmentId,
      clinicId,
      oldDate: before.date,
      oldTime: before.time,
      newDate,
      newTime,
      appointment: updated,
      context: { userId },
    });

    return {
      success: true,
      data: updated as unknown as Record<string, unknown>,
      message: `Appointment rescheduled successfully (Count: ${rescheduleCount + 1}/${AppointmentsService.MAX_RESCHEDULES}).`,
    };
  }

  /**
   * Get appointments using enhanced core service with auth integration
   */
  async getAppointments(
    filters: AppointmentFilterDto,
    userId: string,
    clinicId: string,
    _role: string = 'USER',
    page: number = 1,
    limit: number = 20
  ): Promise<AppointmentResult> {
    // RBAC: Check permission to read appointments
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'read',
    });

    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.getAppointments');
    }

    const patient =
      _role === 'PATIENT' ? await this.resolvePatientProfileForAppointments(userId) : null;
    const isConsultantRole = [Role.DOCTOR, Role.ASSISTANT_DOCTOR].includes(_role as Role);

    const doctor = isConsultantRole ? await this.resolveDoctorEntityId(userId, clinicId) : null;

    // Log patient resolution for debugging
    if (_role === 'PATIENT') {
      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `[getAppointments] Patient resolution: userId=${userId}, patientId=${patient?.id || 'NOT_FOUND'}`,
        'AppointmentsService',
        { userId, patientId: patient?.id, role: _role }
      );
    }

    const context: AppointmentContext = {
      userId,
      role: _role,
      clinicId,
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(doctor ? { doctorId: doctor } : {}),
      ...(!isConsultantRole && filters.doctorId ? { doctorId: filters.doctorId } : {}),
      ...(!isConsultantRole && filters.providerId ? { doctorId: filters.providerId } : {}),
      ...(_role !== 'PATIENT' && filters.patientId ? { patientId: filters.patientId } : {}),
      ...(_role === 'PATIENT' && patient?.id ? { patientId: patient.id } : {}),
    };

    // Use CacheService as single source of truth - leverages all optimization layers:
    // - Circuit breaker (built-in)
    // - Metrics tracking (built-in)
    // - Error handling with graceful degradation (built-in)
    // - SWR support (built-in)
    // - Health monitoring (built-in)
    // - Key factory for proper key generation
    const keyFactory = this.cacheService.getKeyFactory();
    const filtersHash = JSON.stringify(filters);
    // Key factory automatically adds 'healthcare' prefix, so we don't need to include it
    const cacheKey = keyFactory.fromTemplate(
      'clinic:{clinicId}:appointments:list:{userId}:{role}:{filters}:{page}:{limit}',
      {
        clinicId,
        userId,
        role: _role,
        filters: filtersHash,
        page: String(page),
        limit: String(limit),
      }
    );

    // PATIENT used to bypass this cache entirely (every my-appointments load hit
    // Postgres uncached). That was because CacheService.invalidateAppointmentCache
    // didn't bust `user:${patientId}` on status changes, so a completed/cancelled
    // appointment could show stale here. That tag is now included (see
    // cache.service.ts invalidateAppointmentCache), so the cache below — already
    // keyed and tagged per-user — is safe for patients too.
    return this.cacheService.cache(
      cacheKey,
      async () =>
        this.attachLiveQueueState(
          await this.coreAppointmentService.getAppointments(filters, context, page, limit),
          clinicId
        ),
      {
        ttl: 300, // 5 minutes - optimized for 10M+ users (balance freshness vs load)
        tags: ['appointments', 'clinic_appointments', `clinic:${clinicId}`, `user:${userId}`],
        priority: 'normal',
        enableSwr: true, // Stale-while-revalidate for better performance
        containsPHI: true,
        compress: true, // Compress PHI data to reduce memory usage
        clinicSpecific: true, // Healthcare-specific optimization
      }
    );
  }

  /**
   * GET /appointments/summary/daily. Counts, paid revenue and the average consultation length of
   * the appointments in an IST day range. A DOCTOR / ASSISTANT_DOCTOR is always pinned to their own
   * Doctor row; an admin may name a doctor of the clinic (Doctor.id or User id) or omit it for the
   * clinic total. Clinic-scoped on every path, so another clinic's doctor is simply "not found".
   */
  async getDailySummary(input: {
    clinicId: string;
    actorUserId: string;
    role: string;
    startDate?: string;
    endDate?: string;
    doctorId?: string;
  }): Promise<AppointmentDailySummaryDto> {
    const context = 'AppointmentsService.getDailySummary';
    const MAX_RANGE_DAYS = 92;

    const startKey = formatDateKeyInIST(input.startDate ? new Date(input.startDate) : new Date());
    const endKey = input.endDate ? formatDateKeyInIST(new Date(input.endDate)) : startKey;
    const rangeStart = startKey ? startOfIstDay(startKey) : null;
    const rangeEnd = endKey ? endOfIstDay(endKey) : null;
    if (!rangeStart || !rangeEnd) {
      throw this.errors.validationError('startDate', 'Invalid date range', context);
    }
    if (rangeEnd.getTime() < rangeStart.getTime()) {
      throw this.errors.validationError('endDate', 'endDate must not be before startDate', context);
    }
    if (rangeEnd.getTime() - rangeStart.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw this.errors.validationError(
        'endDate',
        `The summary range cannot exceed ${MAX_RANGE_DAYS} days`,
        context
      );
    }

    const isConsultant = [Role.DOCTOR, Role.ASSISTANT_DOCTOR].includes(input.role as Role);
    let doctorId: string | undefined;
    if (isConsultant) {
      const own = await this.resolveDoctorEntityId(input.actorUserId, input.clinicId);
      if (!own) throw this.errors.insufficientPermissions(context);
      doctorId = own;
    } else if (input.doctorId) {
      const requested = input.doctorId;
      const resolved = await this.databaseService.executeHealthcareRead(async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctor.findFirst({
          where: {
            clinics: { some: { clinicId: input.clinicId } },
            OR: [{ id: requested }, { userId: requested }],
          },
          select: { id: true },
        });
      });
      if (!resolved) throw this.errors.doctorNotFound(requested, context);
      doctorId = resolved.id;
    }

    type SummaryRow = {
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
      payment: { amount: number; status: string } | null;
    };
    const rows = await this.databaseService.executeHealthcareRead<SummaryRow[]>(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return (await tx.appointment.findMany({
        where: {
          clinicId: input.clinicId,
          date: { gte: rangeStart, lte: rangeEnd },
          ...(doctorId ? { doctorId } : {}),
        },
        select: {
          status: true,
          startedAt: true,
          completedAt: true,
          payment: { select: { amount: true, status: true } },
        },
      })) as unknown as SummaryRow[];
    });

    const breakdown = new Map<string, number>();
    let completed = 0;
    let noShows = 0;
    let cancelled = 0;
    let pending = 0;
    let revenue = 0;
    let consultationMinutes = 0;
    let consultationsTimed = 0;
    const OPEN_STATUSES = new Set<string>([
      String(AppointmentStatus.SCHEDULED),
      String(AppointmentStatus.CONFIRMED),
      String(AppointmentStatus.IN_PROGRESS),
    ]);

    for (const row of rows) {
      const status = String(row.status || '').toUpperCase();
      breakdown.set(status, (breakdown.get(status) ?? 0) + 1);
      if (status === String(AppointmentStatus.COMPLETED)) completed += 1;
      else if (status === String(AppointmentStatus.NO_SHOW)) noShows += 1;
      else if (status === String(AppointmentStatus.CANCELLED)) cancelled += 1;
      else if (OPEN_STATUSES.has(status)) pending += 1;

      if (row.payment && isPaidPaymentStatus(normalizePaymentStatus(row.payment.status || ''))) {
        revenue += Number(row.payment.amount) || 0;
      }
      if (row.startedAt && row.completedAt) {
        const minutes =
          (new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()) / 60_000;
        if (Number.isFinite(minutes) && minutes > 0) {
          consultationMinutes += minutes;
          consultationsTimed += 1;
        }
      }
    }

    return {
      startDate: startKey,
      endDate: endKey,
      ...(doctorId ? { doctorId } : {}),
      totalAppointments: rows.length,
      completed,
      noShows,
      cancelled,
      pending,
      revenue: Math.round(revenue * 100) / 100,
      averageConsultationMin:
        consultationsTimed > 0 ? Math.round(consultationMinutes / consultationsTimed) : 0,
      appointmentStatusBreakdown: [...breakdown.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([status, count]) => ({ status, count })),
    };
  }

  /**
   * Fresh (uncached) read of the appointment's status and type, scoped to the caller's clinic.
   * The guard in {@link assertStatusChangeAllowed} must rest on the current row, not on a cached
   * detail that could be minutes stale or belong to another clinic.
   */
  private async loadAppointmentStatusSnapshot(
    appointmentId: string,
    clinicId: string
  ): Promise<AppointmentStatusSnapshot> {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const delegate = client['appointment'] as unknown as {
        findFirst: (args: PrismaDelegateArgs) => Promise<AppointmentStatusSnapshot | null>;
      };
      return await delegate.findFirst({
        where: { id: appointmentId, clinicId },
        select: { id: true, type: true, status: true },
      });
    });

    if (!appointment) {
      throw this.errors.appointmentNotFound(appointmentId, 'AppointmentsService.updateAppointment');
    }
    return appointment;
  }

  /**
   * Early, clinic-scoped answer for the generic update (PUT /appointments/:id). The rules
   * themselves are the state contract's (getGenericStatusChangeRefusal) and the core service
   * enforces them again on every update, whichever route it came through; this guard only answers
   * first, from a fresh read, for the cases that need one:
   * - a non-staff caller (patient...) may not change a status here: they cancel, or check in;
   * - nobody confirms through the generic update: an in-clinic visit is confirmed by check-in
   *   (QR, code, front desk, presence at the clinic), a video visit by payment.
   * Every other staff transition is left to the core, which reads the row itself.
   */
  private async assertStatusChangeAllowed(
    appointmentId: string,
    updateDto: UpdateAppointmentDto,
    clinicId: string,
    role: string
  ): Promise<void> {
    if (!updateDto.status) {
      return;
    }

    const requestedStatus = String(updateDto.status).toUpperCase();

    if (isAppointmentStaffRole(role) && requestedStatus !== String(AppointmentStatus.CONFIRMED)) {
      return;
    }

    const current = await this.loadAppointmentStatusSnapshot(appointmentId, clinicId);
    const refusal = getGenericStatusChangeRefusal({
      currentStatus: current.status,
      targetStatus: requestedStatus,
      appointmentType: current.type,
      role,
    });
    if (refusal) {
      throw refusal.httpStatus === 403
        ? new ForbiddenException(refusal.message)
        : new BadRequestException(refusal.message);
    }
  }

  /**
   * What a caller may ask of the status endpoint, before anything is dispatched. Clinic staff and
   * the SYSTEM scheduler drive the lifecycle (each target then has its own rules below). Everyone
   * else, a patient above all, may only cancel: starting a consultation, completing, confirming
   * (the legacy check-in with no geofence), no-show and expiry are not theirs, and no-show and
   * expiry can also trigger refunds and free the slot.
   */
  private assertStatusRequestAllowedForRole(targetStatus: AppointmentStatus, role: string): void {
    if (isAppointmentSystemRole(role) || isAppointmentStaffRole(role)) {
      return;
    }
    if (targetStatus === AppointmentStatus.CANCELLED) {
      return;
    }

    throw new ForbiddenException(PATIENT_STATUS_CHANGE_MESSAGE);
  }

  /**
   * Update appointment using enhanced core service
   */
  async updateAppointment(
    appointmentId: string,
    updateDto: UpdateAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    // RBAC: Check permission to update appointments
    // SYSTEM role bypass: automated schedulers (no-show detection, system events) skip RBAC
    // and the status-change guard below.
    if (role !== 'SYSTEM') {
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
        resourceId: appointmentId,
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.updateAppointment');
      }

      await this.assertStatusChangeAllowed(appointmentId, updateDto, clinicId, role);
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    const result = await this.coreAppointmentService.updateAppointment(
      appointmentId,
      updateDto,
      context
    );

    // Invalidate related cache entries
    if (result.success) {
      const updatedRecord = result.data ?? {};
      const queuedDoctorId =
        typeof updatedRecord?.['doctorId'] === 'string' && updatedRecord['doctorId']
          ? String(updatedRecord['doctorId'])
          : undefined;
      const rawStatus = updatedRecord['status'];
      const resultingStatus = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';

      // The patient leaves the doctor's queue only when the appointment is over. An edit that
      // keeps it alive (a note on a checked-in visit) must not drop a queued patient: they would
      // stay CONFIRMED with a check-in time and could never be queued again. The doctor cannot
      // change through this method (reassignDoctor moves the queue entry itself), so a terminal
      // status is the only reason to remove it here.
      if (queuedDoctorId && APPOINTMENT_TERMINAL_STATUSES.has(resultingStatus)) {
        try {
          await this.appointmentQueueService.removePatientFromQueue(
            appointmentId,
            queuedDoctorId,
            clinicId,
            'clinic'
          );
        } catch (queueError) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Queue cleanup after appointment update to ${resultingStatus} failed: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
            'AppointmentsService.updateAppointment',
            {
              appointmentId,
              doctorId: queuedDoctorId,
              clinicId,
              error: queueError instanceof Error ? queueError.stack : undefined,
            }
          );
        }
      }

      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.['patientId'] as string,
        (result.data as Record<string, unknown>)?.['doctorId'] as string,
        clinicId
      );
      this.invalidateBookingUserCache((result.data as Record<string, unknown>)?.['userId']);

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.emitAppointmentEnterpriseEvent('appointment.updated', {
        eventId: `appointment-updated-${appointmentId}-${Date.now()}`,
        clinicId,
        priority: EventPriority.NORMAL,
        userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
        payload: {
          appointmentId,
          userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          changes: updateDto,
          updatedBy: userId,
          status:
            updateDto.status || ((result.data as Record<string, unknown>)?.['status'] as string),
          appointment: result.data,
        },
      });
    }

    return result;
  }

  /**
   * Consolidated status update method (State Machine Trigger)
   *
   * @description Orchestrates appointment state transitions using the new state machine pattern.
   * Delegates to specific handlers based on the target status.
   */
  async updateStatus(
    appointmentId: string,
    updateDto: UpdateAppointmentStatusDto,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<unknown> {
    // 1. Get Appointment to validate existence and clinic isolation
    const appointment = (await this.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations;

    const normalizedStatus = updateDto.status;

    // IN_PROGRESS -> EXPIRED is the scheduler closing a visit the doctor started but never
    // completed. It is allowed by the state contract for the system only: no human role may
    // expire a consultation that is under way. Checked first so the answer is the same 403 for
    // every appointment type.
    if (
      isSystemOnlyStatusTransition(String(appointment.status), String(normalizedStatus)) &&
      !isAppointmentSystemRole(role)
    ) {
      throw this.errors.insufficientPermissions('AppointmentsService.updateStatus');
    }

    // Only clinic staff and the scheduler move an appointment through its lifecycle; everyone
    // else may only cancel. Refused before anything else runs (the NO_SHOW branch below can issue
    // a refund before it reaches the update, IN_PROGRESS would start a consultation, CONFIRMED
    // would run a check-in).
    this.assertStatusRequestAllowedForRole(normalizedStatus, role);

    // 2. Business rule: IN_PERSON appointments must complete check-in (reach CONFIRMED) before a
    //    consultation can be started or completed. Other targets (cancel, no-show, expire...) do
    //    not need an arrival; startConsultation and completeAppointment enforce their own rules too.
    if (
      (normalizedStatus === AppointmentStatus.IN_PROGRESS ||
        normalizedStatus === AppointmentStatus.COMPLETED) &&
      String(appointment.type) === String(AppointmentType.IN_PERSON) &&
      String(appointment.status).toUpperCase() !== String(AppointmentStatus.CONFIRMED)
    ) {
      throw this.errors.businessRuleViolation(
        'In-person appointment is not confirmed. Patient must scan the clinic QR before the consultation can start.',
        'AppointmentsService.updateStatus'
      );
    }

    // 3. Dispatch based on new status
    switch (normalizedStatus) {
      case AppointmentStatus.CONFIRMED:
        return this.processCheckIn(
          {
            appointmentId,
            ...(updateDto.locationId && { locationId: updateDto.locationId }),
            ...(updateDto.qrCode && { qrCode: updateDto.qrCode }),
            ...(updateDto.checkInMethod && { checkInMethod: updateDto.checkInMethod }),
            ...(updateDto.notes && { notes: updateDto.notes }),
          },
          userId,
          clinicId,
          role
        );

      case AppointmentStatus.IN_PROGRESS:
        return this.startConsultation(
          appointmentId,
          {
            doctorId: appointment.doctorId || userId,
            ...(updateDto.notes && { notes: updateDto.notes }),
            ...(updateDto.consultationType && { consultationType: updateDto.consultationType }),
          },
          userId,
          clinicId,
          role
        );

      case AppointmentStatus.COMPLETED:
        return this.completeAppointment(
          appointmentId,
          {
            doctorId: appointment.doctorId || userId,
            ...(updateDto.notes && { notes: updateDto.notes }),
            ...(updateDto.diagnosis && { diagnosis: updateDto.diagnosis }),
            ...(updateDto.treatmentPlan && { treatmentPlan: updateDto.treatmentPlan }),
            ...(updateDto.prescription && { prescription: updateDto.prescription }),
            ...(updateDto.followUpRequired !== undefined && {
              followUpRequired: updateDto.followUpRequired,
            }),
            ...(updateDto.followUpDate && { followUpDate: updateDto.followUpDate }),
            ...(updateDto.followUpType && { followUpType: updateDto.followUpType }),
            ...(updateDto.followUpInstructions && {
              followUpInstructions: updateDto.followUpInstructions,
            }),
            ...(updateDto.followUpPriority && { followUpPriority: updateDto.followUpPriority }),
            ...(updateDto.medications && { medications: updateDto.medications }),
            ...(updateDto.tests && { tests: updateDto.tests }),
            ...(updateDto.restrictions && { restrictions: updateDto.restrictions }),
          },
          userId,
          clinicId,
          role
        );

      case AppointmentStatus.EXPIRED: {
        const expiredResult = await this.updateAppointment(
          appointmentId,
          {
            status: normalizedStatus,
            ...(updateDto.reason && { reason: updateDto.reason }),
            ...(updateDto.notes && { notes: updateDto.notes }),
          },
          userId,
          clinicId,
          role
        );

        return expiredResult;
      }

      case AppointmentStatus.CANCELLED: {
        // Production policy: enforce 4-hour cancellation notice for patients.
        // Temporarily disabled for testing so near-term appointments can be cancelled.
        // if (role === 'PATIENT') {
        //   const apptTime = new Date(
        //     parseIstDateTime(appointment.date, appointment.time)
        //   );
        //   const nowTime = new Date();
        //   const fourHoursMs = 4 * 60 * 60 * 1000;
        //   if (apptTime.getTime() - nowTime.getTime() < fourHoursMs) {
        //     throw this.errors.businessRuleViolation(
        //       'Cancellation requires at least 4 hours notice.',
        //       'AppointmentsService.updateStatus'
        //     );
        //   }
        // }

        if (!updateDto.reason) {
          throw this.errors.validationError(
            'reason',
            'Cancellation reason is required',
            'AppointmentsService.updateStatus'
          );
        }

        // Validate the cancellation itself succeeds (e.g. rejects an
        // already-COMPLETED/CANCELLED/IN_PROGRESS appointment) BEFORE
        // triggering any refund — refunding first meant a rejected
        // cancellation (invalid state transition) still issued a real
        // gateway refund for an appointment that stayed unchanged.
        const cancelResult = await this.cancelAppointment(
          appointmentId,
          updateDto.reason,
          userId,
          clinicId,
          role
        );

        return cancelResult;
      }

      case AppointmentStatus.NO_SHOW: {
        // A visit that never happened ends here (or EXPIRED) with its payment left as it is: there
        // is no automatic refund, whoever did not show up. The patient books a new appointment.
        const noShowResult = await this.updateAppointment(
          appointmentId,
          {
            status: normalizedStatus,
            ...(updateDto.notes && { notes: updateDto.notes }),
          },
          userId,
          clinicId,
          role
        );
        try {
          if (appointment.doctorId) {
            await this.appointmentQueueService.removePatientFromQueue(
              appointmentId,
              appointment.doctorId,
              clinicId,
              'clinic'
            );
          }
        } catch (queueError) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Queue cleanup after no-show update failed: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
            'AppointmentsService.updateStatus',
            {
              appointmentId,
              doctorId: appointment.doctorId,
              clinicId,
              error: queueError instanceof Error ? queueError.stack : undefined,
            }
          );
        }
        return noShowResult;
      }

      // Every other target (ON_HOLD, RESCHEDULED...) is a generic update: the core applies the
      // state contract. CONFIRMED, IN_PROGRESS and COMPLETED never get here; they have their own flows.
      default:
        return this.updateAppointment(
          appointmentId,
          {
            status: normalizedStatus,
            ...(updateDto.notes && { notes: updateDto.notes }),
          },
          userId,
          clinicId,
          role
        );
    }
  }

  async reassignDoctor(
    appointmentId: string,
    newDoctorId: string,
    userId: string,
    clinicId: string,
    role: string,
    reason?: string
  ): Promise<unknown> {
    const appointment = (await this.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations & { metadata?: unknown };

    if (
      [
        AppointmentStatus.COMPLETED,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
      ].includes(appointment.status as AppointmentStatus)
    ) {
      throw this.errors.businessRuleViolation(
        'Completed, cancelled, or no-show appointments cannot be reassigned',
        'AppointmentsService.reassignDoctor'
      );
    }

    if (appointment.doctorId === newDoctorId) {
      return {
        success: true,
        data: appointment,
        message: 'Appointment is already assigned to this doctor',
      };
    }

    const targetDoctor = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.doctor.findUnique({
        where: { id: newDoctorId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              name: true,
            },
          },
          clinics: {
            where: { clinicId },
            select: {
              clinicId: true,
              locationId: true,
            },
          },
        },
      });
    });

    if (!targetDoctor?.user) {
      throw this.errors.recordNotFound('doctor', 'AppointmentsService.reassignDoctor');
    }

    const targetDoctorRole = String(targetDoctor.user.role);
    const isAssistantDoctor = targetDoctorRole === String(Role.ASSISTANT_DOCTOR);
    const isServicingDoctor =
      targetDoctorRole === String(Role.DOCTOR) ||
      targetDoctorRole === String(Role.ASSISTANT_DOCTOR);

    if (!isServicingDoctor) {
      throw this.errors.businessRuleViolation(
        'Appointments can only be reassigned to doctor or assistant doctor roles',
        'AppointmentsService.reassignDoctor'
      );
    }

    const currentMetadata = this.asMetadataRecord(appointment.metadata);
    const primaryDoctorId =
      typeof currentMetadata['primaryDoctorId'] === 'string' && currentMetadata['primaryDoctorId']
        ? currentMetadata['primaryDoctorId']
        : appointment.doctorId;

    if (isAssistantDoctor) {
      const serviceMetadata = this.getAppointmentServiceMetadata(appointment.treatmentType);
      if (!serviceMetadata.assistantDoctorEligible) {
        throw this.errors.businessRuleViolation(
          `${serviceMetadata.label} cannot be delegated to an assistant doctor`,
          'AppointmentsService.reassignDoctor'
        );
      }

      const assistantCoverage = await this.getClinicAssistantDoctorCoverage(clinicId);
      if (
        !this.isAssistantDoctorCoveredForPrimaryDoctor(
          assistantCoverage,
          newDoctorId,
          primaryDoctorId
        )
      ) {
        throw this.errors.businessRuleViolation(
          'Assistant coverage is not configured for this primary doctor',
          'AppointmentsService.reassignDoctor'
        );
      }
    }

    const doctorClinicLink = Array.isArray(targetDoctor.clinics) ? targetDoctor.clinics[0] : null;
    if (!doctorClinicLink) {
      throw this.errors.businessRuleViolation(
        'Target doctor is not assigned to this clinic',
        'AppointmentsService.reassignDoctor'
      );
    }

    if (
      appointment.locationId &&
      doctorClinicLink.locationId &&
      appointment.locationId !== doctorClinicLink.locationId
    ) {
      throw this.errors.businessRuleViolation(
        'Target doctor is not assigned to the appointment location',
        'AppointmentsService.reassignDoctor'
      );
    }

    const updatedMetadata = {
      ...currentMetadata,
      primaryDoctorId,
      assignedDoctorId: newDoctorId,
      lastReassignment: {
        previousDoctorId: appointment.doctorId,
        newDoctorId,
        reassignedBy: userId,
        reason: reason || 'Operational reassignment',
        reassignedAt: nowIso(),
        reassignedByRole: role,
      },
    };

    const updatedAppointment = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as Prisma.TransactionClient;
        return await typedClient.appointment.update({
          where: { id: appointmentId },
          data: {
            doctorId: newDoctorId,
            metadata: updatedMetadata,
          },
          include: {
            patient: true,
            doctor: true,
            clinic: true,
            location: true,
          },
        });
      },
      {
        userId,
        clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointmentId,
        userRole: role,
        details: {
          action: 'REASSIGN_DOCTOR',
          previousDoctorId: appointment.doctorId,
          newDoctorId,
          reason: reason || null,
        },
      }
    );

    // Video visits never enter a doctor queue: they are only re-assigned in the database.
    if (
      String(appointment.status) === String(AppointmentStatus.CONFIRMED) &&
      !isVideoCallAppointmentType(appointment.type)
    ) {
      await this.appointmentQueueService.removePatientFromQueue(
        appointmentId,
        appointment.doctorId,
        clinicId,
        'clinic'
      );
      await this.appointmentQueueService.checkIn(
        {
          appointmentId,
          doctorId: newDoctorId,
          patientId: appointment.patientId,
          clinicId,
          appointmentType: appointment.type,
          ...(appointment.locationId ? { locationId: appointment.locationId } : {}),
          ...(reason ? { notes: reason } : {}),
        },
        'clinic'
      );
    }

    await this.emitAppointmentEnterpriseEvent('appointment.reassigned', {
      eventId: `appointment-reassigned-${appointmentId}-${Date.now()}`,
      clinicId,
      userId: appointment.patientId,
      payload: {
        appointmentId,
        previousDoctorId: appointment.doctorId,
        newDoctorId,
        primaryDoctorId,
        assignedDoctorId: newDoctorId,
        reason: reason || null,
      },
    });

    return {
      success: true,
      data: updatedAppointment,
      message: 'Appointment reassigned successfully',
    };
  }

  /**
   * Cancel appointment using enhanced core service
   */
  async cancelAppointment(
    appointmentId: string,
    reason: string,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    // RBAC: Check permission to cancel appointments (requires update permission)
    // SYSTEM role bypass: automated schedulers (no-show detection, system events) skip RBAC
    if (role !== 'SYSTEM') {
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
        resourceId: appointmentId,
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.cancelAppointment');
      }
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    const result = await this.coreAppointmentService.cancelAppointment(
      appointmentId,
      reason,
      context
    );

    // Invalidate related cache entries
    if (result.success) {
      const resultRecord = (result.data as Record<string, unknown>) || {};
      const resolvePersonName = (value: unknown, fallback: string): string => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return fallback;
        }

        const record = value as Record<string, unknown>;
        const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
        if (name) {
          return name;
        }

        const firstName = typeof record['firstName'] === 'string' ? record['firstName'].trim() : '';
        const lastName = typeof record['lastName'] === 'string' ? record['lastName'].trim() : '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
        if (fullName) {
          return fullName;
        }

        const email = typeof record['email'] === 'string' ? record['email'].trim() : '';
        return email || fallback;
      };
      const patientRecord =
        (resultRecord['patient'] as Record<string, unknown> | undefined) || undefined;
      const doctorRecord =
        (resultRecord['doctor'] as Record<string, unknown> | undefined) || undefined;
      const patientUserRecord =
        (patientRecord?.['user'] as Record<string, unknown> | undefined) || undefined;
      const doctorUserRecord =
        (doctorRecord?.['user'] as Record<string, unknown> | undefined) || undefined;

      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.['patientId'] as string,
        (result.data as Record<string, unknown>)?.['doctorId'] as string,
        clinicId
      );
      this.invalidateBookingUserCache((result.data as Record<string, unknown>)?.['userId']);

      try {
        await this.appointmentReminderService.cancelAppointmentReminder(
          appointmentId,
          'appointment_reminder'
        );
      } catch (reminderError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Failed to cancel queued appointment reminder',
          'AppointmentsService.cancelAppointment',
          {
            appointmentId,
            error: reminderError instanceof Error ? reminderError.message : String(reminderError),
          }
        );
      }

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.emitAppointmentEnterpriseEvent('appointment.cancelled', {
        eventId: `appointment-cancelled-${appointmentId}-${Date.now()}`,
        clinicId,
        userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
        payload: {
          appointmentId,
          userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          patientName: resolvePersonName(patientUserRecord ?? patientRecord, 'Patient'),
          doctorName: resolvePersonName(doctorUserRecord ?? doctorRecord, 'Doctor'),
          appointmentType: (result.data as Record<string, unknown>)?.['type'] as string,
          appointmentDate: (result.data as Record<string, unknown>)?.['date'] as string,
          appointmentTime: (result.data as Record<string, unknown>)?.['time'] as string,
          reason,
          cancelledBy: userId,
          status: 'CANCELLED',
          appointment: result.data,
        },
      });
    }

    return result;
  }

  /**
   * Reject video appointment proposal (Doctor rejects all slots).
   */
  async rejectVideoProposal(
    appointmentId: string,
    reason: string,
    userId: string,
    clinicId: string
  ): Promise<AppointmentResult> {
    // Check permissions
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'update',
      resourceId: appointmentId,
    });
    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.rejectVideoProposal');
    }

    const appointment = (await this.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations;
    if (!appointment) {
      throw this.errors.notFound(
        'Appointment',
        appointmentId,
        'AppointmentsService.rejectVideoProposal'
      );
    }

    const confirmedSlotIndex = (
      appointment as AppointmentWithRelations & { confirmedSlotIndex?: number | null }
    ).confirmedSlotIndex;
    const canRejectProposal = isVideoSlotAwaitingConfirmation({
      type: appointment.type,
      status: appointment.status,
      proposedSlots: (appointment as AppointmentWithRelations & { proposedSlots?: unknown })
        .proposedSlots,
      confirmedSlotIndex,
    });
    if (!canRejectProposal) {
      throw this.errors.businessRuleViolation(
        'Appointment is not in doctor confirmation stage',
        'AppointmentsService.rejectVideoProposal'
      );
    }

    // Reject -> CANCELLED
    const result = await this.cancelAppointment(
      appointmentId,
      reason || 'Doctor rejected proposed slots',
      userId,
      clinicId,
      'DOCTOR' // Assume doctor/staff role call
    );

    return result;
  }

  /**
   * Get appointment metrics using enhanced core service
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    userId: string,
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    return this.coreAppointmentService.getAppointmentMetrics(clinicId, dateRange, context);
  }

  // =============================================
  // PLUGIN-BASED OPERATIONS
  // =============================================

  /**
   * Process appointment check-in through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   * Direct injection eliminates registry lookup overhead (~0.1ms per call)
   */
  async processCheckIn(
    checkInDto: ProcessCheckInDto,
    userId: string,
    clinicId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // A receptionist assigned to a clinic location may only check in appointments at that
      // location. The clinic-scoped read also turns another clinic's appointment into a 404.
      if (String(_role).toUpperCase() === String(Role.RECEPTIONIST) && checkInDto.appointmentId) {
        const target = (await this.getAppointmentById(
          checkInDto.appointmentId,
          clinicId
        )) as AppointmentWithRelations;
        const assignedToLocation = await isReceptionistAssignedToAppointmentLocation(
          this.databaseService,
          userId,
          clinicId,
          target.locationId
        );
        if (!assignedToLocation) {
          throw this.errors.insufficientPermissions('AppointmentsService.processCheckIn');
        }
      }

      // Hot path: Direct plugin injection for performance (10M+ users scale)
      // Direct access: ~0.1ms faster than registry lookup
      const checkInData = await this.clinicCheckInPlugin.process({
        operation: 'processCheckIn',
        clinicId,
        userId,
        // The actor: without it the plugin applies the patient time window to staff.
        userRole: _role,
        ...checkInDto,
      });

      const result = { success: true, data: checkInData };

      if (result.success) {
        // Log the check-in event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Check-in processed successfully',
          'AppointmentsService',
          { appointmentId: checkInDto.appointmentId, userId, clinicId }
        );

        const appointmentId = checkInDto.appointmentId;
        if (!appointmentId) {
          throw this.errors.validationError(
            'appointmentId',
            'appointmentId is required for check-in event emission',
            'AppointmentsService.processCheckIn'
          );
        }

        // Emit event for real-time broadcasting
        const appointment = (await this.getAppointmentById(
          appointmentId,
          clinicId
        )) as AppointmentWithRelations | null;
        const patientId = appointment?.patientId || userId;
        const doctorId = appointment?.doctorId;
        const checkInMethod = checkInDto.checkInMethod || 'manual';
        const locationId = checkInDto.locationId || appointment?.locationId;
        const checkedInAt = nowIso();
        const checkInEventPayload = {
          appointmentId,
          clinicId,
          userId: patientId,
          patientId,
          doctorId,
          locationId,
          checkedInBy: userId,
          checkInMethod,
          checkedInAt,
          checkInData: checkInDto,
          metadata: {
            appointmentId,
            clinicId,
            patientId,
            doctorId,
            locationId,
            checkedInBy: userId,
            checkInMethod,
            checkedInAt,
            notes: checkInDto.notes,
            source: 'AppointmentsService.processCheckIn',
          },
        };

        await this.eventService.emit('appointment.checked_in', {
          ...checkInEventPayload,
          appointment: result.data,
        });
        await this.eventService.emit('appointment.confirmed', {
          ...checkInEventPayload,
          confirmedBy: userId,
          appointment: result.data,
        });
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process check-in through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.processCheckIn',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof HealthcareError || _error instanceof HttpException) {
        throw _error;
      }
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.appointmentNotFound(
          checkInDto.appointmentId,
          'AppointmentsService.processCheckIn'
        );
      }
      throw this.errors.databaseError('processCheckIn', 'AppointmentsService.processCheckIn');
    }
  }

  /**
   * Complete appointment through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   */

  /** Clinician roles that may complete a VIDEO visit, and only when they are its treating doctor. */
  private static readonly VIDEO_COMPLETION_CLINICIAN_ROLES: ReadonlySet<string> = new Set<string>([
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR,
  ]);

  /**
   * The only role that may complete a VIDEO visit without being its treating doctor: the clinic
   * admin of the appointment's clinic (the read is clinic-scoped, so another clinic's admin gets a
   * 404). Everyone else, the doctor's assistant and the front desk included, gets a 403.
   */
  private static readonly VIDEO_COMPLETION_ADMIN_ROLES: ReadonlySet<string> = new Set<string>([
    Role.CLINIC_ADMIN,
  ]);

  /** Administrators whose completions are written to the audit log. */
  private static readonly ADMIN_COMPLETION_ROLES: ReadonlySet<string> = new Set<string>([
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
  ]);

  /** Every role that may complete an appointment at all. PATIENT and unknown roles never can. */
  private static readonly COMPLETION_ROLES: ReadonlySet<string> = new Set<string>([
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
  ]);

  /**
   * Fresh (uncached) read of the appointment for completion, scoped to the caller's clinic, with
   * the treating doctor's user and the payment state. A cached copy could be minutes stale and
   * the decision to complete must rest on the current row.
   */
  private async loadAppointmentForCompletion(
    appointmentId: string,
    clinicId: string
  ): Promise<CompletionAppointmentRow> {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const delegate = client['appointment'] as unknown as {
        findFirst: (args: PrismaDelegateArgs) => Promise<CompletionAppointmentRow | null>;
      };
      return await delegate.findFirst({
        where: { id: appointmentId, clinicId },
        include: {
          doctor: { select: { id: true, userId: true } },
          payment: { select: { status: true, invoice: { select: { status: true } } } },
        },
      });
    });

    if (!appointment) {
      throw this.errors.appointmentNotFound(
        appointmentId,
        'AppointmentsService.completeAppointment'
      );
    }
    return appointment;
  }

  /**
   * Who may complete this appointment. Fails closed: an unknown role, a PATIENT, or (for a video
   * visit) anybody who is neither the treating doctor nor a clinic admin is refused.
   */
  private assertCompletionAllowed(
    appointment: CompletionAppointmentRow,
    userId: string,
    role: string
  ): void {
    const context = 'AppointmentsService.completeAppointment';
    const normalizedRole = String(role || '').toUpperCase();

    if (!AppointmentsService.COMPLETION_ROLES.has(normalizedRole)) {
      throw this.errors.insufficientPermissions(context);
    }
    if (!isVideoCallAppointmentType(appointment.type)) {
      return;
    }
    if (AppointmentsService.VIDEO_COMPLETION_ADMIN_ROLES.has(normalizedRole)) {
      return;
    }

    const isTreatingDoctor =
      AppointmentsService.VIDEO_COMPLETION_CLINICIAN_ROLES.has(normalizedRole) &&
      Boolean(userId) &&
      appointment.doctor?.userId === userId;
    if (!isTreatingDoctor) {
      throw this.errors.insufficientPermissions(context);
    }
  }

  private buildAlreadyCompletedResult(appointment: CompletionAppointmentRow): {
    success: true;
    data: Record<string, unknown>;
  } {
    return {
      success: true,
      data: {
        success: true,
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        clinicId: appointment.clinicId,
        completedAt: appointment.completedAt
          ? new Date(appointment.completedAt).toISOString()
          : null,
        alreadyCompleted: true,
      },
    };
  }

  async completeAppointment(
    appointmentId: string,
    completeDto: CompleteAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<unknown> {
    const context = 'AppointmentsService.completeAppointment';

    try {
      // Fresh, clinic-scoped read. Any failure here (including an unexpected database error)
      // stops the completion: there is no fail-open path.
      const appointmentRecord = await this.loadAppointmentForCompletion(appointmentId, clinicId);

      this.assertCompletionAllowed(appointmentRecord, userId, role);

      const currentStatus = String(appointmentRecord.status || '').toUpperCase();

      // Already completed: report success without re-emitting events or re-running side effects.
      if (currentStatus === String(AppointmentStatus.COMPLETED)) {
        return this.buildAlreadyCompletedResult(appointmentRecord);
      }

      // The state contract decides: only IN_PROGRESS -> COMPLETED. CANCELLED, EXPIRED, NO_SHOW,
      // unpaid PENDING and every not-yet-started visit are refused.
      //
      // One exception, mirroring the video end route (VideoService.completeAppointmentOnEnd): a
      // CONFIRMED video visit may be completed directly once its join window has opened. A video
      // visit only reaches IN_PROGRESS through POST /video/consultation/start, and when the doctor
      // runs the call without that hop the status stays CONFIRMED. Refusing here left paid visits
      // to be auto-expired by the scheduler five hours later instead of being completed. The
      // join-window gate keeps a visit booked for later from being completed (and billed) early.
      const isVideoVisit = isVideoCallAppointmentType(appointmentRecord.type);
      const isConfirmedVideoVisit =
        isVideoVisit && currentStatus === String(AppointmentStatus.CONFIRMED);
      const completableConfirmedVideoVisit =
        isConfirmedVideoVisit && this.hasVideoJoinWindowOpened(appointmentRecord);
      if (isConfirmedVideoVisit && !completableConfirmedVideoVisit) {
        throw this.errors.businessRuleViolation(
          'A confirmed video visit can be completed only once its join window has opened.',
          context
        );
      }
      if (
        !completableConfirmedVideoVisit &&
        !isValidAppointmentStatusTransition(currentStatus, String(AppointmentStatus.COMPLETED))
      ) {
        throw this.errors.businessRuleViolation(
          `Only an appointment that is in progress can be completed (this one is ${currentStatus.toLowerCase().replace(/_/g, ' ')}).`,
          context
        );
      }

      if (isVideoVisit) {
        // The same definition of "paid" the video room uses to let the patient in: a visit that
        // is joinable must never be un-completable.
        if (!isAppointmentPaid(appointmentRecord)) {
          throw this.errors.businessRuleViolation(
            'Payment must be completed before a video appointment can be completed.',
            context
          );
        }
      }

      // The doctor on record. completeDto.doctorId is client-supplied and never trusted.
      const finalDoctorId = appointmentRecord.doctorId;

      // Create a copy of completeDto without doctorId to avoid duplication
      const { doctorId: _, ...restDto } = completeDto;

      const completedAt = new Date();
      const completedAtIso = completedAt.toISOString();
      const existingMetadata =
        appointmentRecord.metadata &&
        typeof appointmentRecord.metadata === 'object' &&
        !Array.isArray(appointmentRecord.metadata)
          ? (appointmentRecord.metadata as Record<string, unknown>)
          : {};
      const completionMetadata =
        completeDto.metadata &&
        typeof completeDto.metadata === 'object' &&
        !Array.isArray(completeDto.metadata)
          ? completeDto.metadata
          : {};

      // Claim the completion with a conditional write: it only matches while the row still has
      // the status we validated, and it is clinic-scoped. Two simultaneous completions (or a
      // completion racing a cancellation) cannot both win.
      const claim = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              appointment: {
                updateMany: <T>(args: T) => Promise<{ count: number }>;
              };
            }
          ).appointment.updateMany({
            where: { id: appointmentId, clinicId, status: currentStatus },
            data: {
              status: AppointmentStatus.COMPLETED,
              completedAt,
              updatedAt: completedAt,
              metadata: {
                ...existingMetadata,
                ...completionMetadata,
                consultationOutcome: 'completed',
                consultationCompletedAt: completedAtIso,
                // The authenticated user, not whoever the request body claims to be.
                consultationCompletedBy: userId,
              },
            },
          });
        },
        {
          userId,
          userRole: role,
          clinicId,
          operation: 'UPDATE_APPOINTMENT',
          resourceType: 'APPOINTMENT',
          resourceId: appointmentId,
          timestamp: completedAt,
          details: {
            status: AppointmentStatus.COMPLETED,
            previousStatus: currentStatus,
            completedAt: completedAtIso,
            metadata: completionMetadata,
          },
        }
      );

      if (claim.count === 0) {
        // Lost a race: somebody completed (idempotent) or cancelled / expired it (conflict).
        const latest = await this.loadAppointmentForCompletion(appointmentId, clinicId);
        if (String(latest.status || '').toUpperCase() === String(AppointmentStatus.COMPLETED)) {
          return this.buildAlreadyCompletedResult(latest);
        }
        throw this.errors.appointmentConflict(appointmentId, context);
      }

      // An administrator completing a visit that is not theirs leaves an audit trail.
      if (AppointmentsService.ADMIN_COMPLETION_ROLES.has(String(role || '').toUpperCase())) {
        await this.loggingService.log(
          LogType.AUDIT,
          LogLevel.INFO,
          'Appointment completed by an administrator',
          context,
          {
            actorId: userId,
            actorRole: role,
            appointmentId,
            clinicId,
            previousStatus: currentStatus,
          }
        );
      }

      // Drop the stale cached detail / list entries now, so the reads below (and any concurrent
      // reader) see COMPLETED instead of the pre-completion row.
      try {
        await this.cacheService.invalidateAppointmentCache(
          appointmentId,
          appointmentRecord.patientId,
          appointmentRecord.doctorId,
          clinicId
        );
        this.invalidateBookingUserCache(appointmentRecord.userId);
      } catch (cacheError) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Cache invalidation after appointment completion failed: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
          context,
          { appointmentId, clinicId }
        );
      }

      // Best-effort clinical side effects (EHR persistence). The appointment is already COMPLETED,
      // so a plugin failure degrades to the fallback result instead of failing the request.
      let completionData: unknown;
      try {
        completionData = await this.clinicConfirmationPlugin.process({
          operation: 'markAppointmentCompleted',
          appointmentId,
          doctorId: finalDoctorId,
          clinicId,
          userId: appointmentRecord.userId,
          ...restDto,
        });
      } catch (error) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Clinic confirmation plugin failed during completion; continuing with appointment status update: ${error instanceof Error ? error.message : String(error)}`,
          context,
          {
            appointmentId,
            doctorId: finalDoctorId,
            clinicId,
            error: error instanceof Error ? error.stack : undefined,
          }
        );
        completionData = {
          success: true,
          appointmentId,
          doctorId: finalDoctorId,
          clinicId,
          completedAt: completedAtIso,
          fallback: true,
        };
      }

      const result = { success: true, data: completionData };

      if (result.success) {
        try {
          await this.completeAssociatedVideoSession(
            appointmentId,
            completedAt,
            clinicId,
            userId,
            finalDoctorId,
            role
          );
        } catch (videoSessionError) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to mark linked video consultation as completed: ${videoSessionError instanceof Error ? videoSessionError.message : String(videoSessionError)}`,
            'AppointmentsService.completeAppointment',
            {
              appointmentId,
              clinicId,
              doctorId: finalDoctorId,
              error: videoSessionError instanceof Error ? videoSessionError.stack : undefined,
            }
          );
        }

        // Log the completion event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Appointment completed successfully',
          'AppointmentsService',
          { appointmentId, userId, clinicId }
        );

        // Keep the doctor queue in sync with appointment lifecycle.
        // On completion, remove the current patient from the live queue and
        // advance the next waiting patient automatically when one exists.
        try {
          // Video visits never enter the live queue, so there is nothing to remove for them.
          if (!isVideoCallAppointmentType(appointmentRecord.type)) {
            await this.appointmentQueueService.removePatientFromQueue(
              appointmentId,
              finalDoctorId,
              clinicId,
              'clinic'
            );
          }
          // Removed automatic callNext since callNext now requires explicit appointmentId
          // to advance a specific patient. await this.appointmentQueueService.callNext(finalDoctorId, clinicId, 'clinic');
          // The doctor will manually click Call Next from the queue UI instead of it
          // implicitly pulling the next patient off the queue.
        } catch (queueError) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Queue progression after appointment completion failed: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
            'AppointmentsService.completeAppointment',
            {
              appointmentId,
              doctorId: finalDoctorId,
              clinicId,
              error: queueError instanceof Error ? queueError.stack : undefined,
            }
          );
        }

        // Create follow-up plan if requested. The web "complete visit" form sends the clinician's
        // text as `followUpNotes`; it is the plan's instructions when `followUpInstructions` is absent.
        const followUpInstructions =
          completeDto.followUpInstructions?.trim() || completeDto.followUpNotes?.trim() || '';
        if (completeDto.followUpRequired && completeDto.followUpType && followUpInstructions) {
          try {
            // Get appointment details to extract patientId
            const appointment = (await this.getAppointmentById(
              appointmentId,
              clinicId
            )) as AppointmentWithRelations;

            if (appointment && appointment.patientId) {
              // Calculate days after from followUpDate or use default
              let daysAfter = 7; // Default 7 days
              if (completeDto.followUpDate) {
                const followUpDate = new Date(completeDto.followUpDate);
                const appointmentDate = new Date(appointment.date);
                const diffTime = followUpDate.getTime() - appointmentDate.getTime();
                daysAfter = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              }

              // Create follow-up plan
              const followUpPlanResult = await this.createFollowUpPlan(
                appointmentId,
                appointment.patientId,
                finalDoctorId,
                clinicId,
                completeDto.followUpType,
                daysAfter,
                followUpInstructions,
                completeDto.followUpPriority || 'normal',
                completeDto.medications,
                completeDto.tests,
                completeDto.restrictions,
                completeDto.notes,
                userId // Pass authenticated user ID for permission check
              );

              await this.loggingService.log(
                LogType.BUSINESS,
                LogLevel.INFO,
                'Follow-up plan created during appointment completion',
                'AppointmentsService.completeAppointment',
                { appointmentId, followUpType: completeDto.followUpType, daysAfter }
              );

              // AUTO-SCHEDULING: If followUpDate is provided, automatically create the follow-up appointment
              // This implements the documented flow where completing with followUpDate auto-creates appointment
              if (
                completeDto.followUpDate &&
                followUpPlanResult &&
                (followUpPlanResult as { success?: boolean })?.success
              ) {
                try {
                  const followUpPlanId = (followUpPlanResult as { followUpId?: string })
                    ?.followUpId;

                  if (followUpPlanId) {
                    // Auto-create follow-up appointment
                    // Convert date and time to appointmentDate format
                    const followUpDate = new Date(completeDto.followUpDate);
                    const appointmentTime = appointment.time || '10:00';
                    const [hours, minutes] = appointmentTime.split(':');
                    followUpDate.setHours(
                      parseInt(hours || '10', 10),
                      parseInt(minutes || '0', 10),
                      0,
                      0
                    );

                    const followUpAppointment = await this.createAppointment(
                      {
                        patientId: appointment.patientId,
                        doctorId: finalDoctorId,
                        clinicId,
                        appointmentDate: followUpDate.toISOString(),
                        duration: appointment.duration || 30,
                        type: appointment.type || AppointmentType.IN_PERSON,
                        treatmentType: TreatmentType.FOLLOW_UP,
                        priority: completeDto.followUpPriority || AppointmentPriority.NORMAL,
                        notes: followUpInstructions,
                        ...(appointment.locationId && { locationId: appointment.locationId }),
                      } as CreateAppointmentDto,
                      userId,
                      clinicId,
                      'USER'
                    );

                    // Link appointment to follow-up plan
                    if (followUpAppointment.success) {
                      const followUpAppointmentId = (
                        followUpAppointment.data as Record<string, unknown>
                      )?.['id'] as string;

                      // Update follow-up plan to link the appointment
                      await this.clinicFollowUpPlugin.process({
                        operation: 'updateFollowUpStatus',
                        followUpId: followUpPlanId,
                        status: 'completed',
                        followUpAppointmentId,
                      });

                      // Update appointment to mark as follow-up and link to parent
                      await this.databaseService.executeHealthcareWrite(
                        async client => {
                          return await (
                            client as unknown as {
                              appointment: {
                                update: <T>(args: T) => Promise<unknown>;
                              };
                            }
                          ).appointment.update({
                            where: { id: followUpAppointmentId },
                            data: {
                              parentAppointmentId: appointmentId,
                              isFollowUp: true,
                              followUpReason: followUpInstructions,
                              originalAppointmentId: appointmentId,
                              status: AppointmentStatus.SCHEDULED,
                            },
                          });
                        },
                        {
                          userId,
                          userRole: 'USER',
                          clinicId,
                          operation: 'UPDATE_APPOINTMENT',
                          resourceType: 'APPOINTMENT',
                          resourceId: followUpAppointmentId,
                          timestamp: new Date(),
                        }
                      );

                      await this.loggingService.log(
                        LogType.BUSINESS,
                        LogLevel.INFO,
                        'Follow-up appointment auto-created and linked to plan',
                        'AppointmentsService.completeAppointment',
                        {
                          appointmentId,
                          followUpPlanId,
                          followUpAppointmentId,
                          followUpDate: completeDto.followUpDate,
                        }
                      );
                    }
                  }
                } catch (autoScheduleError) {
                  // Log error but don't fail the completion
                  await this.loggingService.log(
                    LogType.ERROR,
                    LogLevel.WARN,
                    `Failed to auto-schedule follow-up appointment: ${autoScheduleError instanceof Error ? autoScheduleError.message : String(autoScheduleError)}`,
                    'AppointmentsService.completeAppointment',
                    {
                      appointmentId,
                      followUpDate: completeDto.followUpDate,
                      error:
                        autoScheduleError instanceof Error ? autoScheduleError.stack : undefined,
                    }
                  );
                }
              }
            }
          } catch (followUpError) {
            // Log error but don't fail the completion
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.WARN,
              `Failed to create follow-up plan during completion: ${followUpError instanceof Error ? followUpError.message : String(followUpError)}`,
              'AppointmentsService.completeAppointment',
              {
                appointmentId,
                error: followUpError instanceof Error ? followUpError.stack : undefined,
              }
            );
          }
        }

        // Emit enterprise event for real-time WebSocket broadcasting
        const appointment = (await this.getAppointmentById(
          appointmentId,
          clinicId
        )) as AppointmentWithRelations | null;
        await this.emitAppointmentEnterpriseEvent('appointment.completed', {
          eventId: `appointment-completed-${appointmentId}-${Date.now()}`,
          clinicId,
          userId: appointment?.patientId || userId,
          payload: {
            appointmentId,
            clinicId,
            completedBy: userId,
            completionData: completeDto,
            status: 'COMPLETED',
            patientId: appointment?.patientId,
            doctorId: appointment?.doctorId,
            appointment,
          },
        });

        await this.eventService.emit('appointment.completed', {
          appointmentId,
          clinicId,
          status: 'COMPLETED',
          patientId: appointment?.patientId,
          doctorId: appointment?.doctorId,
          appointment,
        });
      }
      return result;
    } catch (_error) {
      if (_error instanceof HealthcareError || _error instanceof HttpException) {
        throw _error;
      }
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to complete appointment through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.completeAppointment',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.appointmentNotFound(
          appointmentId,
          'AppointmentsService.completeAppointment'
        );
      }
      throw this.errors.databaseError(
        'completeAppointment',
        'AppointmentsService.completeAppointment'
      );
    }
  }

  async bulkCompleteSelectedAppointments(
    filters: { clinicId: string; doctorId?: string },
    bulkDto: BulkCompleteAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<{ success: boolean; data?: { completed: number; failed: number } }> {
    try {
      const appointmentIds = Array.isArray(bulkDto.appointmentIds)
        ? bulkDto.appointmentIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
        : [];

      if (appointmentIds.length === 0) {
        return { success: true, data: { completed: 0, failed: 0 } };
      }

      let completed = 0;
      let failed = 0;

      const completionPayload: CompleteAppointmentDto = {
        ...(bulkDto.doctorId && { doctorId: bulkDto.doctorId }),
        ...(bulkDto.notes && { notes: bulkDto.notes }),
        ...(bulkDto.metadata && { metadata: bulkDto.metadata }),
      };

      for (const appointmentId of appointmentIds) {
        try {
          await this.completeAppointment(appointmentId, completionPayload, userId, clinicId, role);
          completed += 1;
        } catch (error) {
          failed += 1;
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Bulk complete failed for appointment ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
            'AppointmentsService.bulkCompleteSelectedAppointments',
            {
              appointmentId,
              clinicId,
              doctorId: filters.doctorId || userId,
              error: error instanceof Error ? error.stack : undefined,
            }
          );
        }
      }

      return { success: true, data: { completed, failed } };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Bulk complete selected appointments failed: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentsService.bulkCompleteSelectedAppointments',
        {
          clinicId,
          doctorId: filters.doctorId || userId,
          count: bulkDto.appointmentIds?.length,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw this.errors.databaseError(
        'bulkCompleteSelectedAppointments',
        'AppointmentsService.bulkCompleteSelectedAppointments'
      );
    }
  }

  async completeAssociatedVideoSession(
    appointmentId: string,
    completedAt: Date,
    clinicId: string,
    userId: string,
    doctorId: string,
    role: string
  ): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const delegate = getVideoConsultationDelegate(client);
        const consultation = await delegate.findFirst({
          where: { OR: [{ appointmentId }] },
        });

        if (!consultation) {
          return;
        }

        const startTime = consultation.startTime ? new Date(consultation.startTime) : null;
        const duration =
          startTime instanceof Date && !Number.isNaN(startTime.getTime())
            ? Math.max(0, Math.floor((completedAt.getTime() - startTime.getTime()) / 1000))
            : (consultation.duration ?? null);

        await delegate.update({
          where: { id: consultation.id },
          data: {
            status: 'COMPLETED',
            endTime: completedAt,
            ...(duration !== null ? { duration } : {}),
          },
        });
      },
      {
        userId,
        userRole: String(role || 'DOCTOR').toUpperCase(),
        clinicId,
        operation: 'UPDATE_VIDEO_CONSULTATION',
        resourceType: 'VIDEO_CONSULTATION',
        resourceId: appointmentId,
        timestamp: completedAt,
        details: {
          doctorId,
          status: 'COMPLETED',
        },
      }
    );

    await this.cacheService.del(`video_session:${appointmentId}`);
  }

  /**
   * Start consultation through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   */
  async startConsultation(
    appointmentId: string,
    startDto: StartConsultationDto,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<unknown> {
    // Only clinic staff and doctors start a consultation. A patient (or an unknown role) never
    // starts their own, whatever route led here. Checked before the try block: its catch has a
    // fallback path for failures that mention "startConsultation", which a refusal must never take.
    if (!isAppointmentStaffRole(role)) {
      throw this.errors.insufficientPermissions('AppointmentsService.startConsultation');
    }

    try {
      // Hot path: Direct plugin injection for performance
      const consultationPayload = {
        operation: 'startConsultation',
        appointmentId,
        clinicId,
        ...startDto,
      };
      const consultationProcessor =
        this.clinicCheckInPlugin &&
        typeof this.clinicCheckInPlugin.process === 'function' &&
        this.clinicCheckInPlugin.process.bind(this.clinicCheckInPlugin);

      const consultationData = consultationProcessor
        ? await consultationProcessor(consultationPayload)
        : await this.checkInService.startConsultation(appointmentId, clinicId);

      const result = { success: true, data: consultationData };

      if (result.success) {
        const startedAt = nowIso();
        const appointmentSnapshot = {
          id: appointmentId,
          appointmentId,
          clinicId,
          doctorId: startDto.doctorId,
          status: 'IN_PROGRESS',
          startedAt,
          updatedAt: startedAt,
          consultationType: startDto.consultationType,
          notes: startDto.notes,
          consultationData,
        };

        // Log the consultation start event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Consultation started successfully',
          'AppointmentsService',
          { appointmentId, userId, clinicId }
        );

        // Emit event for real-time broadcasting
        await this.emitAppointmentEnterpriseEvent('appointment.consultation_started', {
          eventId: `appointment-consultation-started-${appointmentId}-${Date.now()}`,
          clinicId,
          userId,
          payload: appointmentSnapshot,
          metadata: {
            appointmentId,
            doctorId: startDto.doctorId,
            startedAt,
            source: 'AppointmentsService.startConsultation',
          },
          source: 'AppointmentsService',
          priority: EventPriority.HIGH,
        });
      }
      return result;
    } catch (_error) {
      if (
        _error instanceof Error &&
        _error.message.includes('startConsultation') &&
        typeof this.checkInService?.startConsultation === 'function'
      ) {
        const consultationData = await this.checkInService.startConsultation(
          appointmentId,
          clinicId
        );
        const result = { success: true, data: consultationData };
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Consultation started successfully via direct check-in service fallback',
          'AppointmentsService',
          { appointmentId, userId, clinicId }
        );
        await this.emitAppointmentEnterpriseEvent('appointment.consultation_started', {
          eventId: `appointment-consultation-started-${appointmentId}-${Date.now()}`,
          clinicId,
          userId,
          payload: {
            id: appointmentId,
            appointmentId,
            clinicId,
            doctorId: startDto.doctorId,
            status: 'IN_PROGRESS',
            startedAt: nowIso(),
            consultationData: consultationData as Record<string, unknown>,
          },
          metadata: {
            appointmentId,
            doctorId: startDto.doctorId,
            source: 'AppointmentsService.startConsultation.fallback',
          },
          source: 'AppointmentsService',
          priority: EventPriority.HIGH,
        });
        return result;
      }
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to start consultation through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.startConsultation',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.appointmentNotFound(
          appointmentId,
          'AppointmentsService.startConsultation'
        );
      }
      throw this.errors.databaseError('startConsultation', 'AppointmentsService.startConsultation');
    }
  }

  /**
   * Get queue information through plugins
   *
   * Performance: Uses direct service call for hot-path optimization (10M+ users scale)
   * Queue operations are extremely frequent in high-traffic scenarios
   */
  async getQueueInfo(
    doctorId: string,
    date: string,
    clinicId: string,
    userId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Hot path: Direct service call for performance (very frequent operation)
      const queueData = await this.appointmentQueueService.getDoctorQueue(
        doctorId,
        clinicId,
        date,
        'clinic'
      );

      const result = { success: true, data: queueData };

      if (result.success) {
        // Log the queue info retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Queue information retrieved successfully',
          'AppointmentsService',
          { doctorId, date, userId, clinicId }
        );
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get queue info through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.getQueueInfo',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.recordNotFound('queue', 'AppointmentsService.getQueueInfo');
      }
      throw this.errors.databaseError('getQueueInfo', 'AppointmentsService.getQueueInfo');
    }
  }

  /**
   * Get location information through plugins
   *
   * Performance: Uses direct plugin injection for medium-frequency operations
   */
  async getLocationInfo(
    locationId: string,
    clinicId: string,
    userId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Medium frequency: Direct plugin injection for performance
      const locationData = await this.clinicLocationPlugin.process({
        operation: 'getLocationInfo',
        locationId,
        clinicId,
      });

      const result = { success: true, data: locationData };

      if (result.success) {
        // Log the location info retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Location information retrieved successfully',
          'AppointmentsService',
          { locationId, userId, clinicId }
        );
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get location info through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.getLocationInfo',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.clinicNotFound(locationId, 'AppointmentsService.getLocationInfo');
      }
      throw this.errors.databaseError('getLocationInfo', 'AppointmentsService.getLocationInfo');
    }
  }

  // =============================================
  // MISSING METHODS (for controller compatibility)
  // =============================================

  /**
   * Get appointment by ID
   */
  async getAppointmentById(id: string, clinicId: string): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    const cacheKey = this.cacheService.getKeyFactory().appointment(id, 'detail');

    const cachedAppointment = await this.cacheService.cache(
      cacheKey,
      async () => {
        // Use DatabaseService safe method first, fallback to executeHealthcareRead for complex queries
        // Try using findAppointmentByIdSafe first
        const appointment = await this.databaseService.findAppointmentByIdSafe(id);

        // If appointment found and matches clinic, return it
        if (appointment && appointment.clinicId === clinicId) {
          return appointment;
        }

        // For complex queries with relations, use executeHealthcareRead with client parameter
        const appointmentWithRelations = (await this.databaseService.executeHealthcareRead(
          async client => {
            const appointment = client['appointment'] as unknown as {
              findFirst: (args: {
                where: { id: string; clinicId: string };
                include: {
                  patient: { include: { user: true } };
                  doctor: { include: { user: true } };
                  clinic: boolean;
                  location: boolean;
                };
              }) => Promise<AppointmentWithRelations | null>;
            };
            return (await appointment.findFirst({
              where: {
                id,
                clinicId,
              },
              include: {
                patient: {
                  include: {
                    user: true,
                  },
                },
                doctor: {
                  include: {
                    user: true,
                  },
                },
                clinic: true,
                location: true,
              },
            })) as unknown as AppointmentWithRelations | null;
          }
        )) as unknown as AppointmentWithRelations | null;

        if (!appointmentWithRelations) {
          throw this.errors.appointmentNotFound(id, 'AppointmentsService.getAppointmentById');
        }

        return appointmentWithRelations;
      },
      {
        ttl: 1800,
        tags: ['appointments', 'appointment_details', `appointment:${id}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
      }
    );

    // The cache key above has no clinic in it, so a cache hit skips the clinic check that lives
    // inside the loader and would hand clinic A's appointment to a clinic B caller. Re-assert the
    // clinic on whatever came back, for every caller. The answer is a plain not-found so another
    // clinic's appointment is never confirmed to exist.
    const cachedClinicId =
      cachedAppointment && typeof cachedAppointment === 'object'
        ? (cachedAppointment as { clinicId?: unknown }).clinicId
        : undefined;
    if (!cachedAppointment || cachedClinicId !== clinicId) {
      throw this.errors.appointmentNotFound(id, 'AppointmentsService.getAppointmentById');
    }

    return cachedAppointment;
  }

  /**
   * Get patient by user ID
   */
  async getPatientByUserId(userId: string): Promise<unknown> {
    // Direct DB lookup. Patient-to-user mapping must always be fresh.
    // A 1-hour stale cache caused null returns for newly created patient profiles.
    const patient = await this.databaseService.executeHealthcareRead(async client => {
      const patientDelegate = client['patient'] as unknown as {
        findFirst: (args: {
          where: { OR: Array<{ userId: string } | { id: string }> };
          include: { user: boolean };
        }) => Promise<unknown>;
      };
      return await patientDelegate.findFirst({
        where: {
          OR: [{ userId }, { id: userId }],
        },
        include: {
          user: true,
        },
      });
    });

    return patient;
  }

  /**
   * Resolve the patient profile for appointment reads.
   *
   * This falls back to a direct database lookup if the cached mapping is stale
   * or has been hydrated as null earlier in the request lifecycle.
   */
  private async resolvePatientProfileForAppointments(
    userId: string
  ): Promise<{ id?: string } | null> {
    // getPatientByUserId is now cache-free; direct DB query.
    const patient = (await this.getPatientByUserId(userId)) as { id?: string } | null;
    if (patient?.id) {
      return patient;
    }

    // Self-heal: If the Patient record is missing, create it inline then re-fetch it.
    // This handles users who registered before the patient-profile creation was reliable.
    // Keep this direct to avoid introducing a circular PatientsService dependency here.
    try {
      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.WARN,
        `[resolvePatientProfile] No Patient record for userId=${userId}. Attempting auto-create.`,
        'AppointmentsService',
        { userId }
      );
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            patient: {
              upsert: (args: {
                where: { userId: string };
                update: Record<string, never>;
                create: { userId: string };
              }) => Promise<unknown>;
            };
          };
          return await typedClient.patient.upsert({
            where: { userId },
            update: {},
            create: { userId },
          });
        },
        {
          userId,
          clinicId: '',
          resourceType: 'PATIENT',
          operation: 'CREATE',
          resourceId: 'auto',
          userRole: 'system',
          details: { action: 'self_heal_patient_profile' },
        }
      );
      await Promise.all([
        this.cacheService.invalidatePatientCache(userId),
        this.cacheService.invalidateCacheByTag(`user:${userId}`),
        this.cacheService.invalidateCacheByTag('user_details'),
      ]);
      // Re-fetch the newly created patient
      const freshPatient = (await this.getPatientByUserId(userId)) as { id?: string } | null;
      if (freshPatient?.id) {
        return freshPatient;
      }
    } catch (autoCreateErr) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `[resolvePatientProfile] Auto-create failed for userId=${userId}`,
        'AppointmentsService',
        {
          userId,
          error: autoCreateErr instanceof Error ? autoCreateErr.message : String(autoCreateErr),
        }
      );
    }

    return null;
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  /**
   * Get plugin information
   */
  getPluginInfo(): unknown {
    return this.pluginRegistry.getPluginInfo();
  }

  /**
   * Get domain features
   */
  getDomainFeatures(domain: string): string[] {
    return this.pluginRegistry.getDomainFeatures(domain);
  }

  /**
   * Execute plugin operation (Registry-based)
   *
   * Use this for:
   * - Less frequent plugins (analytics, reminders, video, etc.)
   * - Cross-service plugin discovery
   * - Dynamic plugin loading
   * - Feature flags and conditional plugins
   *
   * For hot-path plugins, use direct injection instead for better performance.
   */
  async executePluginOperation(
    domain: string,
    feature: string,
    operation: string,
    data: unknown,
    context?: PluginContext
  ): Promise<unknown> {
    return this.pluginManager.executePluginOperation(domain, feature, operation, data, context);
  }

  /**
   * Check if plugin exists
   */
  hasPlugin(domain: string, feature: string): boolean {
    return this.pluginRegistry.hasPlugin(domain, feature);
  }

  /**
   * Get doctor availability (enhanced version)
   */
  async getDoctorAvailability(
    doctorId: string,
    date: string,
    clinicId: string,
    userId: string,
    locationId?: string,
    _role: string = 'USER',
    appointmentType?: string
  ): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    const keyFactory = this.cacheService.getKeyFactory();
    // Key factory automatically adds 'healthcare' prefix
    const cacheKey = keyFactory.fromTemplate(
      'doctor:{doctorId}:clinic:{clinicId}:location:{locationId}:availability:{date}:type:{appointmentType}',
      {
        doctorId,
        clinicId,
        locationId: locationId || 'all',
        date,
        appointmentType: appointmentType || 'all',
      }
    );

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use core service directly for availability (not a queue operation)
        // The ClinicQueuePlugin is for queue management operations only
        const availabilityData = await this.coreAppointmentService.getDoctorAvailability(
          doctorId,
          date,
          {
            userId,
            role: _role as Role,
            clinicId,
            ...(locationId && { locationId }),
            ...(appointmentType && { appointmentType }),
          }
        );

        // Log the availability retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Doctor availability retrieved successfully',
          'AppointmentsService',
          { doctorId, date, userId, clinicId }
        );

        return { success: true, data: availabilityData };
      },
      {
        ttl: 10,
        tags: ['appointments', 'doctor_availability', `doctor:${doctorId}`],
        priority: 'high',
        enableSwr: false,
        containsPHI: false,
        compress: false,
      }
    );
  }

  // - getDoctorAvailability() instead of getDoctorAvailabilityLegacy()

  /**
   * Get user upcoming appointments (enhanced version)
   */
  async getUserUpcomingAppointments(
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<unknown> {
    const resolveAppointmentIdentifier = (appointment: unknown): string => {
      if (!appointment || typeof appointment !== 'object') {
        return '';
      }

      const record = appointment as Record<string, unknown>;
      const candidateId = record['appointmentId'] ?? record['id'];
      if (typeof candidateId === 'string') {
        return candidateId;
      }
      if (
        typeof candidateId === 'number' ||
        typeof candidateId === 'bigint' ||
        typeof candidateId === 'boolean'
      ) {
        return String(candidateId);
      }
      return '';
    };

    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    // Use patient-specific caching for better healthcare optimization
    const cacheKey = this.cacheService
      .getKeyFactory()
      .patient(userId, clinicId, 'upcoming_appointments');

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const patient =
          role === 'PATIENT' ? await this.resolvePatientProfileForAppointments(userId) : null;
        const candidateIds = Array.from(
          new Set([patient?.id, userId].filter((value): value is string => Boolean(value)))
        );

        const combinedAppointments: unknown[] = [];
        for (const candidateId of candidateIds) {
          const filters: AppointmentFilterDto & { statusList?: AppointmentStatus[] } = {
            patientId: candidateId,
            startDate: formatDateKeyInIST(new Date()),
            // Keep both states visible here:
            // - SCHEDULED for the booking-created row
            // - CONFIRMED once payment/webhook reconciliation completes
            statusList: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          };

          const result = await this.getAppointments(filters, userId, clinicId, role, 1, 10);
          const resultData = Array.isArray((result as { data?: unknown }).data)
            ? ((result as { data?: unknown }).data as unknown[])
            : Array.isArray((result as { appointments?: unknown[] }).appointments)
              ? ((result as { appointments?: unknown[] }).appointments as unknown[])
              : [];

          for (const appointment of resultData) {
            const appointmentId = resolveAppointmentIdentifier(appointment);
            if (
              appointmentId &&
              !combinedAppointments.some(
                existing => resolveAppointmentIdentifier(existing) === appointmentId
              )
            ) {
              combinedAppointments.push(appointment);
            }
          }
        }

        return {
          success: true,
          data: {
            appointments: combinedAppointments,
          },
          appointments: combinedAppointments,
          meta: {
            count: combinedAppointments.length,
          },
        };
      },
      {
        ttl: 600,
        tags: ['appointments', 'upcoming_appointments', `user:${userId}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
      }
    );
  }

  // - getUserUpcomingAppointments() instead of getUserUpcomingAppointmentsLegacy()

  /**
   * True when the appointment is a VIDEO visit that belongs to the (patient) caller or one of
   * their dependents. Lets clinic check-in answer "video visits do not use check-in" only to
   * the owner instead of revealing another patient's appointment type.
   */
  async isOwnedVideoAppointment(
    appointmentId: string,
    clinicId: string,
    userId: string
  ): Promise<boolean> {
    try {
      const appointment = (await this.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      return (
        isVideoCallAppointmentType(appointment.type) &&
        (await isAppointmentOwnedByPatientUser(this.databaseService, appointment, userId))
      );
    } catch (error) {
      if (error instanceof HealthcareError || error instanceof HttpException) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Find the in-person appointments for a user at a specific location
   * Used for QR code check-in functionality
   */
  async findUserAppointmentsByLocation(
    userId: string,
    locationId: string,
    clinicId: string
  ): Promise<AppointmentWithRelations[]> {
    const startTime = Date.now();

    try {
      // Get today's date and filter for today or future appointments
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find appointments that match:
      // - User's patient ID
      // - Location ID
      // - Status: CONFIRMED or SCHEDULED
      // - Date: today or future
      // - Arrival not already confirmed
      // Note: We need to query twice (once for each status) since AppointmentFilterDto only supports single status
      const context: AppointmentContext = {
        userId,
        role: 'PATIENT',
        clinicId,
        locationId,
      };
      const patient = await this.resolvePatientProfileForAppointments(userId);
      const patientIdentifiers = Array.from(
        new Set([userId, patient?.id].filter((value): value is string => Boolean(value)))
      );

      const allAppointments: AppointmentWithRelations[] = [];

      for (const patientId of patientIdentifiers) {
        const confirmedFilters: AppointmentFilterDto = {
          patientId,
          locationId,
          clinicId,
          startDate: today.toISOString(),
          status: AppointmentStatus.CONFIRMED,
        };

        const confirmedResult = await this.coreAppointmentService.getAppointments(
          confirmedFilters,
          context,
          1,
          10
        );

        if (confirmedResult.success && confirmedResult.data) {
          const confirmedAppointments = (
            confirmedResult.data as { appointments: AppointmentWithRelations[] }
          ).appointments;
          allAppointments.push(...confirmedAppointments);
        }

        const scheduledFilters: AppointmentFilterDto = {
          patientId,
          locationId,
          clinicId,
          startDate: today.toISOString(),
          status: AppointmentStatus.SCHEDULED,
        };

        const scheduledResult = await this.coreAppointmentService.getAppointments(
          scheduledFilters,
          context,
          1,
          10
        );

        if (scheduledResult.success && scheduledResult.data) {
          const scheduledAppointments = (
            scheduledResult.data as { appointments: AppointmentWithRelations[] }
          ).appointments;
          allAppointments.push(...scheduledAppointments);
        }
      }

      // Keep already-confirmed appointments so the controller can return queue-status
      // responses on re-scan; only exclude past appointments here. Video visits are paid and
      // joined online and never take part in clinic check-in, so scanning the clinic QR must
      // never match them (a patient with a video visit today is not confirmed by a scan).
      const validAppointments = allAppointments.filter(
        apt => new Date(apt.date) >= today && !isVideoCallAppointmentType(apt.type)
      );

      // Remove duplicates (in case same appointment appears in both queries)
      const uniqueAppointments = validAppointments.filter(
        (apt, index, self) => index === self.findIndex(a => a.id === apt.id)
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Found user appointments by location',
        'AppointmentsService.findUserAppointmentsByLocation',
        {
          userId,
          locationId,
          clinicId,
          found: uniqueAppointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return uniqueAppointments;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to find user appointments by location: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.findUserAppointmentsByLocation',
        {
          userId,
          locationId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // =============================================
  // FOLLOW-UP APPOINTMENT OPERATIONS
  // =============================================

  /**
   * Create a follow-up plan for an appointment
   * Used when completing an appointment to schedule future care
   */
  async createFollowUpPlan(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string,
    followUpType: string,
    daysAfter: number,
    instructions: string,
    priority: string = 'normal',
    medications?: string[],
    tests?: string[],
    restrictions?: string[],
    notes?: string,
    authenticatedUserId?: string // Add authenticated user ID parameter
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to create follow-up plans
      // Use authenticated user ID, not doctorId (doctorId is the appointment's doctor, not the user creating the plan)
      const userIdForPermissionCheck = authenticatedUserId || doctorId;
      const permissionCheck = await this.rbacService.checkPermission({
        userId: userIdForPermissionCheck,
        clinicId,
        resource: 'appointments',
        action: 'update', // Follow-up plans are created as part of appointment updates
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.createFollowUpPlan');
      }

      // Use plugin for follow-up plan creation
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'createFollowUpPlan',
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType,
        daysAfter,
        instructions,
        priority,
        medications,
        tests,
        restrictions,
        notes,
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan created successfully',
        'AppointmentsService.createFollowUpPlan',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          followUpType,
          daysAfter,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.plan.created', {
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType,
        daysAfter,
        followUpPlan: result,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.createFollowUpPlan',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get all follow-up plans for a patient
   */
  async getPatientFollowUpPlans(
    patientId: string,
    clinicId: string,
    status?: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view follow-up plans
      const permissionCheck = await this.rbacService.checkPermission({
        userId: patientId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getPatientFollowUpPlans');
      }

      // Use plugin to get follow-up plans with pagination support
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'getPatientFollowUps',
        patientId,
        clinicId,
        status,
        offset: undefined, // Can be extended to support pagination params
        limit: 20, // Default limit
        includeCompleted: true,
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved patient follow-up plans',
        'AppointmentsService.getPatientFollowUpPlans',
        {
          patientId,
          clinicId,
          status,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient follow-up plans: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getPatientFollowUpPlans',
        {
          patientId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Schedule an appointment from a follow-up plan
   */
  async scheduleFollowUpFromPlan(
    followUpPlanId: string,
    scheduleDto: {
      appointmentDate: string;
      doctorId: string;
      locationId?: string;
      time?: string;
    },
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to schedule appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'create',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.scheduleFollowUpFromPlan');
      }

      // Get follow-up plan details first
      const followUpPlans = (await this.clinicFollowUpPlugin.process({
        operation: 'getPatientFollowUps',
        patientId: userId,
        clinicId,
      })) as { followUps: Array<{ id: string; [key: string]: unknown }> };

      const followUpPlan = followUpPlans.followUps?.find(
        (plan: { id: string }) => plan.id === followUpPlanId
      );

      if (!followUpPlan) {
        throw this.errors.notFound(
          'Follow-up plan',
          followUpPlanId,
          'AppointmentsService.scheduleFollowUpFromPlan'
        );
      }

      // Get original appointment to extract details
      const followUpPlanAppointmentId = followUpPlan['appointmentId'] as string | undefined;
      if (!followUpPlanAppointmentId) {
        throw this.errors.notFound(
          'Follow-up plan',
          followUpPlanId,
          'AppointmentsService.scheduleFollowUpFromPlan'
        );
      }
      const originalAppointment = (await this.getAppointmentById(
        followUpPlanAppointmentId,
        clinicId
      )) as AppointmentWithRelations;

      if (!originalAppointment) {
        throw this.errors.appointmentNotFound(
          followUpPlanAppointmentId,
          'AppointmentsService.scheduleFollowUpFromPlan'
        );
      }

      // Create appointment from follow-up plan
      // scheduleDto.appointmentDate is already in ISO format, use it directly
      const appointmentData: CreateAppointmentDto = {
        patientId: followUpPlan['patientId'] as string,
        doctorId: scheduleDto.doctorId,
        clinicId,
        appointmentDate: scheduleDto.appointmentDate,
        duration: originalAppointment.duration || 30,
        type: (followUpPlan['followUpType'] as AppointmentType) || AppointmentType.IN_PERSON,
        treatmentType: TreatmentType.FOLLOW_UP,
        notes: followUpPlan['instructions'] as string,
        priority: (followUpPlan['priority'] as AppointmentPriority) || AppointmentPriority.NORMAL,
      };

      const appointmentResult = await this.createAppointment(
        appointmentData,
        userId,
        clinicId,
        'USER'
      );

      // Update follow-up plan status to 'scheduled'
      await this.clinicFollowUpPlugin.process({
        operation: 'updateFollowUpStatus',
        followUpPlanId,
        status: 'scheduled',
        followUpAppointmentId: (appointmentResult.data as Record<string, unknown>)?.[
          'id'
        ] as string,
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up appointment scheduled from plan',
        'AppointmentsService.scheduleFollowUpFromPlan',
        {
          followUpPlanId,
          appointmentId: (appointmentResult.data as Record<string, unknown>)?.['id'] as string,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.scheduled', {
        followUpPlanId,
        appointmentId: (appointmentResult.data as Record<string, unknown>)?.['id'] as string,
        userId,
        clinicId,
        appointment: appointmentResult.data,
      });

      return appointmentResult;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to schedule follow-up from plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.scheduleFollowUpFromPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get the full appointment chain (original appointment + all follow-ups)
   */
  async getAppointmentChain(
    appointmentId: string,
    clinicId: string,
    userId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getAppointmentChain');
      }

      // OPTIMIZED: Single query with eager loading to eliminate N+1 problem (10M+ users scale)
      // Uses indexed field @@index([parentAppointmentId]) for efficient query
      // Eager loads parent appointment and all follow-ups with their plans in ONE query
      const appointmentChain = (await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            appointment: {
              findUnique: <T>(args: T) => Promise<unknown>;
            };
          }
        ).appointment.findUnique({
          where: { id: appointmentId, clinicId },
          include: {
            // Eager load parent appointment (if exists)
            parentAppointment: {
              select: {
                id: true,
                date: true,
                status: true,
                type: true,
                doctor: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
                patient: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
            // Eager load all follow-ups with their plans (eliminates N+1)
            followUpAppointments: {
              include: {
                followUpPlan: true,
                doctor: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
                patient: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: { date: 'asc' }, // Order by date for chronological order
            },
            // Include follow-up plan if this appointment has one
            followUpPlan: true,
          },
        });
      })) as
        | (AppointmentWithRelations & {
            followUpAppointments?: AppointmentWithRelations[];
            parentAppointment?: AppointmentWithRelations;
          })
        | null;

      if (!appointmentChain) {
        throw this.errors.appointmentNotFound(
          appointmentId,
          'AppointmentsService.getAppointmentChain'
        );
      }

      const originalAppointment = appointmentChain;
      const followUpAppointments = appointmentChain.followUpAppointments || [];

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved appointment chain',
        'AppointmentsService.getAppointmentChain',
        {
          appointmentId,
          clinicId,
          followUpCount: followUpAppointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        original: originalAppointment,
        followUps: followUpAppointments,
        totalAppointments: 1 + followUpAppointments.length,
        completed: followUpAppointments.filter(
          (apt: { status?: string }) => String(apt.status) === String(AppointmentStatus.COMPLETED)
        ).length,
        pending: followUpAppointments.filter(
          (apt: { status?: string }) => String(apt.status) !== String(AppointmentStatus.COMPLETED)
        ).length,
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment chain: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getAppointmentChain',
        {
          appointmentId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get all follow-up appointments for a specific appointment
   */
  async getAppointmentFollowUps(
    appointmentId: string,
    clinicId: string,
    userId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getAppointmentFollowUps');
      }

      // Get all follow-up appointments (appointments with parentAppointmentId = appointmentId)
      // Uses indexed field @@index([parentAppointmentId]) for efficient query (10M+ users scale)
      const followUpAppointments = await this.databaseService.findAppointmentsSafe(
        {
          clinicId,
          parentAppointmentId: appointmentId,
        },
        {
          orderBy: { date: 'asc' }, // Order by date for chronological order (uses indexed date field)
        }
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved appointment follow-ups',
        'AppointmentsService.getAppointmentFollowUps',
        {
          appointmentId,
          clinicId,
          followUpCount: followUpAppointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        appointmentId,
        followUps: followUpAppointments,
        count: followUpAppointments.length,
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment follow-ups: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getAppointmentFollowUps',
        {
          appointmentId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Update a follow-up plan
   */
  async updateFollowUpPlan(
    followUpPlanId: string,
    updateDto: {
      scheduledFor?: string;
      followUpType?: string;
      instructions?: string;
      priority?: string;
      medications?: string[];
      tests?: string[];
      restrictions?: string[];
      notes?: string;
      status?: string;
    },
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to update follow-up plans
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.updateFollowUpPlan');
      }

      // Use plugin to update follow-up plan
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'updateFollowUpPlan',
        followUpId: followUpPlanId,
        scheduledFor: updateDto.scheduledFor,
        followUpType: updateDto.followUpType,
        instructions: updateDto.instructions,
        priority: updateDto.priority,
        medications: updateDto.medications,
        tests: updateDto.tests,
        restrictions: updateDto.restrictions,
        notes: updateDto.notes,
        status: updateDto.status,
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan updated successfully',
        'AppointmentsService.updateFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.plan.updated', {
        followUpPlanId,
        userId,
        clinicId,
        updates: updateDto,
        followUpPlan: result,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update follow-up plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.updateFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Cancel a follow-up plan
   */
  async cancelFollowUpPlan(
    followUpPlanId: string,
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to cancel follow-up plans
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.cancelFollowUpPlan');
      }

      // Use plugin to cancel follow-up plan
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'updateFollowUpStatus',
        followUpId: followUpPlanId,
        status: 'cancelled',
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan cancelled successfully',
        'AppointmentsService.cancelFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.plan.cancelled', {
        followUpPlanId,
        userId,
        clinicId,
        status: 'cancelled',
        followUpPlan: result,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel follow-up plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.cancelFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // =============================================
  // RECURRING APPOINTMENT OPERATIONS
  // =============================================

  /**
   * Create a recurring appointment series
   */
  async createRecurringSeries(
    templateId: string,
    patientId: string,
    clinicId: string,
    startDate: string,
    endDate?: string,
    userId?: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to create appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId: userId || patientId,
        clinicId,
        resource: 'appointments',
        action: 'create',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.createRecurringSeries');
      }

      // Use template plugin to create recurring series
      const result = await this.executePluginOperation(
        'appointments',
        'templates',
        'createRecurringSeries',
        {
          templateId,
          patientId,
          clinicId,
          startDate,
          endDate,
        }
      );

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring appointment series created successfully',
        'AppointmentsService.createRecurringSeries',
        {
          templateId,
          patientId,
          clinicId,
          startDate,
          endDate,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.series.created', {
        templateId,
        patientId,
        clinicId,
        startDate,
        endDate,
        series: result,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create recurring series: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.createRecurringSeries',
        {
          templateId,
          patientId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get recurring appointment series details
   */
  async getRecurringSeries(seriesId: string, clinicId: string, userId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getRecurringSeries');
      }

      // Get appointments with seriesId (uses indexed field @@index([seriesId]) for efficient query)
      // Index ensures fast lookup even with 10M+ appointments
      // Note: seriesId is not in AppointmentWhereInput, so we use executeHealthcareRead directly
      const appointments = await this.databaseService.executeHealthcareRead(async client => {
        const appointmentDelegate = client['appointment'] as unknown as {
          findMany: (args: {
            where: { clinicId: string; seriesId: string };
            orderBy: { seriesSequence: 'asc' };
          }) => Promise<AppointmentWithRelations[]>;
        };
        return await appointmentDelegate.findMany({
          where: {
            clinicId,
            seriesId,
          },
          orderBy: { seriesSequence: 'asc' },
        });
      });

      // Get series metadata from first appointment or template service
      const seriesData = {
        seriesId,
        appointments,
        totalAppointments: appointments.length,
        completed: appointments.filter(
          apt => String(apt.status) === String(AppointmentStatus.COMPLETED)
        ).length,
        pending: appointments.filter(
          apt => String(apt.status) !== String(AppointmentStatus.COMPLETED)
        ).length,
      };

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved recurring series',
        'AppointmentsService.getRecurringSeries',
        {
          seriesId,
          clinicId,
          totalAppointments: appointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return seriesData;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get recurring series: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getRecurringSeries',
        {
          seriesId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Update recurring appointment series
   */
  async updateRecurringSeries(
    seriesId: string,
    updateDto: {
      endDate?: string;
      status?: 'active' | 'paused' | 'cancelled';
    },
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to update appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.updateRecurringSeries');
      }

      // If cancelling, cancel all future appointments (optimized database query)
      // Uses indexed fields: seriesId, date, status for efficient filtering
      // KISS: Database-level filtering instead of in-memory filtering (10M+ users scale)
      if (updateDto.status === 'cancelled') {
        const now = new Date();
        // Get all appointments in series first (uses indexed seriesId)
        // Note: seriesId is not in AppointmentWhereInput, so we use executeHealthcareRead directly
        const allAppointments = await this.databaseService.executeHealthcareRead(async client => {
          const appointmentDelegate = client['appointment'] as unknown as {
            findMany: (args: {
              where: { clinicId: string; seriesId: string };
              orderBy: { date: 'asc' };
            }) => Promise<AppointmentWithRelations[]>;
          };
          return await appointmentDelegate.findMany({
            where: {
              clinicId,
              seriesId,
            },
            orderBy: { date: 'asc' },
          });
        });

        // Filter future appointments in memory (small dataset per series, acceptable)
        // For very large series, consider database-level filtering with date range
        const futureAppointments = allAppointments.filter(
          apt =>
            new Date(apt.date) > now && String(apt.status) !== String(AppointmentStatus.COMPLETED)
        );

        for (const appointment of futureAppointments) {
          await this.cancelAppointment(
            appointment.id,
            'Series cancelled',
            userId,
            clinicId,
            'USER'
          );
        }
      }

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring series updated successfully',
        'AppointmentsService.updateRecurringSeries',
        {
          seriesId,
          userId,
          clinicId,
          updates: updateDto,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.series.updated', {
        seriesId,
        userId,
        clinicId,
        updates: updateDto,
        series: {
          id: seriesId,
          seriesId,
          clinicId,
          userId,
          status: updateDto.status ?? 'active',
          updates: updateDto,
        },
      });

      return {
        success: true,
        seriesId,
        message: 'Series updated successfully',
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update recurring series: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.updateRecurringSeries',
        {
          seriesId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Cancel recurring appointment series
   */
  async cancelRecurringSeries(
    seriesId: string,
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    return this.updateRecurringSeries(seriesId, { status: 'cancelled' }, userId, clinicId);
  }

  // =============================================
  // PRIVATE HELPER METHODS
  // =============================================

  /**
   * Build user context from request
   */
  private buildUserContext(
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): AppointmentContext {
    return {
      userId,
      role,
      clinicId,
    };
  }

  /**
   * Log operation for audit purposes
   */
  private async logOperation(
    operation: string,
    userId: string,
    clinicId: string,
    details: unknown
  ): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Appointment operation: ${operation}`,
        'AppointmentsService',
        {
          operation,
          userId,
          clinicId,
          timestamp: nowIso(),
          details,
        }
      );
    } catch (_error) {
      // Silent failure for logging operations - already in error handling
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to log operation: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.logOperation',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
    }
  }
}
