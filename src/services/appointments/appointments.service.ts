import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@config/config.service';

// Infrastructure Services
import { CacheService } from '@infrastructure/cache/cache.service';
import { QueueService, AppointmentQueueService } from '@infrastructure/queue';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { HealthcareErrorsService } from '@core/errors';
import { RbacService } from '@core/rbac/rbac.service';
import {
  parseIstDateTime,
  formatDateInIST,
  formatDateTimeInIST,
  formatDateKeyInIST,
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
import { ClinicVideoPlugin } from './plugins/video/clinic-video.plugin';

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
  AppointmentServiceCategory,
  AppointmentQueueCategory,
  AppointmentBillingMode,
  AppointmentServiceMetadataDto,
  AppointmentPriority,
  ProcessCheckInDto,
  CompleteAppointmentDto,
  StartConsultationDto,
  ProposeVideoSlotsDto,
  ConfirmVideoSlotDto,
  ConfirmVideoFinalSlotDto,
} from '@dtos/appointment.dto';
import { Role } from '@core/types/enums.types';
import { isVideoCallAppointmentType } from '@core/types/appointment-guards.types';
import { isVideoSlotAwaitingConfirmation } from './core/appointment-state-contract';

// Legacy imports for backward compatibility
import { DatabaseService } from '@infrastructure/database';
import { QrService } from '@utils/QR';

// Auth Integration
import { AuthService } from '@services/auth/auth.service';
import { BillingService } from '@services/billing/billing.service';

// Use centralized types
import type { AppointmentWithRelations } from '@core/types/database.types';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';

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

const TEST_APPOINTMENT_DURATION_MINUTES = 3;

const APPOINTMENT_SERVICE_CATALOG: AppointmentServiceMetadataDto[] = [
  {
    treatmentType: TreatmentType.GENERAL_CONSULTATION,
    label: 'General Consultation',
    description: 'Comprehensive health assessment and treatment planning',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'GENERAL',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 500,
  },
  {
    treatmentType: TreatmentType.FOLLOW_UP,
    label: 'Follow-up Consultation',
    description: 'Progress review and treatment adjustments',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'FOLLOW_UP',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 300,
  },
  {
    treatmentType: TreatmentType.THERAPY,
    aliasTreatmentTypes: [TreatmentType.SURGERY],
    label: 'Procedural Care',
    description: 'Combined therapeutic and surgical procedure workflow',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PROCEDURAL_CARE',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.LAB_TEST,
    label: 'Diagnostic',
    description: 'Combined diagnostic, imaging, and preventive care workflow',
    category: AppointmentServiceCategory.DIAGNOSIS,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'DIAGNOSTIC',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.SPECIAL_CASE,
    label: 'Special Case',
    description: 'Complex, sensitive, or unusual consultation that needs tailored handling',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'SPECIAL_CASE',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
    videoConsultationFee: 600,
  },
  {
    treatmentType: TreatmentType.GERIATRIC_CARE,
    label: 'Senior Citizen',
    description: 'Care pathway tailored for senior citizens and older adults',
    category: AppointmentServiceCategory.CONSULTATION,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.HOME_VISIT],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'SENIOR_CITIZEN',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
  },
  {
    treatmentType: TreatmentType.VIDDHAKARMA,
    label: 'Viddhakarma',
    description: 'Therapeutic puncture-based Ayurvedic procedural care',
    category: AppointmentServiceCategory.SURGERY,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'VIDDHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.AGNIKARMA,
    label: 'Agnikarma',
    description: 'Therapeutic heat procedure for musculoskeletal pain relief',
    category: AppointmentServiceCategory.SURGERY,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'AGNIKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.PANCHAKARMA,
    label: 'Panchakarma Therapy',
    description: 'Traditional detoxification and rejuvenation treatment',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.NADI_PARIKSHA,
    label: 'Nadi Pariksha',
    description: 'Traditional pulse diagnosis to assess dosha imbalances',
    category: AppointmentServiceCategory.DIAGNOSIS,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'DIAGNOSIS',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
  },
  {
    treatmentType: TreatmentType.DOSHA_ANALYSIS,
    label: 'Ayurvedic Procedures',
    description: 'Combined Ayurvedic procedure workflow including dosha analysis',
    category: AppointmentServiceCategory.DIAGNOSIS,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON, AppointmentType.VIDEO_CALL],
    queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
    serviceBucket: 'AYURVEDIC_PROCEDURES',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: true,
    active: true,
  },
  {
    treatmentType: TreatmentType.SHIRODHARA,
    label: 'Shirodhara',
    description: 'Continuous oil flow on the forehead for stress and anxiety care',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'SHIRODHARA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.VIRECHANA,
    label: 'Ayurvedic Procedures',
    description: 'Therapeutic purgation as part of Panchakarma care',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.ABHYANGA,
    label: 'Ayurvedic Procedures',
    description: 'Full-body Ayurvedic therapeutic oil massage',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'ABHYANGA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.SWEDANA,
    label: 'Ayurvedic Procedures',
    description: 'Herbal steam therapy for detoxification and relaxation',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'SWEDANA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.BASTI,
    label: 'Ayurvedic Procedures',
    description: 'Therapeutic medicated enema under Ayurvedic care plan',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.NASYA,
    label: 'Ayurvedic Procedures',
    description: 'Nasal administration therapy as part of Ayurvedic treatment',
    category: AppointmentServiceCategory.TREATMENT,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'PANCHAKARMA',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
  {
    treatmentType: TreatmentType.RAKTAMOKSHANA,
    label: 'Ayurvedic Procedures',
    description: 'Therapeutic bloodletting procedure under supervised care',
    category: AppointmentServiceCategory.SURGERY,
    defaultDurationMinutes: TEST_APPOINTMENT_DURATION_MINUTES,
    appointmentModes: [AppointmentType.IN_PERSON],
    queueCategory: AppointmentQueueCategory.THERAPY_PROCEDURE,
    serviceBucket: 'SURGICAL',
    billingMode: AppointmentBillingMode.SUBSCRIPTION_INCLUDED,
    assistantDoctorEligible: false,
    active: true,
  },
];

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
    private readonly pluginRegistry: EnterprisePluginRegistry,
    private readonly pluginManager: EnterprisePluginManager,

    // Direct Injection: Hot-path plugins (top 5 most frequently used)
    // Performance: Direct access eliminates registry lookup overhead (~0.1ms saved per call)
    // Type Safety: Full TypeScript support with IDE autocomplete
    // Scale: Critical for 10M+ concurrent users - these plugins handle 80% of traffic
    private readonly clinicCheckInPlugin: ClinicCheckInPlugin, // Hot path: Check-in operations (very frequent)
    private readonly clinicNotificationPlugin: ClinicNotificationPlugin, // Hot path: Notifications (every appointment action)
    private readonly clinicConfirmationPlugin: ClinicConfirmationPlugin, // Hot path: Confirmations (common)
    private readonly clinicLocationPlugin: ClinicLocationPlugin, // Medium: Location queries (moderate frequency)
    private readonly clinicFollowUpPlugin: ClinicFollowUpPlugin, // Medium: Follow-up operations (moderate frequency)
    private readonly clinicVideoPlugin: ClinicVideoPlugin, // Video consultations (medium-low frequency)

    // Infrastructure Services
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService)) private readonly cacheService: CacheService,
    // Queue Service - BullMQ-based queue system
    // Use QueueService from @infrastructure/queue (migrated from Bull to BullMQ)
    // All jobs now route through HEALTHCARE_QUEUE via JobType enum
    @Inject(forwardRef(() => QueueService)) private readonly queueService: QueueService,
    private readonly appointmentQueueService: AppointmentQueueService,
    @Inject(forwardRef(() => EventService)) private readonly eventService: EventService,
    @Inject(forwardRef(() => ConfigService)) private readonly configService: ConfigService,

    // Legacy Services (for backward compatibility)
    @Inject(forwardRef(() => DatabaseService)) private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => QrService)) private readonly qrService: QrService,

    // Auth Integration
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,

    // Error Handling & RBAC
    private readonly errors: HealthcareErrorsService,
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

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNoShowCancellationCron() {
    await this.processNoShowCancellations();
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

    const candidates = await this.databaseService.executeHealthcareRead(async client => {
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
      const reason = `Auto-cancelled: doctor did not confirm any proposed slot before ${formattedExpiry} IST.`;

      try {
        const cancellationResult = await this.cancelAppointment(
          appointment.id,
          reason,
          'system',
          appointment.clinicId,
          'SYSTEM'
        );

        if (!cancellationResult.success) {
          failedCount++;
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            `Failed to auto-cancel expired video slot confirmation: ${cancellationResult.message || cancellationResult.error || 'Unknown cancellation failure'}`,
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

    const appointmentsToCheck = await this.databaseService.executeHealthcareRead(async client => {
      const prismaClient = client as unknown as Prisma.TransactionClient;
      return await prismaClient.appointment.findMany({
        where: {
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
        },
        orderBy: { date: 'asc' },
      });
    });

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
          await this.eventService.emitEnterprise('appointment.noshow', {
            eventId: `noshow-${appointment.id}-${Date.now()}`,
            eventType: 'appointment.noshow',
            category: EventCategory.APPOINTMENT,
            priority: EventPriority.NORMAL,
            timestamp: nowIso(),
            source: 'AppointmentsService',
            version: '1.0.0',
            userId: appointment.patientId,
            clinicId: appointment.clinicId,
            payload: {
              appointmentId: appointment.id,
              doctorId: appointment.doctorId,
              date: appointment.date,
              reason: 'No-show',
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
    const startOfDay = new Date(appointmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(appointmentDate);
    endOfDay.setHours(23, 59, 59, 999);

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
    return APPOINTMENT_SERVICE_CATALOG.map(service => ({
      ...service,
      appointmentModes: [...service.appointmentModes],
      ...(service.aliasTreatmentTypes
        ? { aliasTreatmentTypes: [...service.aliasTreatmentTypes] }
        : {}),
    }));
  }

  private getAppointmentServiceMetadata(
    treatmentType?: TreatmentType | string | null
  ): AppointmentServiceMetadataDto {
    const normalizedTreatmentType = this.resolveCatalogTreatmentType(treatmentType);
    return (
      APPOINTMENT_SERVICE_CATALOG.find(
        service =>
          String(service.treatmentType) === String(normalizedTreatmentType) ||
          service.aliasTreatmentTypes?.some(
            alias => String(alias) === String(normalizedTreatmentType)
          )
      ) ||
      APPOINTMENT_SERVICE_CATALOG.find(
        service => service.treatmentType === TreatmentType.GENERAL_CONSULTATION
      )!
    );
  }

  private resolveCatalogTreatmentType(
    treatmentType?: TreatmentType | string | null
  ): string | null {
    const normalized = String(treatmentType || '')
      .trim()
      .toUpperCase();
    if (!normalized) {
      return treatmentType ?? null;
    }
    if (normalized === String(TreatmentType.SURGERY)) {
      return TreatmentType.THERAPY;
    }
    return normalized;
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

  private async resolveDoctorEntityId(
    doctorIdentifier: string,
    clinicId: string
  ): Promise<string | null> {
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

    await this.loggingService.log(
      LogType.APPOINTMENT,
      LogLevel.INFO,
      `Checking subscription for role: ${normalizedRole}, isAdministrative: ${isAdministrativeRole}`,
      'AppointmentsService',
      { role: normalizedRole, isAdministrativeRole }
    );

    let resolvedInPersonCoverage: { subscriptionId: string; patientUserId: string } | null = null;
    if (shouldResolveInPersonCoverageBeforeCreate) {
      resolvedInPersonCoverage = await this.resolveEligibleInPersonSubscription(
        createDto.patientId,
        clinicId
      );

      // If no subscription is found, we only throw for patients booking for themselves.
      // Administrative roles can bypass this to support walk-ins or manual billing.
      if (!resolvedInPersonCoverage && !isAdministrativeRole) {
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
      await this.loggingService.log(
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
      );

      // Invalidate related cache entries
      await this.cacheService.invalidateAppointmentCache(
        (result.data as Record<string, unknown>)?.['id'] as string,
        createDto.patientId,
        createDto.doctorId,
        clinicId
      );
      await Promise.all([
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

      // Hot path: Trigger notification plugin (direct injection for performance)
      // Notification is sent on every appointment creation - high frequency operation
      try {
        await this.clinicNotificationPlugin.process({
          operation: 'send_appointment_created',
          appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
          patientId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId,
          appointmentData: result.data,
        });
      } catch (notificationError) {
        // Log but don't fail appointment creation if notification fails
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to send appointment creation notification',
          'AppointmentsService.createAppointment',
          {
            appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }
        );
      }

      // Room creation for VIDEO_CALL appointments is handled dynamically during generateMeetingToken
      // No explicit pre-creation is needed.

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.eventService.emitEnterprise('appointment.created', {
        eventId: `appointment-created-${(result.data as Record<string, unknown>)?.['id'] as string}-${Date.now()}`,
        eventType: 'appointment.created',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.HIGH,
        timestamp: nowIso(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: createDto.patientId,
        clinicId,
        payload: {
          appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
          userId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId,
          status: (result.data as Record<string, unknown>)?.['status'] as string,
          appointmentType: createDto.type,
          createdBy: userId,
        },
      });
    }

    return result;
  }

  /**
   * Propose video appointment with 3-4 time slots (patient flow).
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
      const prisma = client as {
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

    if (dto.proposedSlots.length < 3) {
      throw this.errors.validationError(
        'proposedSlots',
        'At least 3 time slots must be proposed',
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

    await this.eventService.emitEnterprise('appointment.updated', {
      eventId: `appointment-confirmed-slot-${appointmentId}-${Date.now()}`,
      eventType: 'appointment.updated',
      category: EventCategory.APPOINTMENT,
      priority: EventPriority.NORMAL,
      timestamp: nowIso(),
      source: 'AppointmentsService',
      version: '1.0.0',
      ...(appointmentWithRelations.patient?.userId
        ? { userId: appointmentWithRelations.patient.userId }
        : {}),
      clinicId,
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

  /**
   * Reschedule appointment with policy enforcement (24h notice).
   */
  async rescheduleAppointment(
    appointmentId: string,
    newDate: string,
    newTime: string,
    userId: string,
    clinicId: string
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

    // Production policy: Allow rescheduling up to 24h before.
    // Temporarily disabled for testing so short-notice appointment changes can be exercised.
    // const appointmentDateTime = new Date(
    //   parseIstDateTime(appointment.date, appointment.time)
    // );
    // const now = new Date();
    // const minNoticeMs = 24 * 60 * 60 * 1000;
    //
    // if (appointmentDateTime.getTime() - now.getTime() < minNoticeMs) {
    //   throw this.errors.validationError(
    //     'date',
    //     'Rescheduling is only allowed at least 24 hours in advance.',
    //     'AppointmentsService.rescheduleAppointment'
    //   );
    // }

    // Policy: Limit number of reschedules (e.g. max 2 times)
    const metadata = (appointment.metadata as Record<string, unknown>) || {};
    const rescheduleCount = (metadata['rescheduleCount'] || 0) as number;
    const MAX_RESCHEDULES = 2;

    if (rescheduleCount >= MAX_RESCHEDULES) {
      throw this.errors.validationError(
        'metadata',
        `Maximum reschedule limit (${MAX_RESCHEDULES}) reached for this appointment.`,
        'AppointmentsService.rescheduleAppointment'
      );
    }

    // Check availability for new slot
    const availability = (await this.coreAppointmentService.getDoctorAvailability(
      appointment.doctorId,
      newDate,
      { clinicId, userId, role: 'USER' }
    )) as { availableSlots: string[] };

    if (!availability.availableSlots || !availability.availableSlots.includes(newTime)) {
      throw this.errors.appointmentSlotUnavailable(
        `${newDate} ${newTime}`,
        'AppointmentsService.rescheduleAppointment'
      );
    }

    // Update appointment
    const updated = await this.databaseService.updateAppointmentSafe(appointmentId, {
      date: new Date(newDate),
      time: newTime,
      status: AppointmentStatus.SCHEDULED, // Reset to scheduled
      metadata: {
        ...metadata,
        rescheduleCount: rescheduleCount + 1,
        lastRescheduledAt: new Date(),
      },
    });

    await this.syncPaidAppointmentBillingAfterReschedule(appointment, newDate, newTime, userId);

    // Notify
    await this.eventService.emit('appointment.rescheduled', {
      appointmentId,
      clinicId,
      oldDate: appointment.date,
      oldTime: appointment.time,
      newDate,
      newTime,
      context: { userId },
    });

    return {
      success: true,
      data: updated as unknown as Record<string, unknown>,
      message: `Appointment rescheduled successfully (Count: ${rescheduleCount + 1}/${MAX_RESCHEDULES}).`,
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
      _role === 'PATIENT'
        ? ((await this.getPatientByUserId(userId)) as { id?: string } | null)
        : null;
    const isConsultantRole = [Role.DOCTOR, Role.ASSISTANT_DOCTOR].includes(_role as Role);

    const doctor = isConsultantRole ? await this.resolveDoctorEntityId(userId, clinicId) : null;

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

    return this.cacheService.cache(
      cacheKey,
      () => this.coreAppointmentService.getAppointments(filters, context, page, limit),
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
      const cancelledResult = result.data ?? {};
      const cancelledDoctorId =
        typeof cancelledResult?.['doctorId'] === 'string' && cancelledResult['doctorId']
          ? String(cancelledResult['doctorId'])
          : undefined;

      if (cancelledDoctorId) {
        try {
          await this.appointmentQueueService.removePatientFromQueue(
            appointmentId,
            cancelledDoctorId,
            clinicId,
            'clinic'
          );
        } catch (queueError) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Queue cleanup after appointment cancellation failed: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
            'AppointmentsService.cancelAppointment',
            {
              appointmentId,
              doctorId: cancelledDoctorId,
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

      // Hot path: Trigger notification plugin (direct injection for performance)
      try {
        await this.clinicNotificationPlugin.process({
          operation: 'send_appointment_updated',
          appointmentId,
          patientId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          changes: updateDto,
        });
      } catch (notificationError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to send appointment update notification',
          'AppointmentsService.updateAppointment',
          {
            appointmentId,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }
        );
      }

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.eventService.emitEnterprise('appointment.updated', {
        eventId: `appointment-updated-${appointmentId}-${Date.now()}`,
        eventType: 'appointment.updated',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
        clinicId,
        payload: {
          appointmentId,
          userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          changes: updateDto,
          updatedBy: userId,
          status:
            updateDto.status || ((result.data as Record<string, unknown>)?.['status'] as string),
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

    // 2. Dispatch based on new status
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

      case AppointmentStatus.CANCELLED:
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

        // Trigger refund for cancellation
        await this.triggerAppointmentRefund(
          appointmentId,
          clinicId,
          `Appointment cancelled: ${updateDto.reason}`
        );

        return this.cancelAppointment(appointmentId, updateDto.reason, userId, clinicId, role);

      case AppointmentStatus.NO_SHOW: {
        // Handle automated refund if it's a doctor no-show
        if (updateDto.reason === 'Doctor failed to join within grace period.') {
          await this.triggerAppointmentRefund(
            appointmentId,
            clinicId,
            'Automated refund due to Doctor No-Show'
          );
        }
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

      // Handle other status updates generically (e.g., CONFIRMED)
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

    if (String(appointment.status) === String(AppointmentStatus.CONFIRMED)) {
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

    await this.eventService.emitEnterprise('appointment.reassigned', {
      eventId: `appointment-reassigned-${appointmentId}-${Date.now()}`,
      eventType: 'appointment.reassigned',
      category: EventCategory.APPOINTMENT,
      priority: EventPriority.HIGH,
      timestamp: nowIso(),
      source: 'AppointmentsService',
      version: '1.0.0',
      userId: appointment.patientId,
      clinicId,
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
      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.['patientId'] as string,
        (result.data as Record<string, unknown>)?.['doctorId'] as string,
        clinicId
      );

      // Hot path: Trigger notification plugin (direct injection for performance)
      try {
        await this.clinicNotificationPlugin.process({
          operation: 'send_appointment_cancelled',
          appointmentId,
          patientId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          reason,
        });
      } catch (notificationError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to send appointment cancellation notification',
          'AppointmentsService.cancelAppointment',
          {
            appointmentId,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }
        );
      }

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.eventService.emitEnterprise('appointment.cancelled', {
        eventId: `appointment-cancelled-${appointmentId}-${Date.now()}`,
        eventType: 'appointment.cancelled',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.HIGH,
        timestamp: nowIso(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
        clinicId,
        payload: {
          appointmentId,
          userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          reason,
          cancelledBy: userId,
          status: 'CANCELLED',
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
      // Hot path: Direct plugin injection for performance (10M+ users scale)
      // Direct access: ~0.1ms faster than registry lookup
      const checkInData = await this.clinicCheckInPlugin.process({
        operation: 'processCheckIn',
        clinicId,
        userId,
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

        // Emit event for real-time broadcasting
        await this.eventService.emit('appointment.checked_in', {
          appointmentId: checkInDto.appointmentId,
          clinicId,
          checkedInBy: userId,
          checkInData: checkInDto,
        });
        await this.eventService.emit('appointment.confirmed', {
          appointmentId: checkInDto.appointmentId,
          clinicId,
          confirmedBy: userId,
          checkInData: checkInDto,
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
  async completeAppointment(
    appointmentId: string,
    completeDto: CompleteAppointmentDto,
    userId: string,
    clinicId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Get appointment to extract doctorId and validate clinic isolation
      const appointment = (await this.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;

      // Use appointment's doctorId, fallback to userId if not available
      const doctorId = appointment.doctorId || userId;

      // Hot path: Direct plugin injection for performance
      // Use doctorId from DTO if provided, otherwise use appointment's doctorId
      const finalDoctorId = completeDto.doctorId || doctorId;

      // Create a copy of completeDto without doctorId to avoid duplication
      const { doctorId: _, ...restDto } = completeDto;

      let completionData: unknown;
      try {
        completionData = await this.clinicConfirmationPlugin.process({
          operation: 'markAppointmentCompleted',
          appointmentId,
          doctorId: finalDoctorId,
          clinicId,
          userId: appointment.userId,
          ...restDto,
        });
      } catch (error) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Clinic confirmation plugin failed during completion; continuing with appointment status update: ${error instanceof Error ? error.message : String(error)}`,
          'AppointmentsService.completeAppointment',
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
          completedAt: nowIso(),
          fallback: true,
        };
      }

      const result = { success: true, data: completionData };

      if (result.success) {
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await (
              client as unknown as {
                appointment: {
                  update: <T>(args: T) => Promise<unknown>;
                };
              }
            ).appointment.update({
              where: { id: appointmentId },
              data: {
                status: AppointmentStatus.COMPLETED,
                updatedAt: new Date(),
              },
            });
          },
          {
            userId,
            userRole: _role,
            clinicId,
            operation: 'UPDATE_APPOINTMENT',
            resourceType: 'APPOINTMENT',
            resourceId: appointmentId,
            timestamp: new Date(),
            details: { status: AppointmentStatus.COMPLETED },
          }
        );

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
          await this.appointmentQueueService.removePatientFromQueue(
            appointmentId,
            finalDoctorId,
            clinicId,
            'clinic'
          );
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

        // Create follow-up plan if requested
        if (
          completeDto.followUpRequired &&
          completeDto.followUpType &&
          completeDto.followUpInstructions
        ) {
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
                completeDto.doctorId,
                clinicId,
                completeDto.followUpType,
                daysAfter,
                completeDto.followUpInstructions,
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
                        doctorId: completeDto.doctorId || appointment.doctorId,
                        clinicId,
                        appointmentDate: followUpDate.toISOString(),
                        duration: appointment.duration || 30,
                        type: appointment.type || AppointmentType.IN_PERSON,
                        treatmentType: TreatmentType.FOLLOW_UP,
                        priority: completeDto.followUpPriority || AppointmentPriority.NORMAL,
                        notes: completeDto.followUpInstructions,
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
                              followUpReason: completeDto.followUpInstructions,
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
        await this.eventService.emitEnterprise('appointment.completed', {
          eventId: `appointment-completed-${appointmentId}-${Date.now()}`,
          eventType: 'appointment.completed',
          category: EventCategory.APPOINTMENT,
          priority: EventPriority.HIGH,
          timestamp: nowIso(),
          source: 'AppointmentsService',
          version: '1.0.0',
          userId: appointment?.patientId || userId,
          clinicId,
          payload: {
            appointmentId,
            clinicId,
            completedBy: userId,
            completionData: completeDto,
            status: 'COMPLETED',
            patientId: appointment?.patientId,
            doctorId: appointment?.doctorId,
          },
        });

        await this.eventService.emit('appointment.completed', {
          appointmentId,
          clinicId,
          status: 'COMPLETED',
          patientId: appointment?.patientId,
          doctorId: appointment?.doctorId,
        });
      }
      return result;
    } catch (_error) {
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
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Validate appointment exists in current clinic
      await this.getAppointmentById(appointmentId, clinicId);

      // Hot path: Direct plugin injection for performance
      const consultationData = await this.clinicCheckInPlugin.process({
        operation: 'startConsultation',
        appointmentId,
        clinicId,
        ...startDto,
      });

      const result = { success: true, data: consultationData };

      if (result.success) {
        // Log the consultation start event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Consultation started successfully',
          'AppointmentsService',
          { appointmentId, userId, clinicId }
        );

        // Emit event for real-time broadcasting
        await this.eventService.emit('appointment.consultation_started', {
          appointmentId,
          clinicId,
          startedBy: userId,
          consultationData: startDto,
        });
      }
      return result;
    } catch (_error) {
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

    return this.cacheService.cache(
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
            const appointment = client['appointment'] as {
              findFirst: (args: {
                where: { id: string; clinicId: string };
                include: { patient: boolean; doctor: boolean; clinic: boolean; location: boolean };
              }) => Promise<AppointmentWithRelations | null>;
            };
            return (await appointment.findFirst({
              where: {
                id,
                clinicId,
              },
              include: {
                patient: true,
                doctor: true,
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
  }

  /**
   * Get patient by user ID
   */
  async getPatientByUserId(userId: string): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    const cacheKey = this.cacheService.getKeyFactory().patient(userId, undefined, 'user');

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use executeHealthcareRead with client parameter (patient doesn't have safe method yet)
        const patient = await this.databaseService.executeHealthcareRead(async client => {
          const patientDelegate = client['patient'] as {
            findFirst: (args: {
              where: { userId: string };
              include: { user: boolean };
            }) => Promise<unknown>;
          };
          return await patientDelegate.findFirst({
            where: {
              userId,
            },
            include: {
              user: true,
            },
          });
        });

        return patient;
      },
      {
        ttl: 3600,
        tags: ['patients', 'user_patients', `user:${userId}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
      }
    );
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

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
        ttl: 180,
        tags: ['appointments', 'doctor_availability', `doctor:${doctorId}`],
        priority: 'high',
        enableSwr: true,
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
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    // Use patient-specific caching for better healthcare optimization
    const cacheKey = this.cacheService
      .getKeyFactory()
      .patient(userId, clinicId, 'upcoming_appointments');

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const filters: AppointmentFilterDto = {
          patientId: userId,
          startDate: formatDateKeyInIST(new Date()),
          status: AppointmentStatus.SCHEDULED,
        };

        const result = await this.getAppointments(filters, userId, clinicId, role, 1, 10);
        return result;
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
   * Find appointments for a user at a specific location
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
      const patient = (await this.getPatientByUserId(userId)) as { id?: string } | null;
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
      // responses on re-scan; only exclude past appointments here.
      const validAppointments = allAppointments.filter(apt => new Date(apt.date) >= today);

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
        cursor: undefined, // Can be extended to support pagination params
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
        const appointmentDelegate = client['appointment'] as {
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
          const appointmentDelegate = client['appointment'] as {
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
  /**
   * Helper to trigger refund for an appointment if payments exist.
   */
  private async triggerAppointmentRefund(
    appointmentId: string,
    clinicId: string,
    reason: string
  ): Promise<void> {
    try {
      const payments = await this.databaseService.findPaymentsSafe({
        appointmentId,
        status: 'COMPLETED',
      });

      for (const payment of payments) {
        await this.billingService.refundPayment(
          clinicId,
          payment.id,
          undefined, // full refund
          reason
        );
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to trigger refund for appointment ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentsService.triggerAppointmentRefund',
        { appointmentId }
      );
    }
  }
}
