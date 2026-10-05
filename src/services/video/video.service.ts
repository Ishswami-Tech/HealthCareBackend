/**
 * Video Service - Consolidated Single Service
 * @class VideoService
 * @description SINGLE video service for all video operations
 *
 * This is the ONLY video service in the application.
 * Provider-agnostic: backed by swappable video adapters behind a stable interface.
 *
 * Architecture:
 * - Uses Factory pattern for provider selection
 * - Primary adapter selected by configuration
 * - Health-based fallback to the secondary adapter
 * - Automatic fallback if primary provider fails
 * - Follows SOLID principles
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ModuleRef as _ModuleRef } from '@nestjs/core';
import { ConfigService } from '@config/config.service';
import { getVideoActiveWindowMinutes, getVideoEarlyJoinMinutes } from '@config/video.config';
import { CacheService } from '@infrastructure/cache/cache.service';
import { Prisma } from '@infrastructure/database/prisma/generated/client';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
// Use direct import to avoid TDZ issues with barrel exports
import { DatabaseService } from '@infrastructure/database/database.service';
import { QueueService } from '@queue/src/queue.service';
import type {
  IVideoProvider,
  VideoProviderType,
  VideoTokenResponse,
  VideoConsultationSession,
  VideoConsultationAccessState,
} from '@core/types/video.types';
import { VideoProviderFactory } from '@services/video/providers/video-provider.factory';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { AppointmentStatus, Role } from '@core/types/enums.types';
// Legacy queue constant removed � uses JobType.VIDEO_RECORDING via HEALTHCARE_QUEUE
// Future use: VIDEO_TRANSCODING_QUEUE, VIDEO_ANALYTICS_QUEUE
import { HealthcareError } from '@core/errors';
import { extractErrorMessage } from '@core/errors/error-message.util';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { isVideoCallAppointment } from '@core/types/appointment-guards.types';
import { isVideoSlotAwaitingConfirmation } from '@services/appointments/core/appointment-state-contract';
import type { VideoCallAppointment } from '@core/types/appointment.types';
import type {
  AppointmentWithRelations,
  VideoCall,
  VideoCallSettings,
  ServiceResponse,
  VideoConsultationSession as AppointmentVideoConsultationSession,
} from '@core/types';
import type { VideoConsultationDbModel } from '@core/types/video-database.types';
import {
  getVideoConsultationDelegate,
  getVideoRecordingDelegate,
} from '@core/types/video-database.types';
import { RbacService } from '@core/rbac/rbac.service';
import { BillingService } from '@services/billing/billing.service';
import { normalizeAppointmentId } from '@utils/appointment-id.utils';
import { parseIstDateTime, nowIso } from '@utils/date-time.util';
import {
  VIDEO_END_FORBIDDEN_MESSAGE,
  assertParticipantOrClinicStaff,
  isClinicAdminRole,
  isFamilyMemberOwner,
  isPatientOwner,
  resolveVideoBookerUserId,
  resolveVideoCompletionActor,
  type VideoAccessAppointment,
  type VideoBookerAppointment,
  type VideoCallerContext,
  type VideoCallerRole,
  type VideoCompletionActor,
} from '@services/video/video-access.helpers';
import {
  buildVideoLifecycleRouting,
  claimDoctorStart,
  claimPendingCompletionEvent,
  emitAppointmentCompletedWithRetry,
  hasCompletionEventPending,
  isProviderUnavailableError,
  markCompletionEventPending,
  type CompletedAppointmentRef,
} from '@services/video/video-completion.helpers';
import {
  isAppointmentPaid,
  type AppointmentPaymentLike,
} from '@services/appointments/core/appointment-payment.util';
import { findTerminatingProvider } from '@services/video/providers/video-provider.helpers';

export type { VideoCall, VideoCallSettings };

type AppointmentVideoNameSource = {
  id: string;
  date?: Date | string | null;
  time?: string | null;
  duration?: number | null;
  patient?: unknown;
  doctor?: unknown;
  patientName?: unknown;
  doctorName?: unknown;
  clientName?: unknown;
};

// Type aliases for response data structures using existing ServiceResponse<T>
type CreateVideoCallResponse = ServiceResponse<VideoCall>;
type RecordingResponse = ServiceResponse<{
  recordingId?: string;
  recordingUrl?: string;
  duration?: number;
}>;
type EndVideoCallResponse = ServiceResponse<{
  callId: string;
  duration?: number;
}>;
type ShareMedicalImageResponse = ServiceResponse<{
  imageUrl: string;
}>;
type VideoCallHistoryResponse = ServiceResponse<{
  userId: string;
  clinicId?: string;
  calls: VideoCall[];
  total: number;
  retrievedAt: string;
}>;

type VideoSessionAccessContext = {
  userId?: string;
  userRole?: string;
};

type SummaryUser = {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/** An appointment with what the post-call summary and the rating need (see loadAppointmentForSummary). */
type ConsultationSummaryAppointment = {
  id: string;
  clinicId: string;
  /** User who created the appointment (the patient, an account holder, or staff). */
  userId?: string | null;
  familyMemberId?: string | null;
  date: Date;
  time: string;
  duration: number;
  status: string;
  type: string;
  doctorId: string;
  patientId: string;
  metadata: unknown;
  patient: { id: string; userId: string; user?: SummaryUser | null } | null;
  doctor: {
    id: string;
    userId: string;
    specialization?: string | null;
    user?: SummaryUser | null;
  } | null;
};

/** First HTTP status that counts as a server-side failure (the client message is hidden). */
const SERVER_ERROR_STATUS_MIN = 500;

const GLOBAL_VIDEO_PROVIDER_SETTING_KEY = 'global_video_provider';
const DEFAULT_GLOBAL_VIDEO_PROVIDER: VideoProviderType = 'daily';

type VideoProviderSettingRow = {
  settingValue: string | null;
};

@Injectable()
export class VideoService implements OnModuleInit, OnModuleDestroy {
  private static readonly VIDEO_ACTIVE_WINDOW_MINUTES = getVideoActiveWindowMinutes();
  private static readonly VIDEO_EARLY_JOIN_MINUTES = getVideoEarlyJoinMinutes();
  /**
   * Appointment statuses a consultation can be STARTED from (the doctor's start moves them to
   * IN_PROGRESS). Ending is stricter: only an IN_PROGRESS visit can be completed.
   */
  private static readonly CONSULTATION_OPEN_STATUSES: readonly AppointmentStatus[] = [
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.SCHEDULED,
  ];
  /** VideoConsultation statuses of a call that is over (see markConsultationEnded). */
  private static readonly FINISHED_CONSULTATION_STATUSES: ReadonlySet<string> = new Set([
    'COMPLETED',
    'ENDED',
    'CANCELLED',
  ]);
  private static readonly RATING_LOCK_TTL_SECONDS = 30;
  private provider: IVideoProvider | undefined;
  private readonly VIDEO_CACHE_TTL = 1800; // 30 minutes
  private readonly CALL_CACHE_TTL = 300; // 5 minutes
  private readonly MEETING_CACHE_TTL = 3600; // 1 hour

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => VideoProviderFactory))
    private readonly providerFactory: VideoProviderFactory,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    @Inject(forwardRef(() => RbacService))
    private readonly rbacService: RbacService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize provider through the single provider abstraction
    // Wrapped in try-catch to prevent API crash if video services are unavailable
    try {
      const initializedProvider: IVideoProvider =
        await this.providerFactory.getProviderWithFallback(await this.resolveGlobalVideoProvider());
      this.provider = initializedProvider;

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Video Service initialized (Provider: ${initializedProvider.providerName})`,
        'VideoService',
        {
          provider: initializedProvider.providerName,
          providerType: initializedProvider.providerName,
        }
      );
    } catch (error) {
      // GRACEFUL DEGRADATION: Log warning but don't crash the API
      // Video features will be unavailable but core healthcare features will work
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Video Service initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}. Attempting deferred provider initialization.`,
        'VideoService.onModuleInit',
        {
          error: error instanceof Error ? error.message : 'Unknown',
          note: 'API will continue. Video features will be checked again when used.',
        }
      );

      // Try to get provider instance anyway for deferred availability when services start
      try {
        this.provider = await this.providerFactory.getProviderWithFallback(
          await this.resolveGlobalVideoProvider()
        );
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Video provider instance obtained for deferred initialization. Provider: ${this.provider.providerName}.`,
          'VideoService.onModuleInit',
          { provider: this.provider.providerName }
        );
      } catch {
        // Provider instance not available - video will be completely unavailable
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'Could not obtain video provider instance. Video features will be unavailable until restart.',
          'VideoService.onModuleInit',
          {}
        );
      }
      // Don't throw - allow API to start without video capabilities
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Video Service shutting down',
      'VideoService',
      {}
    );
  }

  /**
   * Get current provider through the single backend abstraction.
   */
  private async getProvider(): Promise<IVideoProvider> {
    const preferredProvider = await this.resolveGlobalVideoProvider();

    // If provider is already initialized, check its health
    if (this.provider) {
      try {
        const isHealthy = await this.provider.isHealthy();
        if (isHealthy && this.provider.providerName === preferredProvider) {
          return this.provider;
        }

        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Current video provider (${this.provider.providerName}) is unhealthy or no longer matches the configured preference (${preferredProvider}).`,
          'VideoService.getProvider',
          {
            currentProvider: this.provider.providerName,
            preferredProvider,
            healthStatus: 'unhealthy',
          }
        );
      } catch (error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Health check failed for current provider (${this.provider.providerName}): ${error instanceof Error ? error.message : 'Unknown error'}.`,
          'VideoService.getProvider',
          {
            currentProvider: this.provider.providerName,
            preferredProvider,
            error: error instanceof Error ? error.message : 'Unknown',
          }
        );
      }
    }

    // Get provider with health validation
    try {
      const healthyProvider = await this.providerFactory.getProviderWithFallback(preferredProvider);

      // Update current provider if it changed
      if (this.provider?.providerName !== healthyProvider.providerName) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Video provider resolved: ${this.provider?.providerName || 'none'} -> ${healthyProvider.providerName}`,
          'VideoService.getProvider',
          {
            previousProvider: this.provider?.providerName || 'none',
            currentProvider: healthyProvider.providerName,
            reason: 'health_based_resolution',
          }
        );
        this.provider = healthyProvider;
      }

      return healthyProvider;
    } catch (error) {
      // No provider available. The cause goes to the log, never into the exception metadata the
      // client receives.
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `No video provider is available: ${extractErrorMessage(error) ?? 'Unknown error'}`,
        'VideoService.getProvider',
        { preferredProvider }
      );
      throw new HealthcareError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Video service is currently unavailable. Please try again later or contact support.',
        undefined,
        {
          note: 'Both video providers are unavailable. Core healthcare features remain available.',
        },
        'VideoService.getProvider'
      );
    }
  }

  private normalizeVideoProvider(value: unknown): VideoProviderType | null {
    const provider =
      typeof value === 'string'
        ? value.trim().toLowerCase()
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value).trim().toLowerCase()
          : '';
    if (provider === 'cloudflare' || provider === 'daily' || provider === 'google-meet') {
      return provider;
    }
    return null;
  }

  private async resolveGlobalVideoProvider(): Promise<VideoProviderType> {
    try {
      const rows = await this.databaseService.executeRawQuery<VideoProviderSettingRow[]>(
        'SELECT "settingValue" FROM "system_settings" WHERE "settingKey" = $1 LIMIT 1',
        [GLOBAL_VIDEO_PROVIDER_SETTING_KEY]
      );
      const provider = this.normalizeVideoProvider(rows?.[0]?.settingValue);
      if (provider) {
        return provider;
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to read global video provider setting: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to environment configuration.`,
        'VideoService.resolveGlobalVideoProvider',
        {
          error: error instanceof Error ? error.message : 'Unknown',
        }
      );
    }

    return DEFAULT_GLOBAL_VIDEO_PROVIDER;
  }

  async getGlobalVideoProviderSetting(): Promise<{
    provider: VideoProviderType;
    source: 'database' | 'env';
  }> {
    try {
      const rows = await this.databaseService.executeRawQuery<VideoProviderSettingRow[]>(
        'SELECT "settingValue" FROM "system_settings" WHERE "settingKey" = $1 LIMIT 1',
        [GLOBAL_VIDEO_PROVIDER_SETTING_KEY]
      );
      const provider = this.normalizeVideoProvider(rows?.[0]?.settingValue);
      if (provider) {
        return { provider, source: 'database' };
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Unable to load persisted global video provider setting: ${error instanceof Error ? error.message : 'Unknown error'}.`,
        'VideoService.getGlobalVideoProviderSetting',
        {
          error: error instanceof Error ? error.message : 'Unknown',
        }
      );
    }

    return {
      provider: DEFAULT_GLOBAL_VIDEO_PROVIDER,
      source: 'env',
    };
  }

  async updateGlobalVideoProviderSetting(provider: VideoProviderType): Promise<{
    provider: VideoProviderType;
    source: 'database';
  }> {
    const normalizedProvider = this.normalizeVideoProvider(provider);
    if (!normalizedProvider) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Invalid video provider selected.',
        undefined,
        { provider },
        'VideoService.updateGlobalVideoProviderSetting'
      );
    }

    await this.databaseService.executeRawQuery(
      `
        INSERT INTO "system_settings" ("settingKey", "settingValue", "createdAt", "updatedAt")
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT ("settingKey")
        DO UPDATE SET
          "settingValue" = EXCLUDED."settingValue",
          "updatedAt" = NOW()
      `,
      [GLOBAL_VIDEO_PROVIDER_SETTING_KEY, normalizedProvider]
    );

    this.provider = undefined;

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `Global video provider updated to ${normalizedProvider}`,
      'VideoService.updateGlobalVideoProviderSetting',
      { provider: normalizedProvider }
    );

    return {
      provider: normalizedProvider,
      source: 'database',
    };
  }

  private resolvePreferredProviderFromAppointment(
    appointment: AppointmentWithRelations | null | undefined
  ): VideoProviderType | null {
    const clinic = appointment?.clinic as
      | {
          settings?: Record<string, unknown> | null;
        }
      | null
      | undefined;
    const settings = clinic?.settings;
    if (!settings || typeof settings !== 'object') {
      return null;
    }

    const rawProvider =
      (settings['videoSettings'] as { provider?: unknown } | undefined)?.provider ??
      settings['videoProvider'];

    return this.normalizeVideoProvider(rawProvider);
  }

  private async resolveEffectivePreferredProvider(
    appointment?: AppointmentWithRelations | null
  ): Promise<VideoProviderType> {
    const clinicProvider = this.resolvePreferredProviderFromAppointment(appointment);
    if (clinicProvider) {
      return clinicProvider;
    }

    return this.resolveGlobalVideoProvider();
  }

  private async withProviderFallback<T>(
    operationName: string,
    executor: (provider: IVideoProvider) => Promise<T>,
    preferredProvider?: VideoProviderType | null
  ): Promise<T> {
    const providers = this.providerFactory.getProvidersInOrder(preferredProvider);
    if (providers.length === 0) {
      throw new HealthcareError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Video service is currently unavailable. Please try again later or contact support.',
        HttpStatus.SERVICE_UNAVAILABLE,
        {
          note: 'No enabled video providers are available.',
        },
        operationName
      );
    }

    let lastError: unknown;
    for (const provider of providers) {
      try {
        const result = await executor(provider);
        this.provider = provider;
        return result;
      } catch (error) {
        lastError = error;
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Video provider '${provider.providerName}' failed during ${operationName}: ${error instanceof Error ? error.message : 'Unknown error'}. Trying next provider if available.`,
          operationName,
          {
            provider: provider.providerName,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new HealthcareError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'Video provider failed',
      undefined,
      { operation: operationName },
      operationName
    );
  }

  private isRecordingFeatureEnabled(): boolean {
    return this.configService.getEnvBoolean('VIDEO_RECORDING_ENABLED', false);
  }

  private async createRecordingRecord(args: {
    consultationId: string;
    recordingId: string;
    fileName: string;
    filePath: string;
    storageProvider: string;
  }): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const delegate = getVideoRecordingDelegate(client);
        return await delegate.create({
          data: {
            consultationId: args.consultationId,
            fileName: args.fileName,
            filePath: args.filePath,
            format: 'mp4',
            quality: '720p',
            storageProvider: args.storageProvider,
            isProcessed: false,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_VIDEO_RECORDING',
        resourceType: 'VIDEO_RECORDING',
        resourceId: args.recordingId,
        timestamp: new Date(),
      }
    );
  }

  private async updateConsultationRecordingReference(args: {
    consultationId: string;
    recordingId: string;
    recordingUrl?: string | undefined;
    duration?: number | undefined;
    isRecording?: boolean;
  }): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const delegate = getVideoConsultationDelegate(client);
        const updateData: {
          recordingId?: string;
          recordingUrl?: string | null;
          duration?: number;
          isRecording?: boolean;
        } = {};

        if (args.recordingId) {
          updateData.recordingId = args.recordingId;
        }
        if (args.recordingUrl !== undefined) {
          updateData.recordingUrl = args.recordingUrl ?? null;
        }
        if (args.duration !== undefined) {
          updateData.duration = args.duration;
        }
        if (args.isRecording !== undefined) {
          updateData.isRecording = args.isRecording;
        }

        return await delegate.update({
          where: { id: args.consultationId },
          data: updateData,
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_VIDEO_CONSULTATION',
        resourceType: 'VIDEO_CONSULTATION',
        resourceId: args.consultationId,
        timestamp: new Date(),
      }
    );
  }

  getCurrentProvider(): string | null {
    return this.provider?.providerName || null;
  }

  getFallbackProvider(): string | null {
    try {
      const fallback = this.providerFactory.getFallbackProvider();
      return fallback.providerName;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // CONSULTATION METHODS (Provider-based)
  // ============================================================================

  /**
   * Generate meeting token for video consultation
   *
   * @param caller - clinic and platform role of the requester (from the validated request).
   *   Required for the clinic-isolation check: without a clinic the call is rejected for every
   *   role except a SUPER_ADMIN `rawRole`.
   */
  async generateMeetingToken(
    appointmentId: string,
    userId: string,
    userRole: VideoCallerRole,
    userInfo: {
      displayName: string;
      email: string;
      avatar?: string;
    },
    caller?: VideoCallerContext
  ): Promise<VideoTokenResponse> {
    let resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      // 1. Validate appointment status and payment eligibility
      // Use executeRead to fetch appointment with necessary relations
      let appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);

      // Fallback: If the provided ID is actually a VideoConsultation ID
      if (!appointment) {
        const videoSession = await this.databaseService.executeHealthcareRead(async prisma => {
          const delegate = getVideoConsultationDelegate(prisma);
          return await delegate.findUnique({
            where: { id: resolvedAppointmentId },
          });
        });

        if (videoSession?.appointmentId) {
          resolvedAppointmentId = videoSession.appointmentId;
          appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);
        }
      }

      if (!appointment) {
        // Log both raw and resolved IDs to surface ID-mismatch issues immediately
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Appointment lookup failed – record not found`,
          'VideoService.generateMeetingToken',
          { rawAppointmentId: appointmentId, resolvedAppointmentId }
        );
        throw new HealthcareError(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          'No appointment found',
          HttpStatus.NOT_FOUND,
          { appointmentId: resolvedAppointmentId },
          'VideoService.generateMeetingToken'
        );
      }

      // 2. Authorise before revealing anything about the appointment (status, payment, window):
      // the caller must belong to the appointment's clinic and be a participant or clinic staff.
      await this.authorizeVideoCaller(appointment, userId, userRole, caller);

      this.ensureAppointmentJoinable(appointment, userRole);
      this.ensureWithinPatientJoinWindow(appointment, userRole);

      const preferredProvider = await this.resolveEffectivePreferredProvider(appointment);

      return await this.withProviderFallback(
        'VideoService.generateMeetingToken',
        provider =>
          provider.generateMeetingToken(resolvedAppointmentId, userId, userRole, userInfo),
        preferredProvider
      );
    } catch (error: unknown) {
      this.logLifecycleFailure('VideoService.generateMeetingToken', resolvedAppointmentId, error);
      throw this.toVideoLifecycleError(
        error,
        'VideoService.generateMeetingToken',
        resolvedAppointmentId,
        'Could not generate the video meeting token'
      );
    }
  }

  async rejectVideoAppointment(
    appointmentId: string,
    reason: string,
    userId: string,
    clinicId: string
  ): Promise<ServiceResponse<AppointmentWithRelations>> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    const rejectionReason = reason?.trim() || 'Doctor rejected proposed slots';

    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'delete',
      resourceId: resolvedAppointmentId,
    });

    if (!permissionCheck.hasPermission) {
      throw new ForbiddenException('Insufficient permissions to reject this video appointment');
    }

    const appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);
    if (!appointment || appointment.clinicId !== clinicId) {
      throw new NotFoundException('Appointment not found');
    }

    if (appointment.type !== 'VIDEO_CALL') {
      throw new BadRequestException('Only video appointments can be rejected');
    }

    const confirmedSlotIndex = (
      appointment as unknown as {
        confirmedSlotIndex?: number | null;
      }
    ).confirmedSlotIndex;
    const canRejectProposal = isVideoSlotAwaitingConfirmation({
      type: appointment.type,
      status: appointment.status,
      proposedSlots: (appointment as unknown as { proposedSlots?: unknown }).proposedSlots,
      confirmedSlotIndex,
    });
    if (!canRejectProposal) {
      throw new BadRequestException('Appointment is not in doctor slot confirmation stage');
    }

    const updatedAppointment = await this.databaseService.updateAppointmentSafe(
      resolvedAppointmentId,
      {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: rejectionReason,
        cancelledBy: userId,
        cancelledAt: new Date(),
      }
    );

    await this.cacheService.invalidateAppointmentCache(
      resolvedAppointmentId,
      updatedAppointment.patientId,
      updatedAppointment.doctorId,
      clinicId
    );

    await this.cancelAssociatedVideoSession(resolvedAppointmentId, {
      userId,
      userRole: 'DOCTOR',
      operation: 'REJECT_VIDEO_APPOINTMENT',
      resourceType: 'videoConsultation',
      resourceId: resolvedAppointmentId,
      clinicId,
    });

    // No refund: a visit that does not happen ends here and the patient books a new one.

    const appointmentRecord = updatedAppointment as unknown as Record<string, unknown>;
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
      (appointmentRecord['patient'] as Record<string, unknown> | undefined) || undefined;
    const doctorRecord =
      (appointmentRecord['doctor'] as Record<string, unknown> | undefined) || undefined;
    const patientUserRecord =
      (patientRecord?.['user'] as Record<string, unknown> | undefined) || undefined;
    const doctorUserRecord =
      (doctorRecord?.['user'] as Record<string, unknown> | undefined) || undefined;

    await this.eventService.emitEnterprise('appointment.cancelled', {
      eventId: `appointment-cancelled-${resolvedAppointmentId}-${Date.now()}`,
      eventType: 'appointment.cancelled',
      category: EventCategory.APPOINTMENT,
      priority: EventPriority.HIGH,
      timestamp: nowIso(),
      source: 'VideoService',
      version: '1.0.0',
      userId: updatedAppointment.patientId,
      clinicId,
      payload: {
        appointmentId: resolvedAppointmentId,
        userId: updatedAppointment.patientId,
        doctorId: updatedAppointment.doctorId,
        clinicId,
        patientName: resolvePersonName(patientUserRecord ?? patientRecord, 'Patient'),
        doctorName: resolvePersonName(doctorUserRecord ?? doctorRecord, 'Doctor'),
        appointmentType: updatedAppointment.type,
        appointmentDate: updatedAppointment.date,
        appointmentTime: updatedAppointment.time,
        reason: rejectionReason,
        cancelledBy: userId,
        status: AppointmentStatus.CANCELLED,
        appointment: updatedAppointment,
      },
    });

    await this.loggingService.log(
      LogType.APPOINTMENT,
      LogLevel.INFO,
      'Video appointment proposal rejected',
      'VideoService.rejectVideoAppointment',
      {
        appointmentId: resolvedAppointmentId,
        clinicId,
        userId,
      }
    );

    return {
      success: true,
      data: updatedAppointment,
      message: 'Video appointment proposal rejected successfully',
    };
  }

  async cancelAssociatedVideoSession(
    appointmentId: string,
    auditInfo: {
      userId: string;
      userRole: string;
      operation: string;
      resourceType: string;
      resourceId?: string;
      clinicId: string;
    }
  ): Promise<void> {
    try {
      await this.databaseService.executeHealthcareWrite(async client => {
        const delegate = getVideoConsultationDelegate(client);
        await delegate.updateMany({
          where: { appointmentId, status: { not: 'CANCELLED' } },
          data: { status: 'CANCELLED' },
        });
      }, auditInfo);

      await this.cacheService.del(`video_session:${appointmentId}`);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to cancel linked video session: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'VideoService.cancelAssociatedVideoSession',
        { appointmentId }
      );
    }
  }

  private ensureAppointmentJoinable(
    appointment: {
      id: string;
      clinicId: string;
      type?: string | null;
      status?: string | null;
      payment?: { status?: string | null } | Array<{ status?: string | null }> | null;
    },
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): void {
    const appointmentStatus = String(appointment.status || '').toUpperCase();
    const confirmedSlotIndex = (
      appointment as unknown as {
        confirmedSlotIndex?: number | null;
      }
    ).confirmedSlotIndex;

    // Blocked terminal states – surface specific reasons so the frontend can display the right message
    if (appointmentStatus === String(AppointmentStatus.CANCELLED)) {
      throw new NotFoundException('This appointment has been cancelled.');
    }
    if (appointmentStatus === String(AppointmentStatus.COMPLETED)) {
      throw new NotFoundException('This appointment has already been completed.');
    }
    if (appointmentStatus === String(AppointmentStatus.EXPIRED)) {
      throw new NotFoundException('This appointment has expired.');
    }
    if (
      this.configService.isVideoNoShowEnabled() &&
      appointmentStatus === String(AppointmentStatus.NO_SHOW)
    ) {
      throw new NotFoundException('This appointment was marked as no-show.');
    }

    // Unconfirmed slot – paid but doctor hasn't confirmed a time yet
    const awaitingConfirmation = isVideoSlotAwaitingConfirmation({
      type: appointment.type,
      status: appointment.status,
      proposedSlots: (appointment as unknown as { proposedSlots?: unknown }).proposedSlots,
      confirmedSlotIndex,
    });
    if (awaitingConfirmation) {
      throw new NotFoundException('This video request is awaiting slot confirmation.');
    }

    // SCHEDULED, CONFIRMED and IN_PROGRESS are joinable.
    // SCHEDULED is included because confirmVideoSlot sets the status to SCHEDULED
    // after the doctor selects a slot, and both participants need to join from that state.
    if (
      ![
        AppointmentStatus.SCHEDULED,
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.IN_PROGRESS,
      ].includes(appointmentStatus as AppointmentStatus)
    ) {
      throw new NotFoundException('This video request is awaiting slot confirmation.');
    }

    if (userRole !== 'patient') {
      return;
    }

    if (!isAppointmentPaid(appointment)) {
      throw new ForbiddenException('Payment is required before joining this video appointment.');
    }
  }

  /**
   * Patients may only join inside the join window (EARLY_JOIN minutes before the visit until the
   * active window after its start) - the same window getConsultationAccessState reports. Doctors,
   * nurses and admins are not gated so they can open the room early, as before.
   */
  private ensureWithinPatientJoinWindow(
    appointment: { date?: Date | string | null; time?: string | null; duration?: number | null },
    userRole: VideoCallerRole
  ): void {
    if (userRole !== 'patient') {
      return;
    }

    const scheduledWindow = this.resolveAppointmentVideoWindow(appointment);
    if (!scheduledWindow?.startTime || !scheduledWindow.endTime) {
      // No parseable schedule: same behaviour as the status endpoint (nothing to enforce).
      return;
    }

    const opensAt =
      scheduledWindow.startTime.getTime() - VideoService.VIDEO_EARLY_JOIN_MINUTES * 60_000;
    const closesAt = scheduledWindow.endTime.getTime();
    const now = Date.now();
    if (now < opensAt || now > closesAt) {
      throw new ForbiddenException(VideoService.joinWindowMessage());
    }
  }

  async getConsultationAccessState(
    appointmentId: string,
    accessContext?: VideoSessionAccessContext
  ): Promise<VideoConsultationAccessState> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    const appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);

    if (!appointment) {
      return {
        appointmentId: resolvedAppointmentId,
        canJoin: false,
        paymentRequired: false,
        paymentCompleted: false,
        joinBlockedReason: 'This video appointment is no longer available.',
        appointmentStatus: 'NOT_FOUND',
        scheduledStartTime: null,
        scheduledEndTime: null,
        joinWindowStart: null,
        joinWindowEnd: null,
      };
    }

    const appointmentStatus = String(appointment.status || '').toUpperCase();
    const paymentCompleted = isAppointmentPaid(appointment as AppointmentPaymentLike);
    const paymentRequired =
      String(appointment.type || '').toUpperCase() === 'VIDEO_CALL' && !paymentCompleted;
    const scheduledWindow = this.resolveAppointmentVideoWindow(appointment);
    const joinWindowStart = scheduledWindow?.startTime
      ? new Date(
          scheduledWindow.startTime.getTime() - VideoService.VIDEO_EARLY_JOIN_MINUTES * 60_000
        )
      : null;
    const joinWindowEnd = scheduledWindow?.endTime ?? null;
    const confirmedSlotIndex = (
      appointment as unknown as {
        confirmedSlotIndex?: number | null;
      }
    ).confirmedSlotIndex;

    let joinBlockedReason: string | null = null;

    if (appointmentStatus === String(AppointmentStatus.CANCELLED)) {
      joinBlockedReason = 'This appointment has been cancelled.';
    } else if (appointmentStatus === String(AppointmentStatus.COMPLETED)) {
      joinBlockedReason = 'This appointment has already been completed.';
    } else if (appointmentStatus === String(AppointmentStatus.EXPIRED)) {
      joinBlockedReason = 'This appointment has expired.';
    } else if (
      this.configService.isVideoNoShowEnabled() &&
      appointmentStatus === String(AppointmentStatus.NO_SHOW)
    ) {
      joinBlockedReason = 'This appointment was marked as no-show.';
    } else if (
      isVideoSlotAwaitingConfirmation({
        type: appointment.type,
        status: appointment.status,
        proposedSlots: (appointment as unknown as { proposedSlots?: unknown }).proposedSlots,
        confirmedSlotIndex,
      })
    ) {
      joinBlockedReason = 'This video request is awaiting slot confirmation.';
    } else if (
      // The controller passes the platform role ('PATIENT'); the lifecycle code uses 'patient'.
      String(accessContext?.userRole ?? '').toLowerCase() === 'patient' &&
      paymentRequired &&
      !paymentCompleted
    ) {
      joinBlockedReason = 'Payment is required before joining this video appointment.';
    } else if (joinWindowStart && joinWindowEnd) {
      const now = new Date();
      if (now < joinWindowStart || now > joinWindowEnd) {
        joinBlockedReason = VideoService.joinWindowMessage();
      }
    }

    return {
      appointmentId: resolvedAppointmentId,
      canJoin: !joinBlockedReason,
      paymentRequired,
      paymentCompleted,
      joinBlockedReason,
      appointmentStatus,
      scheduledStartTime: scheduledWindow?.startTime ?? null,
      scheduledEndTime: scheduledWindow?.endTime ?? null,
      joinWindowStart,
      joinWindowEnd,
    };
  }

  private buildPlaceholderConsultationSession(
    appointment: {
      id: string;
      date?: Date | string | null;
      time?: string | null;
      duration?: number | null;
    } & Partial<AppointmentVideoNameSource>
  ): VideoConsultationSession {
    const scheduledWindow = this.resolveAppointmentVideoWindow(appointment);
    const participantNames = this.resolveAppointmentParticipantNames(appointment);
    return {
      id: `video-session-${appointment.id}`,
      appointmentId: appointment.id,
      roomId: `appointment-${appointment.id}`,
      roomName: `appointment-${appointment.id}`,
      meetingUrl: `/video-appointments/${appointment.id}`,
      patientName: participantNames.patientName,
      doctorName: participantNames.doctorName,
      status: 'SCHEDULED',
      startTime: scheduledWindow?.startTime ?? null,
      endTime: scheduledWindow?.endTime ?? null,
      participants: [],
      recordingEnabled: false,
      screenSharingEnabled: true,
      chatEnabled: true,
      waitingRoomEnabled: true,
    };
  }

  private resolveAppointmentParticipantNames(
    appointment: AppointmentVideoNameSource | null | undefined
  ): { patientName: string; doctorName: string } {
    const appointmentRecord = appointment as unknown as Record<string, unknown> | null | undefined;
    const resolveText = (value: unknown, fallback: string): string =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

    const getNestedName = (candidate: unknown): string | undefined => {
      if (!candidate || typeof candidate !== 'object') {
        return undefined;
      }
      const candidateRecord = candidate as Record<string, unknown>;
      const userRecord =
        candidateRecord['user'] && typeof candidateRecord['user'] === 'object'
          ? (candidateRecord['user'] as Record<string, unknown>)
          : undefined;
      const userName = typeof userRecord?.['name'] === 'string' ? userRecord['name'] : undefined;
      const directName =
        typeof candidateRecord['name'] === 'string' ? candidateRecord['name'] : undefined;
      return userName ?? directName;
    };

    const patientRecord =
      appointmentRecord?.['patient'] && typeof appointmentRecord['patient'] === 'object'
        ? (appointmentRecord['patient'] as Record<string, unknown>)
        : undefined;
    const doctorRecord =
      appointmentRecord?.['doctor'] && typeof appointmentRecord['doctor'] === 'object'
        ? (appointmentRecord['doctor'] as Record<string, unknown>)
        : undefined;

    const patientName = resolveText(
      getNestedName(patientRecord) ??
        (typeof appointmentRecord?.['patientName'] === 'string'
          ? appointmentRecord['patientName']
          : undefined) ??
        (typeof appointmentRecord?.['clientName'] === 'string'
          ? appointmentRecord['clientName']
          : undefined),
      'Patient'
    );

    const doctorName = resolveText(
      getNestedName(doctorRecord) ??
        (typeof appointmentRecord?.['doctorName'] === 'string'
          ? appointmentRecord['doctorName']
          : undefined),
      'Doctor'
    );

    return { patientName, doctorName };
  }

  private attachAppointmentNamesToSession(
    session: VideoConsultationSession,
    appointment: AppointmentVideoNameSource | null | undefined
  ): VideoConsultationSession {
    const participantNames = this.resolveAppointmentParticipantNames(appointment);
    return {
      ...session,
      patientName: session.patientName ?? participantNames.patientName,
      doctorName: session.doctorName ?? participantNames.doctorName,
    };
  }

  private resolveAppointmentVideoWindow(appointment: {
    date?: Date | string | null;
    time?: string | null;
    duration?: number | null;
  }): { startTime: Date | null; endTime: Date | null } | null {
    const startTime = parseIstDateTime(
      appointment.date ?? undefined,
      appointment.time ?? undefined
    );
    if (!startTime) {
      return null;
    }

    const endTime = new Date(
      startTime.getTime() + VideoService.VIDEO_ACTIVE_WINDOW_MINUTES * 60_000
    );
    return { startTime, endTime };
  }

  /** The one sentence about the join window; its numbers come from the two window settings. */
  private static joinWindowMessage(): string {
    const late = VideoService.VIDEO_ACTIVE_WINDOW_MINUTES;
    const lateText =
      late % 60 === 0 ? `${late / 60} ${late === 60 ? 'hour' : 'hours'}` : `${late} minutes`;
    return `Join opens ${VideoService.VIDEO_EARLY_JOIN_MINUTES} minutes before your visit and stays open for ${lateText} after start.`;
  }

  // ============================================================================
  // Post-call summary & rating
  // ============================================================================

  private async loadAppointmentForSummary(appointmentId: string) {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    const userSelect = { select: { id: true, name: true, firstName: true, lastName: true } };
    const appointment = await this.databaseService.executeRead(async prisma => {
      const tx = prisma as unknown as Prisma.TransactionClient;
      return await tx.appointment.findUnique({
        where: { id: resolvedAppointmentId },
        include: {
          patient: { include: { user: userSelect } },
          doctor: { include: { user: userSelect } },
        },
      });
    });
    if (!appointment) {
      throw new HealthcareError(
        ErrorCode.APPOINTMENT_NOT_FOUND,
        'No appointment found',
        HttpStatus.NOT_FOUND,
        { appointmentId: resolvedAppointmentId },
        'VideoService.loadAppointmentForSummary'
      );
    }
    return appointment as unknown as ConsultationSummaryAppointment;
  }

  private displayName(
    user:
      | { name?: string | null; firstName?: string | null; lastName?: string | null }
      | null
      | undefined,
    fallback: string
  ): string {
    const full = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();
    return (user?.name && user.name.trim()) || full || fallback;
  }

  /**
   * Summary of a video consultation: appointment info, doctor/patient names,
   * actual start/end/duration from the VideoConsultation row, and any rating.
   *
   * The caller is authorised with the same rules as joining, starting and ending the call
   * (`authorizeVideoCaller`): the patient, the account that booked it and the owner of the family
   * dependent it is for, the appointment's doctor (or an assistant of its clinic) and clinic
   * admins. Another clinic's appointment answers 404, a non-participant 403.
   */
  async getConsultationSummary(
    appointmentId: string,
    userId: string,
    userRole: VideoCallerRole,
    caller?: VideoCallerContext
  ): Promise<{
    appointmentId: string;
    consultationId: string | null;
    status: string;
    appointmentStatus: string;
    appointmentDate: string;
    appointmentTime: string;
    scheduledDurationMinutes: number;
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number;
    doctorName: string;
    doctorSpecialization: string | null;
    patientName: string;
    participants: Array<{ userId: string; name: string; role: string }>;
    rating: { average: number; count: number } | null;
    myRating: { rating: number; comment?: string; ratedAt: string } | null;
  }> {
    const appointment = await this.loadAppointmentForSummary(appointmentId);
    await this.authorizeVideoCaller(appointment, userId, userRole, caller);

    const consultation = await this.databaseService.executeHealthcareRead(async prisma => {
      const delegate = getVideoConsultationDelegate(prisma);
      return await delegate.findFirst({ where: { appointmentId: appointment.id } });
    });

    const start = consultation?.startTime ? new Date(consultation.startTime) : null;
    const end = consultation?.endTime ? new Date(consultation.endTime) : null;
    let durationSeconds = 0;
    if (typeof consultation?.duration === 'number' && consultation.duration > 0) {
      durationSeconds = consultation.duration;
    } else if (start && end) {
      durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
    }

    const doctorName = this.displayName(appointment.doctor?.user, 'Doctor');
    const patientName = this.displayName(appointment.patient?.user, 'Patient');
    const metadata =
      appointment.metadata && typeof appointment.metadata === 'object'
        ? (appointment.metadata as Record<string, unknown>)
        : {};
    const storedRating = metadata['consultationRating'] as
      { rating?: number; comment?: string; ratedAt?: string } | undefined;
    const myRating =
      storedRating && typeof storedRating.rating === 'number'
        ? {
            rating: storedRating.rating,
            ...(storedRating.comment ? { comment: storedRating.comment } : {}),
            ratedAt: storedRating.ratedAt || '',
          }
        : null;

    return {
      appointmentId: appointment.id,
      consultationId: consultation?.id ?? null,
      status: String(consultation?.status || appointment.status || '').toLowerCase(),
      appointmentStatus: String(appointment.status),
      appointmentDate: new Date(appointment.date).toISOString(),
      appointmentTime: appointment.time,
      scheduledDurationMinutes: appointment.duration,
      startTime: start ? start.toISOString() : null,
      endTime: end ? end.toISOString() : null,
      durationSeconds,
      doctorName,
      doctorSpecialization: appointment.doctor?.specialization ?? null,
      patientName,
      participants: [
        ...(appointment.doctor
          ? [{ userId: appointment.doctor.userId, name: doctorName, role: 'doctor' }]
          : []),
        ...(appointment.patient
          ? [{ userId: appointment.patient.userId, name: patientName, role: 'patient' }]
          : []),
      ],
      rating: myRating ? { average: myRating.rating, count: 1 } : null,
      myRating,
    };
  }

  /**
   * Store the patient's rating for a consultation. Persisted as a Review row
   * (doctor ratings/analytics) and mirrored in appointment.metadata.consultationRating
   * so a repeat submission updates the same review.
   *
   * The caller is authorised BEFORE the lock is taken, so someone who is not a participant can
   * neither rate nor make the real patient's submission fail with 409 by holding the lock. A
   * per-appointment cache lock then serialises submissions: two concurrent submits would
   * otherwise both create a Review.
   */
  async rateConsultation(
    appointmentId: string,
    userId: string,
    rating: number,
    comment?: string,
    clinicId?: string
  ): Promise<{ success: boolean; rating: number; comment?: string; reviewId: string }> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    const appointment = await this.authorizeConsultationRating(
      resolvedAppointmentId,
      userId,
      clinicId
    );

    const lockKey = `video:rate:${resolvedAppointmentId}`;
    const acquired = await this.cacheService.acquireLock(
      lockKey,
      VideoService.RATING_LOCK_TTL_SECONDS
    );
    if (!acquired) {
      throw new ConflictException('Your rating is already being submitted. Please try again.');
    }

    try {
      return await this.submitConsultationRating(appointment, userId, rating, comment);
    } finally {
      try {
        await this.cacheService.releaseLock(lockKey);
      } catch (releaseError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Failed to release rating lock: ${extractErrorMessage(releaseError) ?? 'Unknown error'}`,
          'VideoService.rateConsultation',
          { appointmentId: resolvedAppointmentId }
        );
      }
    }
  }

  /**
   * Load the appointment and check the caller may rate it: the appointment's patient, the account
   * that booked it or the owner of the family dependent it is for (the same rules as joining the
   * call). Another clinic's appointment must look like it does not exist (404), a non-participant
   * gets 403, and only video visits can be rated.
   */
  private async authorizeConsultationRating(
    appointmentId: string,
    userId: string,
    clinicId: string | undefined
  ): Promise<ConsultationSummaryAppointment> {
    const appointment = await this.loadAppointmentForSummary(appointmentId);
    await this.authorizeVideoCaller(appointment, userId, 'patient', {
      clinicId,
      rawRole: Role.PATIENT,
    });
    if (String(appointment.type).toUpperCase() !== 'VIDEO_CALL') {
      throw new BadRequestException('Only video consultations can be rated here.');
    }
    return appointment;
  }

  private async submitConsultationRating(
    appointment: ConsultationSummaryAppointment,
    userId: string,
    rating: number,
    comment: string | undefined
  ): Promise<{ success: boolean; rating: number; comment?: string; reviewId: string }> {
    const status = String(appointment.status).toUpperCase();
    if (!['COMPLETED', 'IN_PROGRESS'].includes(status)) {
      throw new BadRequestException('You can rate a consultation once it has taken place.');
    }

    const value = Math.round(Math.min(5, Math.max(1, Number(rating))));
    const trimmedComment = comment?.trim() || undefined;

    const reviewId = await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;

        // Read the metadata again inside the lock and change only the one key, instead of
        // writing back a snapshot taken at the start of the request.
        const fresh = await tx.appointment.findUnique({
          where: { id: appointment.id },
          select: { metadata: true },
        });
        const currentMetadata =
          fresh?.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
            ? (fresh.metadata as Record<string, unknown>)
            : {};
        const previous = currentMetadata['consultationRating'] as { reviewId?: string } | undefined;

        let review: { id: string } | null = null;
        if (previous?.reviewId) {
          review = await tx.review
            .update({
              where: { id: previous.reviewId },
              data: { rating: value, comment: trimmedComment ?? null },
            })
            .catch(() => null);
        }
        if (!review) {
          review = await tx.review.create({
            data: {
              rating: value,
              comment: trimmedComment ?? null,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              clinicId: appointment.clinicId,
            },
          });
        }

        const patchedMetadata: Record<string, unknown> = {
          ...currentMetadata,
          consultationRating: {
            reviewId: review.id,
            rating: value,
            ...(trimmedComment ? { comment: trimmedComment } : {}),
            ratedBy: userId,
            ratedAt: new Date().toISOString(),
          },
        };
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { metadata: patchedMetadata as Prisma.InputJsonValue },
        });
        return review.id;
      },
      {
        userId,
        userRole: 'PATIENT',
        clinicId: appointment.clinicId,
        operation: 'RATE_VIDEO_CONSULTATION',
        resourceType: 'APPOINTMENT',
        resourceId: appointment.id,
        timestamp: new Date(),
      }
    );

    return {
      success: true,
      rating: value,
      ...(trimmedComment ? { comment: trimmedComment } : {}),
      reviewId,
    };
  }

  // ============================================================================
  // Lifecycle authorization & error mapping
  // ============================================================================

  /**
   * Authorise a caller for a video appointment (clinic isolation + participant/staff rules).
   * All the role logic lives in assertParticipantOrClinicStaff; this only resolves the one fact
   * that needs the database: whether the caller owns the family dependent the visit is for.
   */
  private async authorizeVideoCaller(
    appointment: VideoAccessAppointment & {
      patientId?: string | null | undefined;
      familyMemberId?: string | null | undefined;
    },
    userId: string,
    role: VideoCallerRole,
    caller?: VideoCallerContext
  ): Promise<void> {
    const mayOwnDependent =
      role === 'patient' &&
      Boolean(appointment.familyMemberId) &&
      Boolean(appointment.patientId) &&
      appointment.clinicId === caller?.clinicId &&
      !isPatientOwner(appointment, userId);
    const ownsFamilyMember = mayOwnDependent
      ? await isFamilyMemberOwner(
          this.databaseService,
          String(appointment.familyMemberId),
          String(appointment.patientId),
          userId
        )
      : false;

    assertParticipantOrClinicStaff(appointment, {
      userId,
      role,
      clinicId: caller?.clinicId,
      rawRole: caller?.rawRole,
      ownsFamilyMember,
    });
  }

  /**
   * The booking account to notify next to the patient (see resolveVideoBookerUserId): never the
   * doctor, a receptionist or any other staff user who happened to create the appointment. A
   * failed lookup only costs the booker's notification, never the lifecycle step it follows.
   */
  private async resolveBookerForNotification(
    appointment: VideoBookerAppointment & { id: string }
  ): Promise<string | undefined> {
    try {
      return await resolveVideoBookerUserId(this.databaseService, appointment);
    } catch (error: unknown) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Could not resolve the booking account for a video notification: ${extractErrorMessage(error) ?? 'Unknown error'}`,
        'VideoService.resolveBookerForNotification',
        { appointmentId: appointment.id }
      );
      return undefined;
    }
  }

  /**
   * Authorise a caller for the appointment behind an appointment id OR a consultation id
   * (optionally written `video-session-<id>`), the two identifiers the video endpoints accept.
   *
   * Every video endpoint addressed by such an id calls this BEFORE it reads or writes anything, so
   * access never rests on the RBAC `video:*` permission alone (which every PATIENT holds).
   * Applies the same rules as token/start/end/leave: other clinic -> 404, not a participant -> 403.
   *
   * @returns the resolved appointment id (and the consultation id when the id was one)
   * @throws NotFoundException when no appointment can be resolved or it belongs to another clinic
   * @throws ForbiddenException when the caller is not a participant or authorised clinic staff
   */
  async authorizeConsultationAccess(
    appointmentOrConsultationId: string,
    userId: string,
    userRole: VideoCallerRole,
    caller?: VideoCallerContext
  ): Promise<{ appointmentId: string; consultationId: string | null }> {
    const requestedId = normalizeAppointmentId(
      String(appointmentOrConsultationId ?? '').replace(/^video-session-/, '')
    );

    try {
      if (!requestedId) {
        throw new NotFoundException('Appointment not found');
      }

      // One lookup answers both id kinds: a consultation row (matched by its id or its appointment)
      // names the appointment; without a row the id is taken to be the appointment id itself.
      const consultation = await this.databaseService.executeHealthcareRead(async prisma => {
        const delegate = getVideoConsultationDelegate(prisma);
        return await delegate.findFirst({
          where: { OR: [{ id: requestedId }, { appointmentId: requestedId }] },
        });
      });
      const appointmentId = consultation?.appointmentId ?? requestedId;

      const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      await this.authorizeVideoCaller(appointment, userId, userRole, caller);
      return { appointmentId: appointment.id, consultationId: consultation?.id ?? null };
    } catch (error: unknown) {
      this.logLifecycleFailure('VideoService.authorizeConsultationAccess', requestedId, error);
      throw this.toVideoLifecycleError(
        error,
        'VideoService.authorizeConsultationAccess',
        requestedId,
        'Could not verify access to the video consultation'
      );
    }
  }

  /**
   * Log a lifecycle failure. The raw message and stack go to the logger only; expected client
   * errors (4xx) are logged as warnings, everything else as errors.
   */
  private logLifecycleFailure(context: string, appointmentId: string, error: unknown): void {
    const isClientError =
      error instanceof HttpException && error.getStatus() < SERVER_ERROR_STATUS_MIN;
    void this.loggingService.log(
      LogType.SYSTEM,
      isClientError ? LogLevel.WARN : LogLevel.ERROR,
      `Video lifecycle request failed: ${extractErrorMessage(error) ?? 'Unknown error'}`,
      context,
      {
        appointmentId,
        provider: this.provider?.providerName ?? 'unknown',
        error: extractErrorMessage(error) ?? 'Unknown error',
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      }
    );
  }

  /**
   * Map an error thrown while running a consultation lifecycle step to what the client sees.
   *
   * - HTTP errors below 500 (NotFound/Forbidden/BadRequest/Conflict, including HealthcareError
   *   with such a status) are intentional and pass through untouched.
   * - A recognised "provider unavailable / timed out" error becomes a 503.
   * - Everything else (Prisma, TypeError, wrapped DB errors, ...) becomes a plain 500.
   *
   * The client message is always a fixed string chosen by the caller. The raw message, stack and
   * metadata of the original error are never copied into the response: they are logged by
   * `logLifecycleFailure`.
   */
  private toVideoLifecycleError(
    error: unknown,
    context: string,
    appointmentId: string,
    fallbackMessage: string
  ): Error {
    if (error instanceof HttpException && error.getStatus() < SERVER_ERROR_STATUS_MIN) {
      return error;
    }

    if (isProviderUnavailableError(error)) {
      return new HealthcareError(
        ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
        `${fallbackMessage}. The video service is temporarily unavailable, please try again shortly.`,
        HttpStatus.SERVICE_UNAVAILABLE,
        { appointmentId },
        context
      );
    }

    return new HealthcareError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      fallbackMessage,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { appointmentId },
      context
    );
  }

  /** Uncached read of an appointment with what the lifecycle checks need. */
  private async loadAppointmentForLifecycle(appointmentId: string) {
    return await this.databaseService.executeRead(async prisma => {
      const tx = prisma as unknown as Prisma.TransactionClient;
      return await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          payment: true,
          patient: true,
          doctor: true,
        },
      });
    });
  }

  /**
   * Start consultation session
   */
  async startConsultation(
    appointmentId: string,
    userId: string,
    userRole: VideoCallerRole,
    caller?: VideoCallerContext
  ): Promise<VideoConsultationSession> {
    let resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      let appointment = await this.loadAppointmentForLifecycle(resolvedAppointmentId);

      // Fallback: If the provided ID is actually a VideoConsultation ID
      if (!appointment) {
        const videoSession = await this.databaseService.executeHealthcareRead(async prisma => {
          const delegate = getVideoConsultationDelegate(prisma);
          return await delegate.findUnique({
            where: { id: resolvedAppointmentId },
          });
        });

        if (videoSession?.appointmentId) {
          resolvedAppointmentId = videoSession.appointmentId;
          appointment = await this.loadAppointmentForLifecycle(resolvedAppointmentId);
        }
      }

      if (!appointment) {
        throw new HealthcareError(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          'No appointment found',
          HttpStatus.NOT_FOUND,
          { appointmentId: resolvedAppointmentId },
          'VideoService.startConsultation'
        );
      }

      await this.authorizeVideoCaller(appointment, userId, userRole, caller);
      this.ensureAppointmentJoinable(appointment, userRole);
      this.ensureWithinPatientJoinWindow(appointment, userRole);

      const session: VideoConsultationSession = await this.withProviderFallback(
        'VideoService.startConsultation',
        provider => provider.startConsultation(resolvedAppointmentId, userId, userRole)
      );

      // Anyone allowed in can open and join the call once the join window is open (15 minutes
      // before the visit): a confirmed patient does not need the doctor to be there first.
      // Only the appointment STATUS waits for the doctor. It becomes IN_PROGRESS when the
      // doctor joins; a patient (or front-desk staff) alone in the room leaves it CONFIRMED,
      // so the visit can still be rescheduled if the doctor never comes.
      // Only the doctor's FIRST start tells the patient, and the database decides which start is
      // the first: the conditional `startedAt` stamp is the claim, so two devices or a double tap
      // notify once and a failed stamp does not re-notify on every rejoin.
      const firstDoctorStart =
        userRole === 'doctor'
          ? await this.markAppointmentStartedByDoctor(appointment, userId)
          : false;
      // Only a first start notifies, so only then does the booking account have to be resolved.
      const bookerUserId = firstDoctorStart
        ? await this.resolveBookerForNotification(appointment)
        : undefined;

      // Emit event. The envelope carries who to notify (the notification rule reads `userId`
      // and `metadata`, never `payload`); the listener tells the patient only when the doctor
      // starts, so a rejoin or a patient opening the room does not notify anyone.
      const now: number = Date.now();
      const timestamp: string = new Date(now).toISOString();
      await this.eventService.emitEnterprise('video.consultation.started', {
        eventId: `video-consultation-started-${resolvedAppointmentId}-${now}`,
        eventType: 'video.consultation.started',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp,
        source: 'VideoService',
        version: '1.0.0',
        ...buildVideoLifecycleRouting(
          appointment,
          { actorRole: userRole, firstStart: firstDoctorStart },
          bookerUserId
        ),
        payload: {
          appointmentId: resolvedAppointmentId,
          sessionId: session.id,
          userId,
          userRole,
          provider: this.provider?.providerName ?? 'unknown',
        },
      });

      return this.attachAppointmentNamesToSession(session, appointment);
    } catch (error: unknown) {
      this.logLifecycleFailure('VideoService.startConsultation', resolvedAppointmentId, error);
      throw this.toVideoLifecycleError(
        error,
        'VideoService.startConsultation',
        resolvedAppointmentId,
        'Could not start the video consultation'
      );
    }
  }

  /**
   * The doctor opened the call: move the appointment to IN_PROGRESS and stamp `startedAt` once
   * (the scheduler's "visit began" reminder logic reads it). The stamp is the claim of the
   * doctor's first start (see claimDoctorStart); both writes are conditional on the appointment
   * still being open and scoped to its clinic.
   *
   * A visit that is not paid for stays as it is: the doctor may open the room (doctors are not
   * payment-gated for joining), but the status never flips, so the visit cannot be completed
   * through the end route either.
   *
   * Non-fatal on purpose: the video session is already live, so a failed status transition must
   * not turn a successful start into an error.
   *
   * @returns true only when this call was the doctor's first start of the visit
   */
  private async markAppointmentStartedByDoctor(
    appointment: {
      id: string;
      clinicId: string;
      patientId: string;
      doctorId: string;
      status: unknown;
      startedAt?: Date | null;
    } & AppointmentPaymentLike,
    userId: string
  ): Promise<boolean> {
    if (!isAppointmentPaid(appointment)) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctor opened the call of an unpaid video visit; the appointment status is unchanged',
        'VideoService.startConsultation',
        { appointmentId: appointment.id }
      );
      return false;
    }

    try {
      const outcome = await claimDoctorStart(
        this.databaseService,
        appointment,
        userId,
        VideoService.CONSULTATION_OPEN_STATUSES
      );
      if (outcome.changed) {
        await this.invalidateAppointmentCacheQuietly(appointment);
      }
      return outcome.firstStart;
    } catch (statusError) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to mark appointment IN_PROGRESS: ${extractErrorMessage(statusError) ?? 'Unknown error'}`,
        'VideoService.startConsultation',
        { appointmentId: appointment.id }
      );
      return false;
    }
  }

  /**
   * Someone who cannot complete the visit used the end route (anyone but the appointment's doctor
   * or a clinic admin). The consultation stays open for them to finish.
   *
   * - A PATIENT (or the account that booked / the owner of the dependent) is leaving the call:
   *   this only records the leave and returns the current session, so clients that call the end
   *   route as "leave" keep working.
   * - Front-desk staff, nurses and a SUPER_ADMIN cannot end the consultation: 403, instead of the
   *   old "success" that changed nothing. A SUPER_ADMIN who must close a running call uses
   *   `terminateConsultation`.
   *
   * Authorisation comes first for every role, so another clinic's appointment still answers 404.
   */
  private async recordParticipantLeftConsultation(
    appointmentId: string,
    userId: string,
    userRole: VideoCallerRole,
    caller?: VideoCallerContext
  ): Promise<VideoConsultationSession> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment) {
      throw new HealthcareError(
        ErrorCode.APPOINTMENT_NOT_FOUND,
        'No appointment found',
        HttpStatus.NOT_FOUND,
        { appointmentId },
        'VideoService.endConsultation'
      );
    }

    await this.authorizeVideoCaller(appointment, userId, userRole, caller);

    if (userRole !== 'patient') {
      throw new ForbiddenException(VIDEO_END_FORBIDDEN_MESSAGE);
    }

    const session: VideoConsultationSession =
      (await this.getConsultationSession(appointmentId)) ??
      this.buildPlaceholderConsultationSession(
        appointment as unknown as Parameters<VideoService['buildPlaceholderConsultationSession']>[0]
      );

    void this.loggingService.log(
      LogType.APPOINTMENT,
      LogLevel.INFO,
      `Participant (${userRole}) left video consultation for appointment ${appointmentId}`,
      'VideoService.endConsultation',
      { appointmentId, userId, userRole, sessionId: session.id }
    );

    const now: number = Date.now();
    await this.eventService.emitEnterprise('video.consultation.participant.left', {
      eventId: `video-consultation-participant-left-${appointmentId}-${now}`,
      eventType: 'video.consultation.participant.left',
      category: EventCategory.SYSTEM,
      priority: EventPriority.NORMAL,
      timestamp: new Date(now).toISOString(),
      source: 'VideoService',
      version: '1.0.0',
      payload: {
        appointmentId,
        sessionId: session.id,
        userId,
        userRole,
        provider: this.provider?.providerName ?? 'unknown',
      },
    });

    return session;
  }

  /**
   * End consultation session
   *
   * Only the appointment's own doctor, or a CLINIC_ADMIN of the appointment's clinic, completes
   * the visit (an admin's completion is written to the audit log with the admin's id and role).
   * A patient calling this is recorded as leaving; every other role (assistant doctor, nurse,
   * receptionist, SUPER_ADMIN) gets 403, and another clinic's appointment 404. The visit must have
   * STARTED (IN_PROGRESS): a CONFIRMED or SCHEDULED one answers 409 "has not started", the same
   * contract AppointmentsService.completeAppointment applies.
   *
   * Completing is idempotent: an already COMPLETED appointment is returned as-is and no event is
   * emitted again, except that a completion event that could not be announced earlier (see
   * emitAppointmentCompleted) is announced exactly once by the next end request.
   */
  async endConsultation(
    appointmentId: string,
    userId: string,
    userRole: VideoCallerRole,
    sessionNotes?: string,
    caller?: VideoCallerContext
  ): Promise<VideoConsultationSession> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      // Only the doctor (or a clinic admin) ends the session and completes the visit. A patient
      // leaving the call is recorded as a leave (the visit stays open); any other role is
      // rejected.
      const callerRole = String(userRole).toLowerCase();
      const canCompleteVisit =
        callerRole === 'doctor' ||
        (callerRole === 'clinic_admin' && isClinicAdminRole(caller?.rawRole));
      if (!canCompleteVisit) {
        return await this.recordParticipantLeftConsultation(
          resolvedAppointmentId,
          userId,
          userRole,
          caller
        );
      }

      const appointment = await this.loadAppointmentForLifecycle(resolvedAppointmentId);
      if (!appointment) {
        throw new HealthcareError(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          'No appointment found',
          HttpStatus.NOT_FOUND,
          { appointmentId: resolvedAppointmentId },
          'VideoService.endConsultation'
        );
      }

      await this.authorizeVideoCaller(appointment, userId, userRole, caller);

      // Authorised for the appointment is not enough: an assistant doctor (or a therapist who is
      // not this appointment's doctor) may join but may not complete it.
      const completionActor = resolveVideoCompletionActor(appointment, {
        userId,
        role: userRole,
        rawRole: caller?.rawRole,
      });
      if (!completionActor) {
        throw new ForbiddenException(VIDEO_END_FORBIDDEN_MESSAGE);
      }

      const appointmentStatus = String(appointment.status).toUpperCase();
      if (appointmentStatus === String(AppointmentStatus.COMPLETED)) {
        await this.reconcilePendingCompletionEvent(appointment, userId);
        return await this.buildAlreadyCompletedSession(appointment);
      }
      if (
        appointmentStatus !== String(AppointmentStatus.IN_PROGRESS) &&
        appointmentStatus !== String(AppointmentStatus.CONFIRMED)
      ) {
        throw VideoService.consultationNotEndableError(appointmentStatus);
      }

      let session: VideoConsultationSession;
      try {
        session = await this.withProviderFallback('VideoService.endConsultation', provider =>
          provider.endConsultation(resolvedAppointmentId, userId, userRole)
        );
      } catch (providerError) {
        // No VideoConsultation row (the call never reached the provider): the authorised
        // doctor can still close the visit, so describe the appointment instead of failing.
        // Any other provider failure is a real failure and is rethrown.
        const existing = await this.databaseService.executeHealthcareRead(async prisma => {
          const delegate = getVideoConsultationDelegate(prisma);
          return await delegate.findFirst({ where: { appointmentId: resolvedAppointmentId } });
        });
        if (existing) {
          throw providerError;
        }
        session = {
          ...this.buildPlaceholderConsultationSession(appointment),
          status: 'COMPLETED',
          endTime: new Date(),
        };
      }

      // Save session notes if provided
      if (sessionNotes) {
        // Session notes can be saved to database or added to session metadata
        // Implementation can be extended here
      }

      // Calculate duration
      let duration: number | undefined;
      if (session.startTime && session.endTime) {
        const startTimeMs: number = new Date(session.startTime).getTime();
        const endTimeMs: number = new Date(session.endTime).getTime();
        if (Number.isFinite(startTimeMs) && Number.isFinite(endTimeMs)) {
          duration = Math.max(0, Math.floor((endTimeMs - startTimeMs) / 1000));
        }
      }

      // Transition the Appointment to COMPLETED. This write is NOT best-effort: if it fails the
      // request fails, so the doctor never sees "ended" for a visit that is still open.
      const completion = await this.completeAppointmentOnEnd(appointment, userId, completionActor);
      if (completion === 'already_completed') {
        // A concurrent request completed it first and already emitted the events.
        return session;
      }
      if (completionActor === 'clinic_admin') {
        this.auditAdminCompletion(appointment, userId);
      }

      // Emit event. The envelope carries who to notify (the patient and, when different and
      // eligible, the account that booked the visit); the notification rule reads `userId` and
      // `metadata`.
      const bookerUserId = await this.resolveBookerForNotification(appointment);
      const now: number = Date.now();
      const timestamp: string = new Date(now).toISOString();
      await this.eventService.emitEnterprise('video.consultation.ended', {
        eventId: `video-consultation-ended-${resolvedAppointmentId}-${now}`,
        eventType: 'video.consultation.ended',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp,
        source: 'VideoService',
        version: '1.0.0',
        ...buildVideoLifecycleRouting(appointment, { actorRole: userRole }, bookerUserId),
        payload: {
          appointmentId: resolvedAppointmentId,
          sessionId: session.id,
          duration,
          provider: this.provider?.providerName ?? 'unknown',
        },
      });

      return session;
    } catch (error: unknown) {
      this.logLifecycleFailure('VideoService.endConsultation', resolvedAppointmentId, error);
      throw this.toVideoLifecycleError(
        error,
        'VideoService.endConsultation',
        resolvedAppointmentId,
        'Could not end the video consultation'
      );
    }
  }

  /** Audit trail for a visit a clinic admin completed on the doctor's behalf. */
  private auditAdminCompletion(
    appointment: { id: string; clinicId: string },
    userId: string
  ): void {
    void this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'Video consultation ended by a clinic admin',
      'VideoService.endConsultation',
      {
        appointmentId: appointment.id,
        clinicId: appointment.clinicId,
        endedBy: userId,
        endedByRole: Role.CLINIC_ADMIN,
      }
    );
  }

  /**
   * 409 for an appointment that cannot be ended. A CONFIRMED or SCHEDULED visit never started
   * (no doctor start flipped it to IN_PROGRESS, which also requires it to be paid), so it answers
   * "has not started" rather than naming a status the user did not cause.
   */
  private static consultationNotEndableError(status: string): ConflictException {
    if (
      status === String(AppointmentStatus.CONFIRMED) ||
      status === String(AppointmentStatus.SCHEDULED)
    ) {
      return new ConflictException('This consultation has not started');
    }
    const label = status.toLowerCase().replace(/_/g, ' ');
    return new ConflictException(
      `This consultation cannot be ended because the appointment is ${label}.`
    );
  }

  /**
   * Set the appointment to COMPLETED, but only if it is IN_PROGRESS and in the caller's clinic
   * (compare-and-set on the previous status, the same IN_PROGRESS-only contract as
   * AppointmentsService.completeAppointment: a visit that never started cannot be completed here).
   * Returns 'already_completed' when a concurrent request got there first; throws when the
   * appointment moved to a state that cannot be completed (for example it was cancelled
   * meanwhile) or when the write itself fails.
   *
   * AppointmentsService owns the validated status machine but cannot be injected here (its
   * module imports the video module), so this is a narrow conditional write; it should be
   * unified with AppointmentsService.completeAppointment later.
   */
  private async completeAppointmentOnEnd(
    appointment: {
      id: string;
      clinicId: string;
      patientId: string;
      doctorId: string;
      type?: unknown;
      date?: unknown;
      time?: unknown;
      duration?: unknown;
    },
    userId: string,
    actor: VideoCompletionActor = 'doctor'
  ): Promise<'completed' | 'already_completed'> {
    const completedAt = new Date();
    const result = await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            clinicId: appointment.clinicId,
            status: { in: [AppointmentStatus.IN_PROGRESS, AppointmentStatus.CONFIRMED] },
          },
          data: { status: AppointmentStatus.COMPLETED, completedAt },
        });
      },
      {
        userId,
        userRole: actor === 'clinic_admin' ? Role.CLINIC_ADMIN : Role.DOCTOR,
        clinicId: appointment.clinicId,
        operation: 'UPDATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: appointment.id,
        timestamp: completedAt,
        details: { status: AppointmentStatus.COMPLETED, source: 'VideoService.endConsultation' },
      }
    );

    if (result.count > 0) {
      await this.invalidateAppointmentCacheQuietly(appointment);
      // This call performed the transition (the compare-and-set matched), so it alone announces
      // it. The 'already_completed' paths below never emit: the route that won already did.
      await this.emitAppointmentCompleted(appointment, userId, completedAt);
      return 'completed';
    }

    const currentStatus = await this.readAppointmentStatus(appointment.id, appointment.clinicId);
    if (currentStatus === String(AppointmentStatus.COMPLETED)) {
      return 'already_completed';
    }
    throw VideoService.consultationNotEndableError(currentStatus ?? 'unavailable');
  }

  /**
   * Announce that this request completed the appointment, with the envelope and payload shape
   * AppointmentsService.completeAppointment uses, so payout readiness (billing), follow-up/EHR
   * listeners and the patient notification run for a visit completed through the video end route
   * as well. The patient gets one generic "updated" notification: the listener de-duplicates it
   * if the other completion route also fires.
   *
   * `EventService.emitEnterprise` never throws, it resolves with `{ success: false }`, so the
   * result is checked and the emit retried once. If it still fails the completion stays committed
   * (the request does not fail) but a `completionEventPending` marker is stored on the
   * appointment, and the next end request re-announces it once (reconcilePendingCompletionEvent).
   */
  private async emitAppointmentCompleted(
    appointment: CompletedAppointmentRef,
    userId: string,
    completedAt: Date
  ): Promise<void> {
    const outcome = await emitAppointmentCompletedWithRetry(
      this.eventService,
      appointment,
      userId,
      completedAt
    );
    if (outcome.delivered) {
      return;
    }

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Failed to emit appointment.completed after video end (${outcome.attempts} attempts): ${outcome.failure ?? 'unknown error'}`,
      'VideoService.emitAppointmentCompleted',
      { appointmentId: appointment.id }
    );
    try {
      await markCompletionEventPending(this.databaseService, appointment, userId);
    } catch (markerError: unknown) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Could not record the pending appointment.completed announcement: ${extractErrorMessage(markerError) ?? 'Unknown error'}`,
        'VideoService.emitAppointmentCompleted',
        { appointmentId: appointment.id }
      );
    }
  }

  /**
   * An end request found the appointment already COMPLETED. If its completion event was never
   * announced (the marker is set), take the marker and announce it: of any number of concurrent or
   * repeated requests exactly one clears the marker and emits. Never fails the end request.
   */
  private async reconcilePendingCompletionEvent(
    appointment: CompletedAppointmentRef & { metadata?: unknown; completedAt?: Date | null },
    userId: string
  ): Promise<void> {
    if (!hasCompletionEventPending(appointment.metadata)) {
      return;
    }

    try {
      const claimed = await claimPendingCompletionEvent(this.databaseService, appointment, userId);
      if (claimed) {
        await this.emitAppointmentCompleted(
          appointment,
          userId,
          appointment.completedAt ?? new Date()
        );
      }
    } catch (reconcileError: unknown) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Could not re-announce appointment.completed: ${extractErrorMessage(reconcileError) ?? 'Unknown error'}`,
        'VideoService.reconcilePendingCompletionEvent',
        { appointmentId: appointment.id }
      );
    }
  }

  private async readAppointmentStatus(
    appointmentId: string,
    clinicId: string
  ): Promise<string | null> {
    const row = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.appointment.findFirst({
        where: { id: appointmentId, clinicId },
        select: { status: true },
      });
    });
    return row ? String(row.status).toUpperCase() : null;
  }

  /** Cache invalidation after a committed write must never fail the request. */
  private async invalidateAppointmentCacheQuietly(appointment: {
    id: string;
    clinicId: string;
    patientId: string;
    doctorId: string;
  }): Promise<void> {
    try {
      await this.cacheService.invalidateAppointmentCache(
        appointment.id,
        appointment.patientId,
        appointment.doctorId,
        appointment.clinicId
      );
    } catch (cacheError) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to invalidate appointment cache: ${extractErrorMessage(cacheError) ?? 'Unknown error'}`,
        'VideoService.invalidateAppointmentCacheQuietly',
        { appointmentId: appointment.id }
      );
    }
  }

  /** Response for ending a consultation whose appointment is already COMPLETED. */
  private async buildAlreadyCompletedSession(appointment: {
    id: string;
    completedAt?: Date | null;
  }): Promise<VideoConsultationSession> {
    const existing = await this.getConsultationSession(appointment.id);
    if (existing) {
      return existing;
    }
    return {
      ...this.buildPlaceholderConsultationSession(
        appointment as unknown as Parameters<VideoService['buildPlaceholderConsultationSession']>[0]
      ),
      status: 'COMPLETED',
      endTime: appointment.completedAt ?? null,
    };
  }

  /**
   * Admin force-terminate of a running session (`admin/sessions/:id/terminate`): SUPER_ADMIN for
   * any clinic, CLINIC_ADMIN only inside their own (another clinic's appointment answers 404).
   *
   * It really closes the call: the provider room is deleted (everyone in it is ejected) and the
   * VideoConsultation row is ended. The APPOINTMENT is deliberately left alone - the treating
   * doctor can still complete it through the end route or the expiry job can close it - so no
   * `appointment.completed` event, payout or patient notification happens here.
   *
   * A provider that cannot close its rooms answers 409 instead of pretending to succeed, and a
   * provider failure leaves the row untouched so the admin can retry. Errors reach the client
   * only as fixed messages; the raw cause goes to the log. A session that already ended is a
   * success (`alreadyEnded`) and does not call the provider again.
   *
   * @param appointmentOrConsultationId - appointment id or consultation id (`video-session-<id>`)
   */
  async terminateConsultation(
    appointmentOrConsultationId: string,
    userId: string,
    caller: VideoCallerContext
  ): Promise<{ appointmentId: string; alreadyEnded: boolean }> {
    const { appointmentId } = await this.authorizeConsultationAccess(
      appointmentOrConsultationId,
      userId,
      'clinic_admin',
      caller
    );

    try {
      const consultation = await this.databaseService.executeHealthcareRead(async prisma => {
        const delegate = getVideoConsultationDelegate(prisma);
        return await delegate.findFirst({ where: { appointmentId } });
      });
      if (!consultation) {
        throw new NotFoundException('No video session was found for this appointment.');
      }
      if (VideoService.FINISHED_CONSULTATION_STATUSES.has(consultation.status)) {
        return { appointmentId, alreadyEnded: true };
      }

      const provider = findTerminatingProvider(
        this.providerFactory.getProvidersInOrder(),
        consultation.roomId
      );
      if (!provider) {
        throw new ConflictException(
          'This video session cannot be force-terminated for its video provider.'
        );
      }

      await provider.terminateRoom(consultation.roomId);
      await provider.endConsultation(appointmentId, userId, 'clinic_admin');
      await this.invalidateAppointmentCacheQuietly({
        id: appointmentId,
        clinicId: consultation.clinicId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
      });

      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Video session force-terminated by an administrator',
        'VideoService.terminateConsultation',
        {
          appointmentId,
          consultationId: consultation.id,
          terminatedBy: userId,
          terminatedByRole: caller.rawRole ?? 'unknown',
          provider: provider.providerName,
        }
      );
      return { appointmentId, alreadyEnded: false };
    } catch (error: unknown) {
      this.logLifecycleFailure('VideoService.terminateConsultation', appointmentId, error);
      throw this.toVideoLifecycleError(
        error,
        'VideoService.terminateConsultation',
        appointmentId,
        'Could not terminate the video session'
      );
    }
  }

  /**
   * Get consultation session
   */
  async getConsultationSession(
    appointmentId: string,
    accessContext?: VideoSessionAccessContext
  ): Promise<VideoConsultationSession | null> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      const providers = this.providerFactory.getProvidersInOrder();
      for (const provider of providers) {
        try {
          const session: VideoConsultationSession | null =
            await provider.getConsultationSession(resolvedAppointmentId);
          if (session) {
            this.provider = provider;
            const appointment =
              await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);
            return this.attachAppointmentNamesToSession(session, appointment);
          }
        } catch (error) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Video provider '${provider.providerName}' failed during VideoService.getConsultationSession: ${error instanceof Error ? error.message : 'Unknown error'}. Trying next provider if available.`,
            'VideoService.getConsultationSession',
            {
              provider: provider.providerName,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    } catch {
      // No fallback provider configured. Continue with appointment-backed fallback below.
    }

    if (!accessContext) {
      return null;
    }

    const appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);

    if (!appointment) {
      return null;
    }
    const normalizedUserRole = String(accessContext.userRole || '').toLowerCase();
    this.ensureAppointmentJoinable(
      {
        ...appointment,
        clinicId: appointment.clinicId,
      },
      normalizedUserRole as 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
    );
    return this.buildPlaceholderConsultationSession(appointment);
  }

  /**
   * List active sessions: every clinic's for a SUPER_ADMIN, or only those of `clinicId` when it is
   * given (a CLINIC_ADMIN must never see another clinic's rooms, meeting links or participants).
   */
  async listAllActiveSessions(clinicId?: string): Promise<VideoConsultationSession[]> {
    try {
      const providers = this.providerFactory.getProvidersInOrder();
      for (const provider of providers) {
        try {
          if (provider.listActiveSessions) {
            const sessions = await provider.listActiveSessions();
            this.provider = provider;
            return clinicId ? await this.filterSessionsToClinic(sessions, clinicId) : sessions;
          }
        } catch (error) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Video provider '${provider.providerName}' failed during VideoService.listAllActiveSessions: ${error instanceof Error ? error.message : 'Unknown error'}. Trying next provider if available.`,
            'VideoService.listAllActiveSessions',
            {
              provider: provider.providerName,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
      return [];
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to list all active sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.listAllActiveSessions'
      );
      return [];
    }
  }

  /** Keep only the sessions whose appointment belongs to `clinicId`. */
  private async filterSessionsToClinic(
    sessions: VideoConsultationSession[],
    clinicId: string
  ): Promise<VideoConsultationSession[]> {
    const appointmentIds = [...new Set(sessions.map(session => session.appointmentId))].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
    if (appointmentIds.length === 0) {
      return [];
    }

    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.appointment.findMany({
        where: { id: { in: appointmentIds }, clinicId },
        select: { id: true },
      });
    });
    const inClinic = new Set(rows.map(row => row.id));
    return sessions.filter(session => inClinic.has(session.appointmentId));
  }

  /**
   * Get consultation status
   * Returns consultation session in appointment format for plugin compatibility
   */
  async getConsultationStatus(
    appointmentId: string
  ): Promise<AppointmentVideoConsultationSession | null> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    const session = await this.getConsultationSession(resolvedAppointmentId);
    if (!session) {
      return null;
    }

    // Map to the compact session status format expected by the consultation API
    const statusMap: Record<
      'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'COMPLETED' | 'CANCELLED',
      'pending' | 'started' | 'ended' | 'cancelled'
    > = {
      SCHEDULED: 'pending',
      ACTIVE: 'started',
      ENDED: 'ended',
      COMPLETED: 'ended',
      CANCELLED: 'cancelled',
    };

    const sessionStatus = session.status;
    const mappedStatus = statusMap[sessionStatus] ?? 'cancelled';

    const participants: Array<{
      userId: string;
      userRole: 'patient' | 'doctor';
      joinedAt?: Date;
    }> = session.participants.map(p => {
      const participant: {
        userId: string;
        userRole: 'patient' | 'doctor';
        joinedAt?: Date;
      } = {
        userId: p.userId,
        userRole: p.role === 'HOST' ? 'doctor' : 'patient',
      };
      if (p.joinedAt) {
        participant.joinedAt = p.joinedAt;
      }
      return participant;
    });

    return {
      appointmentId: session.appointmentId,
      roomName: session.roomName,
      ...(session.patientName !== undefined && { patientName: session.patientName }),
      ...(session.doctorName !== undefined && { doctorName: session.doctorName }),
      confirmedSlotIndex: session.confirmedSlotIndex ?? null,
      status: mappedStatus,
      startTime: session.startTime ?? undefined,
      endTime: session.endTime ?? undefined,
      participants,
      hipaaAuditLog: [],
      technicalIssues: [],
    };
  }

  /**
   * Report technical issue during consultation
   */
  async reportTechnicalIssue(
    appointmentId: string,
    userId: string,
    issueDescription: string,
    issueType: 'audio' | 'video' | 'connection' | 'other'
  ): Promise<void> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      const session = await this.getConsultationSession(resolvedAppointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${resolvedAppointmentId}`,
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.reportTechnicalIssue'
        );
      }

      // Store technical issue in cache
      const cacheKey = `video_session:${resolvedAppointmentId}`;
      const cachedSessionValue: unknown = await this.cacheService.get(cacheKey);

      if (
        cachedSessionValue &&
        typeof cachedSessionValue === 'object' &&
        cachedSessionValue !== null &&
        'appointmentId' in cachedSessionValue
      ) {
        const cachedSession = cachedSessionValue as AppointmentVideoConsultationSession;
        if (!cachedSession.technicalIssues) {
          cachedSession.technicalIssues = [];
        }
        cachedSession.technicalIssues.push({
          issueType,
          description: issueDescription,
          reportedBy: userId,
          timestamp: new Date(),
        });
        await this.cacheService.set(cacheKey, cachedSession, this.MEETING_CACHE_TTL);
      }

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        `Technical issue reported for appointment ${resolvedAppointmentId}`,
        'VideoService.reportTechnicalIssue',
        {
          appointmentId: resolvedAppointmentId,
          issueType,
          reportedBy: userId,
          description: issueDescription,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to report technical issue for appointment ${resolvedAppointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.reportTechnicalIssue',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          issueType,
          appointmentId: resolvedAppointmentId,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to report technical issue',
        undefined,
        { appointmentId: resolvedAppointmentId, userId, issueType },
        'VideoService.reportTechnicalIssue'
      );
    }
  }

  /**
   * Add video recording job to queue
   */
  async processRecording(appointmentId: string, recordingUrl: string): Promise<void> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    await this.queueService?.addJob(
      JobType.VIDEO_RECORDING,
      'process_recording',
      { appointmentId: resolvedAppointmentId, recordingUrl },
      { priority: JobPriorityLevel.HIGH }
    );
  }

  /**
   * Internal method called by QueueProcessor to actually process the recording
   */
  async executeProcessRecording(appointmentId: string, recordingUrl: string): Promise<void> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    try {
      const session = await this.getConsultationSession(resolvedAppointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${resolvedAppointmentId}`,
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.executeProcessRecording'
        );
      }

      // Update session with recording URL in cache
      const cacheKey = `video_session:${resolvedAppointmentId}`;
      const cachedSessionValue: unknown = await this.cacheService.get(cacheKey);

      if (
        cachedSessionValue &&
        typeof cachedSessionValue === 'object' &&
        cachedSessionValue !== null
      ) {
        const cachedSession = cachedSessionValue as AppointmentVideoConsultationSession;
        cachedSession.recordingUrl = recordingUrl;
        await this.cacheService.set(cacheKey, cachedSession, this.MEETING_CACHE_TTL);
      }

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Processing recording for appointment ${resolvedAppointmentId}`,
        'VideoService.executeProcessRecording',
        {
          recordingUrl,
          appointmentId: resolvedAppointmentId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process recording for appointment ${resolvedAppointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.executeProcessRecording',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId: resolvedAppointmentId,
        }
      );
      throw error;
    }
  }

  // ============================================================================
  // VIDEO CALL METHODS (used by appointment plugin)
  // ============================================================================

  async createVideoCall(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string
  ): Promise<CreateVideoCallResponse> {
    const startTime = Date.now();
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      // Validate appointment exists and belongs to participants
      await this.validateAppointment(resolvedAppointmentId, patientId, doctorId, clinicId);

      // Generate unique meeting URL
      const meetingUrl = await this.generateMeetingUrl(resolvedAppointmentId);

      // Create video call record
      const now = Date.now();
      const videoCall: VideoCall = {
        id: `vc-${resolvedAppointmentId}-${now}`,
        appointmentId: resolvedAppointmentId,
        patientId,
        doctorId,
        clinicId,
        status: 'scheduled',
        meetingUrl,
        participants: [patientId, doctorId],
        settings: {
          maxParticipants: 2,
          recordingEnabled: true,
          screenSharingEnabled: true,
          chatEnabled: true,
          waitingRoomEnabled: true,
          autoRecord: false,
        },
      };

      // Persist the generated consultation session metadata.
      await this.storeVideoCall(videoCall);

      // Cache the video call
      const cacheKey = `videocall:${videoCall.id}`;
      await this.cacheService.set(cacheKey, JSON.stringify(videoCall), this.VIDEO_CACHE_TTL);

      const responseTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Video call created successfully',
        'VideoService',
        {
          appointmentId: resolvedAppointmentId,
          patientId,
          doctorId,
          clinicId,
          responseTime,
        }
      );

      const response: CreateVideoCallResponse = {
        success: true,
        data: videoCall,
        message: 'Video call created successfully',
      };
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create video call: ${errorMessage}`,
        'VideoService',
        {
          appointmentId: resolvedAppointmentId,
          patientId,
          doctorId,
          clinicId,
          errorStack,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to create video call',
        undefined,
        {
          appointmentId: resolvedAppointmentId,
          patientId,
          doctorId,
          clinicId,
          originalError: String(error),
        },
        'VideoService.createVideoCall'
      );
    }
  }

  async startRecording(callId: string, userId: string): Promise<RecordingResponse> {
    const startTime: number = Date.now();

    try {
      // Get video call details
      const videoCall: VideoCall | null = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Create the recording session and mark the consultation as recording.
      const recordingId: string = await this.initiateRecording(callId);

      // Update video call with recording info
      const recordingUrl: string = `https://recordings.example.com/${recordingId}`;
      const updatedVideoCall: VideoCall = {
        ...videoCall,
        recordingUrl,
      };
      await this.updateVideoCall(updatedVideoCall);

      const responseTime: number = Date.now() - startTime;
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Recording started successfully',
        'VideoService',
        { callId, userId, recordingId, responseTime }
      );

      const response: RecordingResponse = {
        success: true,
        data: {
          recordingId,
          recordingUrl,
        },
        message: 'Recording started',
      };
      return response;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start recording: ${errorMessage}`,
        'VideoService',
        {
          callId,
          userId,
          errorStack,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to start recording',
        undefined,
        { callId, userId },
        'VideoService.startRecording'
      );
    }
  }

  async stopRecording(callId: string, userId: string): Promise<RecordingResponse> {
    const startTime: number = Date.now();

    try {
      // Get video call details
      const videoCall: VideoCall | null = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Finalize the recording metadata and persist the generated storage URL.
      const recordingResult: { duration: number; url: string } =
        await this.finalizeRecording(callId);

      const responseTime: number = Date.now() - startTime;
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Recording stopped successfully',
        'VideoService',
        { callId, userId, responseTime }
      );

      const response: RecordingResponse = {
        success: true,
        data: {
          ...(videoCall.recordingUrl ? { recordingUrl: videoCall.recordingUrl } : {}),
          duration: recordingResult.duration,
        },
        message: 'Recording stopped',
      };
      return response;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to stop recording: ${errorMessage}`,
        'VideoService',
        {
          callId,
          userId,
          errorStack,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to stop recording',
        undefined,
        { callId, userId },
        'VideoService.stopRecording'
      );
    }
  }

  async endVideoCall(callId: string, userId: string): Promise<EndVideoCallResponse> {
    const startTime = Date.now();

    try {
      // Get video call details
      const videoCall = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // End the call
      const endTime = new Date();
      const endTimeIso = endTime.toISOString();
      let duration: number | undefined;
      if (videoCall.startTime) {
        const startTimeDate = new Date(videoCall.startTime);
        const endTimeDate = new Date(endTimeIso);
        duration = Math.floor((endTimeDate.getTime() - startTimeDate.getTime()) / 1000);
      }

      const updatedVideoCall: VideoCall = {
        ...videoCall,
        status: 'completed',
        endTime: endTimeIso,
        ...(duration !== undefined ? { duration } : {}),
      };

      await this.updateVideoCall(updatedVideoCall);

      // Stop any active recording
      if (updatedVideoCall.recordingUrl) {
        await this.stopRecording(callId, userId);
      }

      const responseTime: number = Date.now() - startTime;
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Video call ended successfully',
        'VideoService',
        {
          callId,
          userId,
          duration,
          responseTime,
        }
      );

      const response: EndVideoCallResponse = {
        success: true,
        data: {
          callId,
          ...(duration !== undefined ? { duration } : {}),
        },
        message: 'Video call ended',
      };
      return response;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end video call: ${errorMessage}`,
        'VideoService',
        {
          callId,
          userId,
          errorStack,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to end video call',
        undefined,
        { callId, userId },
        'VideoService.endVideoCall'
      );
    }
  }

  async shareMedicalImage(
    callId: string,
    userId: string,
    imageData: Record<string, unknown>
  ): Promise<ShareMedicalImageResponse> {
    const startTime: number = Date.now();

    try {
      // Get video call details
      const videoCall: VideoCall | null = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Upload and share the captured medical image through the configured storage path.
      const imageUrl: string = await this.uploadMedicalImage(imageData, callId, userId);

      const responseTime: number = Date.now() - startTime;
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Medical image shared successfully',
        'VideoService',
        { callId, userId, imageUrl, responseTime }
      );

      const response: ShareMedicalImageResponse = {
        success: true,
        data: {
          imageUrl,
        },
        message: 'Medical image shared',
      };
      return response;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to share medical image: ${errorMessage}`,
        'VideoService',
        {
          callId,
          userId,
          errorStack,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to share medical image',
        undefined,
        { callId, userId },
        'VideoService.shareMedicalImage'
      );
    }
  }

  async getVideoCallHistory(userId: string, clinicId?: string): Promise<VideoCallHistoryResponse> {
    const startTime: number = Date.now();
    const cacheKey: string = `videocalls:history:${userId}:${clinicId || 'all'}`;

    try {
      // Try to get from cache first
      const cached: string | null = await this.cacheService.get(cacheKey);
      if (cached && typeof cached === 'string') {
        try {
          const parsed: unknown = JSON.parse(cached);
          if (parsed && typeof parsed === 'object' && 'success' in parsed && 'data' in parsed) {
            return parsed as VideoCallHistoryResponse;
          }
        } catch {
          // Invalid cache data, continue to database lookup
        }
      }

      // Read historical video consultations for this user from the database.
      const calls: VideoCall[] = await this.fetchVideoCallHistory(userId, clinicId);

      const now: Date = new Date();
      const result: VideoCallHistoryResponse = {
        success: true,
        data: {
          userId,
          ...(clinicId ? { clinicId } : {}),
          calls,
          total: calls.length,
          retrievedAt: now.toISOString(),
        },
        message: 'Video call history retrieved successfully',
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.VIDEO_CACHE_TTL);

      const responseTime: number = Date.now() - startTime;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Video call history retrieved successfully',
        'VideoService',
        {
          userId,
          clinicId,
          count: calls.length,
          responseTime,
        }
      );

      return result;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get video call history: ${errorMessage}`,
        'VideoService',
        {
          userId,
          clinicId,
          errorStack,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get video call history',
        undefined,
        { userId, clinicId },
        'VideoService.getVideoCallHistory'
      );
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================
  /**
   * Validates appointment and narrows to VideoCallAppointment
   * @param appointmentId - The appointment ID
   * @param patientId - The patient ID
   * @param doctorId - The doctor ID
   * @param clinicId - The clinic ID
   * @returns VideoCallAppointment (type-narrowed)
   * @throws NotFoundException if appointment not found
   * @throws BadRequestException if appointment is not VIDEO_CALL
   */
  private async validateAppointment(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string
  ): Promise<VideoCallAppointment> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    const appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);

    if (!appointment) {
      throw new NotFoundException(`Appointment ${resolvedAppointmentId} not found`);
    }

    // Runtime validation at boundary - narrow to VideoCallAppointment
    if (!isVideoCallAppointment(appointment)) {
      throw new BadRequestException(
        `Appointment ${resolvedAppointmentId} is not a video consultation`
      );
    }

    // Validate participants
    if (appointment.patientId !== patientId) {
      throw new BadRequestException('Patient ID does not match appointment');
    }

    if (appointment.doctorId !== doctorId) {
      throw new BadRequestException('Doctor ID does not match appointment');
    }

    if (appointment.clinicId !== clinicId) {
      throw new BadRequestException('Clinic ID does not match appointment');
    }

    // Return type-narrowed appointment
    return appointment;
  }

  private async generateMeetingUrl(appointmentId: string): Promise<string> {
    // Use provider to generate meeting URL
    const tokenResponse = await this.generateMeetingToken(appointmentId, 'system', 'doctor', {
      displayName: 'System',
      email: '',
    });
    return tokenResponse.meetingUrl;
  }

  private async storeVideoCall(videoCall: VideoCall): Promise<void> {
    try {
      const existing = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = getVideoConsultationDelegate(client);
        return await delegate.findUnique({
          where: { appointmentId: videoCall.appointmentId },
        });
      });

      if (existing) {
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const delegate = getVideoConsultationDelegate(client);
            return await delegate.update({
              where: { id: existing.id },
              data: {
                meetingUrl: videoCall.meetingUrl,
                status: this.mapVideoCallStatusToDbStatus(videoCall.status),
                recordingEnabled: videoCall.settings.recordingEnabled,
                screenSharingEnabled: videoCall.settings.screenSharingEnabled,
                chatEnabled: videoCall.settings.chatEnabled,
                waitingRoomEnabled: videoCall.settings.waitingRoomEnabled,
                autoRecord: videoCall.settings.autoRecord,
                maxParticipants: videoCall.settings.maxParticipants,
                ...(videoCall.startTime && { startTime: new Date(videoCall.startTime) }),
                ...(videoCall.endTime && { endTime: new Date(videoCall.endTime) }),
                ...(videoCall.duration && { duration: videoCall.duration }),
                ...(videoCall.recordingUrl && { recordingUrl: videoCall.recordingUrl }),
              },
            });
          },
          {
            userId: videoCall.doctorId,
            userRole: 'DOCTOR',
            clinicId: videoCall.clinicId,
            operation: 'UPDATE_VIDEO_CONSULTATION',
            resourceType: 'VIDEO_CONSULTATION',
            resourceId: existing.id,
            timestamp: new Date(),
          }
        );
      } else {
        const roomId = `room-${videoCall.appointmentId}-${Date.now()}`;
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const delegate = getVideoConsultationDelegate(client);
            return await delegate.create({
              data: {
                appointmentId: videoCall.appointmentId,
                patientId: videoCall.patientId,
                doctorId: videoCall.doctorId,
                clinicId: videoCall.clinicId,
                roomId,
                meetingUrl: videoCall.meetingUrl,
                status: this.mapVideoCallStatusToDbStatus(videoCall.status),
                recordingEnabled: videoCall.settings.recordingEnabled,
                screenSharingEnabled: videoCall.settings.screenSharingEnabled,
                chatEnabled: videoCall.settings.chatEnabled,
                waitingRoomEnabled: videoCall.settings.waitingRoomEnabled,
                autoRecord: videoCall.settings.autoRecord,
                maxParticipants: videoCall.settings.maxParticipants,
                ...(videoCall.startTime && { startTime: new Date(videoCall.startTime) }),
                ...(videoCall.endTime && { endTime: new Date(videoCall.endTime) }),
                ...(videoCall.duration && { duration: videoCall.duration }),
                ...(videoCall.recordingUrl && { recordingUrl: videoCall.recordingUrl }),
              },
            });
          },
          {
            userId: videoCall.doctorId,
            userRole: 'DOCTOR',
            clinicId: videoCall.clinicId,
            operation: 'CREATE_VIDEO_CONSULTATION',
            resourceType: 'VIDEO_CONSULTATION',
            resourceId: videoCall.appointmentId,
            timestamp: new Date(),
          }
        );
      }

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Stored video call: ${videoCall.id} for appointment ${videoCall.appointmentId}`,
        'VideoService.storeVideoCall',
        { videoCallId: videoCall.id, appointmentId: videoCall.appointmentId }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to store video call: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.storeVideoCall',
        {
          error: error instanceof Error ? error.message : String(error),
          videoCallId: videoCall.id,
          appointmentId: videoCall.appointmentId,
        }
      );
      throw error;
    }
  }

  private mapVideoCallStatusToDbStatus(
    status: 'scheduled' | 'active' | 'completed' | 'cancelled'
  ): 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' {
    switch (status) {
      case 'scheduled':
        return 'SCHEDULED';
      case 'active':
        return 'ACTIVE';
      case 'completed':
        return 'COMPLETED';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return 'SCHEDULED';
    }
  }

  private async getVideoCall(callId: string): Promise<VideoCall | null> {
    // Try cache first
    const cacheKey = `videocall:${callId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached && typeof cached === 'string') {
      try {
        const parsed = JSON.parse(cached) as unknown;
        if (parsed && typeof parsed === 'object' && 'id' in parsed && 'appointmentId' in parsed) {
          return parsed as VideoCall;
        }
      } catch {
        // Invalid cache data, continue to database lookup
      }
    }

    let consultation = await this.databaseService.executeHealthcareRead(async client => {
      const delegate = getVideoConsultationDelegate(client);
      return await delegate.findFirst({
        where: {
          OR: [{ roomId: callId }, { appointmentId: callId }],
        },
        include: {
          participants: true,
        },
      });
    });

    if (!consultation && callId.startsWith('vc-')) {
      const appointmentIdMatch = callId.match(/vc-(.+?)-/);
      if (appointmentIdMatch && appointmentIdMatch[1]) {
        const matchedAppointmentId: string = appointmentIdMatch[1];
        consultation = await this.databaseService.executeHealthcareRead(async client => {
          const delegate = getVideoConsultationDelegate(client);
          return await delegate.findFirst({
            where: {
              OR: [{ appointmentId: matchedAppointmentId }],
            },
            include: {
              participants: true,
            },
          });
        });
      }
    }

    if (!consultation) {
      return null;
    }

    // Map database model to VideoCall type
    const videoCall: VideoCall = {
      id: consultation.id,
      appointmentId: consultation.appointmentId,
      patientId: consultation.patientId,
      doctorId: consultation.doctorId,
      clinicId: consultation.clinicId,
      status: this.mapDbStatusToVideoCallStatus(consultation.status),
      ...(consultation.meetingUrl ? { meetingUrl: consultation.meetingUrl } : {}),
      participants: consultation.participants.map(p => p.userId),
      ...(consultation.startTime ? { startTime: consultation.startTime.toISOString() } : {}),
      ...(consultation.endTime ? { endTime: consultation.endTime.toISOString() } : {}),
      ...(consultation.duration !== null && consultation.duration !== undefined
        ? { duration: consultation.duration }
        : {}),
      ...(consultation.recordingUrl ? { recordingUrl: consultation.recordingUrl } : {}),
      settings: {
        maxParticipants: consultation.maxParticipants,
        recordingEnabled: consultation.recordingEnabled,
        screenSharingEnabled: consultation.screenSharingEnabled,
        chatEnabled: consultation.chatEnabled,
        waitingRoomEnabled: consultation.waitingRoomEnabled,
        autoRecord: consultation.autoRecord,
      },
    };

    // Cache the result
    await this.cacheService.set(cacheKey, JSON.stringify(videoCall), this.VIDEO_CACHE_TTL);

    return videoCall;
  }

  private async getVideoConsultationByCallId(
    callId: string
  ): Promise<VideoConsultationDbModel | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const delegate = getVideoConsultationDelegate(client);
      return await delegate.findFirst({
        where: {
          OR: [{ roomId: callId }, { appointmentId: callId }],
        },
      });
    });
  }

  private mapDbStatusToVideoCallStatus(
    status: string
  ): 'scheduled' | 'active' | 'completed' | 'cancelled' {
    switch (status) {
      case 'SCHEDULED':
        return 'scheduled';
      case 'ACTIVE':
        return 'active';
      case 'COMPLETED':
        return 'completed';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'scheduled';
    }
  }

  private async updateVideoCall(videoCall: VideoCall): Promise<void> {
    try {
      const consultation = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = getVideoConsultationDelegate(client);
        return await delegate.findFirst({
          where: {
            OR: [
              { appointmentId: videoCall.appointmentId },
              ...(videoCall.id ? [{ roomId: videoCall.id }] : []),
            ],
          },
        });
      });

      if (consultation) {
        const updateData: {
          status: string;
          meetingUrl?: string | null;
          startTime?: Date;
          endTime?: Date;
          duration?: number;
          recordingUrl?: string | null;
          recordingEnabled: boolean;
          screenSharingEnabled: boolean;
          chatEnabled: boolean;
          waitingRoomEnabled: boolean;
          autoRecord: boolean;
          maxParticipants: number;
        } = {
          status: this.mapVideoCallStatusToDbStatus(videoCall.status),
          meetingUrl: videoCall.meetingUrl ?? null,
          recordingEnabled: videoCall.settings.recordingEnabled,
          screenSharingEnabled: videoCall.settings.screenSharingEnabled,
          chatEnabled: videoCall.settings.chatEnabled,
          waitingRoomEnabled: videoCall.settings.waitingRoomEnabled,
          autoRecord: videoCall.settings.autoRecord,
          maxParticipants: videoCall.settings.maxParticipants,
        };

        if (videoCall.startTime) {
          updateData.startTime = new Date(videoCall.startTime);
        }
        if (videoCall.endTime) {
          updateData.endTime = new Date(videoCall.endTime);
        }
        if (videoCall.duration !== undefined) {
          updateData.duration = videoCall.duration;
        }
        if (videoCall.recordingUrl !== undefined) {
          updateData.recordingUrl = videoCall.recordingUrl ?? null;
        }

        await this.databaseService.executeHealthcareWrite(
          async client => {
            const delegate = getVideoConsultationDelegate(client);
            return await delegate.update({
              where: { id: consultation.id },
              data: updateData,
            });
          },
          {
            userId: consultation.doctorId,
            userRole: 'DOCTOR',
            clinicId: consultation.clinicId,
            operation: 'UPDATE_VIDEO_CONSULTATION',
            resourceType: 'VIDEO_CONSULTATION',
            resourceId: consultation.id,
            timestamp: new Date(),
          }
        );
      }

      // Update cache
      const cacheKey = `videocall:${videoCall.id}`;
      await this.cacheService.set(cacheKey, JSON.stringify(videoCall), this.VIDEO_CACHE_TTL);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Updated video call: ${videoCall.id}`,
        'VideoService.updateVideoCall',
        { videoCallId: videoCall.id, appointmentId: videoCall.appointmentId }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update video call: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.updateVideoCall',
        {
          error: error instanceof Error ? error.message : String(error),
          videoCallId: videoCall.id,
          appointmentId: videoCall.appointmentId,
        }
      );
      throw error;
    }
  }

  private async initiateRecording(callId: string): Promise<string> {
    try {
      // Get video consultation
      const consultation = await this.getVideoConsultationByCallId(callId);
      if (!consultation) {
        throw new NotFoundException(`Video consultation not found for call ${callId}`);
      }

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          return await delegate.update({
            where: { id: consultation.id },
            data: {
              isRecording: true,
            },
          });
        },
        {
          userId: consultation.doctorId || '',
          userRole: 'DOCTOR',
          clinicId: consultation.clinicId || '',
          operation: 'UPDATE_VIDEO_CONSULTATION',
          resourceType: 'VIDEO_CONSULTATION',
          resourceId: consultation.id,
          timestamp: new Date(),
        }
      );

      // In a real implementation, this would call the provider recording API
      // For now, generate a recording ID
      const recordingId = `rec-${consultation.id}-${Date.now()}`;

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoRecordingDelegate(client);
          return await delegate.create({
            data: {
              consultationId: consultation.id,
              fileName: `recording-${recordingId}.mp4`,
              filePath: `/recordings/${recordingId}.mp4`,
              format: 'mp4',
              quality: '720p',
              storageProvider: 's3',
              isProcessed: false,
            },
          });
        },
        {
          userId: consultation.doctorId || '',
          userRole: 'DOCTOR',
          clinicId: consultation.clinicId || '',
          operation: 'CREATE_VIDEO_RECORDING',
          resourceType: 'VIDEO_RECORDING',
          resourceId: recordingId,
          timestamp: new Date(),
        }
      );

      return recordingId;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initiate recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.initiateRecording',
        {
          error: error instanceof Error ? error.message : String(error),
          callId,
        }
      );
      throw error;
    }
  }

  private async finalizeRecording(callId: string): Promise<{ duration: number; url: string }> {
    try {
      // Get video consultation
      const consultation = await this.getVideoConsultationByCallId(callId);
      if (!consultation) {
        throw new NotFoundException(`Video consultation not found for call ${callId}`);
      }

      const recording = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = getVideoRecordingDelegate(client);
        return await delegate.findFirst({
          where: {
            consultationId: consultation.id,
            isProcessed: false,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });
      });

      if (!recording) {
        throw new NotFoundException(`Recording not found for call ${callId}`);
      }

      // Calculate duration
      let duration = 0;
      if (consultation.startTime && consultation.endTime) {
        const startTimeMs = consultation.startTime.getTime();
        const endTimeMs = consultation.endTime.getTime();
        duration = Math.floor((endTimeMs - startTimeMs) / 1000);
      }

      const updatedRecording = (await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoRecordingDelegate(client);
          return await delegate.update({
            where: { id: recording.id },
            data: {
              duration,
              isProcessed: true,
              storageUrl: recording.storageUrl || `https://recordings.example.com/${recording.id}`,
            },
          });
        },
        {
          userId: consultation.doctorId || '',
          userRole: 'DOCTOR',
          clinicId: consultation.clinicId || '',
          operation: 'UPDATE_VIDEO_RECORDING',
          resourceType: 'VIDEO_RECORDING',
          resourceId: recording.id,
          timestamp: new Date(),
        }
      )) as { storageUrl: string | null };

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          return await delegate.update({
            where: { id: consultation.id },
            data: {
              isRecording: false,
              recordingId: recording.id,
              recordingUrl: updatedRecording.storageUrl || undefined,
              duration,
            },
          });
        },
        {
          userId: consultation.doctorId || '',
          userRole: 'DOCTOR',
          clinicId: consultation.clinicId || '',
          operation: 'UPDATE_VIDEO_CONSULTATION',
          resourceType: 'VIDEO_CONSULTATION',
          resourceId: consultation.id,
          timestamp: new Date(),
        }
      );

      return {
        duration,
        url: updatedRecording.storageUrl || `https://recordings.example.com/${recording.id}`,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to finalize recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.finalizeRecording',
        {
          error: error instanceof Error ? error.message : String(error),
          callId,
        }
      );
      throw error;
    }
  }

  private uploadMedicalImage(
    imageData: Record<string, unknown>,
    callId: string,
    userId: string
  ): Promise<string> {
    // Fall back to a deterministic internal asset path when no external storage URL is available.
    return Promise.resolve(
      `/api/v1/video/calls/${callId}/medical-images/${userId}/${Date.now()}.jpg`
    );
  }

  // storeVirtualFitting method removed - healthcare application only

  private async fetchVideoCallHistory(userId: string, clinicId?: string): Promise<VideoCall[]> {
    try {
      // VideoConsultation.patientId/doctorId hold Patient.id / Doctor.id, not User.id —
      // resolve the caller's role records so patients and doctors actually see their calls.
      const roleIds = await this.databaseService.executeRead(async prisma => {
        const tx = prisma as unknown as Prisma.TransactionClient;
        const [patient, doctor] = await Promise.all([
          tx.patient.findUnique({ where: { userId }, select: { id: true } }),
          tx.doctor.findUnique({ where: { userId }, select: { id: true } }),
        ]);
        return { patientId: patient?.id, doctorId: doctor?.id };
      });
      const consultations = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = getVideoConsultationDelegate(client);
        return await delegate.findMany({
          where: {
            ...(clinicId && { clinicId }),
            OR: [
              { patientId: userId },
              { doctorId: userId },
              ...(roleIds.patientId ? [{ patientId: roleIds.patientId }] : []),
              ...(roleIds.doctorId ? [{ doctorId: roleIds.doctorId }] : []),
              {
                participants: {
                  some: {
                    userId,
                  },
                },
              },
            ],
          },
          include: {
            participants: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 50,
        });
      });

      const appointmentIds = Array.from(new Set(consultations.map(c => c.appointmentId)));
      const userName = (
        u:
          | { name?: string | null; firstName?: string | null; lastName?: string | null }
          | null
          | undefined
      ): string | undefined =>
        (u?.name && u.name.trim()) ||
        `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() ||
        undefined;
      const appointmentInfo = new Map<
        string,
        { doctorName?: string; patientName?: string; date?: string; time?: string; status?: string }
      >();
      if (appointmentIds.length > 0) {
        const nameSelect = { select: { name: true, firstName: true, lastName: true } };
        const appointments = await this.databaseService.executeRead(async prisma => {
          const tx = prisma as unknown as Prisma.TransactionClient;
          return await tx.appointment.findMany({
            where: { id: { in: appointmentIds } },
            select: {
              id: true,
              date: true,
              time: true,
              status: true,
              doctor: { select: { user: nameSelect } },
              patient: { select: { user: nameSelect } },
            },
          });
        });
        for (const a of appointments) {
          const doctorName = userName(a.doctor?.user);
          const patientName = userName(a.patient?.user);
          appointmentInfo.set(a.id, {
            ...(doctorName ? { doctorName } : {}),
            ...(patientName ? { patientName } : {}),
            date: new Date(a.date).toISOString(),
            time: a.time,
            status: String(a.status),
          });
        }
      }
      const videoCalls: VideoCall[] = consultations.map(consultation => ({
        ...(appointmentInfo.get(consultation.appointmentId)?.doctorName
          ? { doctorName: appointmentInfo.get(consultation.appointmentId)?.doctorName }
          : {}),
        ...(appointmentInfo.get(consultation.appointmentId)?.patientName
          ? { patientName: appointmentInfo.get(consultation.appointmentId)?.patientName }
          : {}),
        ...(appointmentInfo.get(consultation.appointmentId)?.date
          ? { appointmentDate: appointmentInfo.get(consultation.appointmentId)?.date }
          : {}),
        ...(appointmentInfo.get(consultation.appointmentId)?.time
          ? { appointmentTime: appointmentInfo.get(consultation.appointmentId)?.time }
          : {}),
        ...(appointmentInfo.get(consultation.appointmentId)?.status
          ? { appointmentStatus: appointmentInfo.get(consultation.appointmentId)?.status }
          : {}),
        id: consultation.id,
        appointmentId: consultation.appointmentId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        clinicId: consultation.clinicId,
        status: this.mapDbStatusToVideoCallStatus(consultation.status),
        ...(consultation.meetingUrl ? { meetingUrl: consultation.meetingUrl } : {}),
        participants: consultation.participants.map(p => p.userId),
        ...(consultation.startTime ? { startTime: consultation.startTime.toISOString() } : {}),
        ...(consultation.endTime ? { endTime: consultation.endTime.toISOString() } : {}),
        ...(consultation.duration !== null && consultation.duration !== undefined
          ? { duration: consultation.duration }
          : {}),
        ...(consultation.recordingUrl ? { recordingUrl: consultation.recordingUrl } : {}),
        settings: {
          maxParticipants: consultation.maxParticipants,
          recordingEnabled: consultation.recordingEnabled,
          screenSharingEnabled: consultation.screenSharingEnabled,
          chatEnabled: consultation.chatEnabled,
          waitingRoomEnabled: consultation.waitingRoomEnabled,
          autoRecord: consultation.autoRecord,
        },
      }));

      return videoCalls;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to fetch video call history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.fetchVideoCallHistory',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          clinicId,
        }
      );
      throw error;
    }
  }

  // ============================================================================
  // PROVIDER INFO METHODS
  // ============================================================================
  // Note: getCurrentProvider() and getFallbackProvider() are defined above
  // (lines 270-284) to avoid duplicate implementations

  /**
   * Check if video service is healthy
   * Real-time check: Verifies the active video provider is available and accessible.
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.provider) {
        // Provider not initialized yet - may be during startup
        return false;
      }
      const provider = await this.getProvider();
      // Real-time health check - verify provider is actually healthy
      const isProviderHealthy = await provider.isHealthy();
      return isProviderHealthy;
    } catch (error) {
      // Log error but don't fail health check if provider exists
      // Provider may be temporarily unreachable but still functional
      if (this.loggingService) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Video service health check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'VideoService.isHealthy',
          {}
        );
      }
      // If provider exists, assume healthy (container health check will catch actual failures)
      return this.provider !== undefined && this.provider !== null;
    }
  }

  // ============================================================================
  // PROVIDER-AGNOSTIC VIDEO FEATURES
  // ============================================================================

  /**
   * Start recording for a session
   */
  async startSessionRecording(
    appointmentId: string,
    options?: {
      outputMode?: 'COMPOSED' | 'INDIVIDUAL';
      resolution?: string;
      frameRate?: number;
      customLayout?: string;
    }
  ): Promise<{ recordingId: string; status: string }> {
    try {
      if (!this.isRecordingFeatureEnabled()) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording is currently disabled',
          undefined,
          { appointmentId },
          'VideoService.startSessionRecording'
        );
      }

      const provider = await this.getProvider();
      if (provider.providerName !== 'cloudflare') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording feature is only available with the active video provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.startSessionRecording'
        );
      }

      const consultation = await this.getConsultationSession(appointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.startSessionRecording'
        );
      }

      const activeProvider = provider as unknown as {
        startRecording: (
          sessionId: string,
          options?: {
            outputMode?: 'COMPOSED' | 'INDIVIDUAL';
            resolution?: string;
            frameRate?: number;
            customLayout?: string;
          }
        ) => Promise<{ id: string; status: string }>;
      };

      const recording = await activeProvider.startRecording(consultation.roomId, options);

      try {
        await this.createRecordingRecord({
          consultationId: consultation.id,
          recordingId: recording.id,
          fileName: `recording-${recording.id}.mp4`,
          filePath: `/recordings/${recording.id}.mp4`,
          storageProvider: provider.providerName,
        });
      } catch (createError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Recording started but failed to create recording metadata: ${createError instanceof Error ? createError.message : 'Unknown error'}`,
          'VideoService.startSessionRecording',
          {
            appointmentId,
            recordingId: recording.id,
            error: createError instanceof Error ? createError.message : String(createError),
          }
        );
      }

      // Emit event
      await this.eventService.emitEnterprise('video.recording.started', {
        eventId: `video-recording-started-${appointmentId}-${Date.now()}`,
        eventType: 'video.recording.started',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
        source: 'VideoService',
        version: '1.0.0',
        payload: {
          appointmentId,
          recordingId: recording.id,
          sessionId: consultation.roomId,
          outputMode: options?.outputMode,
        },
      });

      return {
        recordingId: recording.id,
        status: recording.status,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to start session recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.startSessionRecording',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Stop recording
   */
  async stopSessionRecording(
    appointmentId: string,
    recordingId: string
  ): Promise<{ recordingId: string; url?: string; duration: number }> {
    try {
      if (!this.isRecordingFeatureEnabled()) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording is currently disabled',
          undefined,
          { appointmentId, recordingId },
          'VideoService.stopSessionRecording'
        );
      }

      const provider = await this.getProvider();
      if (provider.providerName !== 'cloudflare') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording feature is only available with the active video provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.stopSessionRecording'
        );
      }

      const activeProvider = provider as unknown as {
        stopRecording: (recordingId: string) => Promise<{
          id: string;
          url?: string;
          duration: number;
        }>;
      };

      const recording = await activeProvider.stopRecording(recordingId);

      const consultation = await this.getConsultationSession(appointmentId);
      if (consultation) {
        await this.updateConsultationRecordingReference({
          consultationId: consultation.id,
          recordingId: recording.id,
          recordingUrl: recording.url,
          duration: recording.duration,
          isRecording: false,
        });
      }

      // Emit event
      await this.eventService.emitEnterprise('video.recording.stopped', {
        eventId: `video-recording-stopped-${appointmentId}-${Date.now()}`,
        eventType: 'video.recording.stopped',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
        source: 'VideoService',
        version: '1.0.0',
        payload: {
          appointmentId,
          recordingId: recording.id,
          url: recording.url,
          duration: recording.duration,
        },
      });

      // Queue recording processing (transcoding, thumbnails, metadata extraction) asynchronously
      if (this.queueService && recording.url) {
        void this.queueService
          .addJob(
            JobType.VIDEO_RECORDING,
            'process_recording',
            {
              appointmentId,
              recordingId: recording.id,
              recordingUrl: recording.url,
              duration:
                typeof recording.duration === 'number'
                  ? recording.duration
                  : Number(recording.duration),
              action: 'process_recording',
              metadata: {
                format: 'mp4',
                provider: provider.providerName,
              },
            },
            {
              priority: 5, // NORMAL priority (QueueService.PRIORITIES.NORMAL)
              attempts: 2,
            }
          )
          .catch((error: unknown) => {
            void this.loggingService.log(
              LogType.QUEUE,
              LogLevel.WARN,
              'Failed to queue video recording processing',
              'VideoService',
              {
                appointmentId,
                recordingId: recording.id,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          });
      }

      return {
        recordingId: recording.id,
        ...(recording.url !== undefined && {
          url: recording.url,
        }),
        duration: recording.duration,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to stop session recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.stopSessionRecording',
        {
          appointmentId,
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Get recordings for a session
   */
  async getSessionRecordings(appointmentId: string): Promise<
    Array<{
      recordingId: string;
      url?: string;
      duration: number;
      size: number;
      status: string;
      createdAt: string;
    }>
  > {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'cloudflare') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording feature is only available with the active video provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.getSessionRecordings'
        );
      }

      const consultation = await this.getConsultationSession(resolvedAppointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${resolvedAppointmentId}`,
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.getSessionRecordings'
        );
      }

      const activeProvider = provider as unknown as {
        listRecordings: (sessionId?: string) => Promise<
          Array<{
            id: string;
            url?: string;
            duration: number;
            size: number;
            status: string;
            createdAt: number;
          }>
        >;
      };

      const recordings = await activeProvider.listRecordings(consultation.roomId);

      return recordings.map(rec => ({
        recordingId: rec.id,
        ...(rec.url !== undefined && { url: rec.url }),
        duration: rec.duration,
        size: rec.size,
        status: rec.status,
        createdAt: new Date(rec.createdAt).toISOString(),
      }));
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get session recordings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.getSessionRecordings',
        {
          appointmentId: resolvedAppointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Manage participant (kick, mute, etc.)
   */
  async manageSessionParticipant(
    appointmentId: string,
    connectionId: string,
    action: 'kick' | 'mute' | 'unmute' | 'forceUnpublish'
  ): Promise<void> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'cloudflare') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Participant management is only available with the active video provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.manageSessionParticipant'
        );
      }

      const consultation = await this.getConsultationSession(resolvedAppointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${resolvedAppointmentId}`,
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.manageSessionParticipant'
        );
      }

      const activeProvider = provider as unknown as {
        kickParticipant: (sessionId: string, connectionId: string) => Promise<void>;
        forceUnpublish: (sessionId: string, streamId: string) => Promise<void>;
        getParticipants: (
          sessionId: string
        ) => Promise<Array<{ connectionId: string; streams: Array<{ streamId: string }> }>>;
      };

      if (action === 'kick') {
        await activeProvider.kickParticipant(consultation.roomId, connectionId);
      } else if (action === 'forceUnpublish') {
        const participants = await activeProvider.getParticipants(consultation.roomId);
        const participant = participants.find(p => p.connectionId === connectionId);
        if (participant && participant.streams.length > 0 && participant.streams[0]) {
          await activeProvider.forceUnpublish(consultation.roomId, participant.streams[0].streamId);
        }
      }
      // Note: mute/unmute are typically handled client-side by the active provider
      // But can be implemented via signal API if needed

      // Emit event
      await this.eventService.emitEnterprise('video.participant.managed', {
        eventId: `video-participant-managed-${resolvedAppointmentId}-${Date.now()}`,
        eventType: 'video.participant.managed',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
        source: 'VideoService',
        version: '1.0.0',
        payload: {
          appointmentId: resolvedAppointmentId,
          connectionId,
          action,
        },
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to manage session participant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.manageSessionParticipant',
        {
          appointmentId: resolvedAppointmentId,
          connectionId,
          action,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Get participants for a session
   */
  async getSessionParticipants(appointmentId: string): Promise<
    Array<{
      id: string;
      connectionId: string;
      role: string;
      location?: string;
      platform?: string;
      streams: Array<{
        streamId: string;
        hasAudio: boolean;
        hasVideo: boolean;
        audioActive: boolean;
        videoActive: boolean;
        typeOfVideo: 'CAMERA' | 'SCREEN';
      }>;
    }>
  > {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'cloudflare') {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Participant management is not exposed for provider '${provider.providerName}'. Returning an empty participant list.`,
          'VideoService.getSessionParticipants',
          { provider: provider.providerName }
        );
        return [];
      }

      const consultation = await this.getConsultationSession(resolvedAppointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${resolvedAppointmentId}`,
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.getSessionParticipants'
        );
      }

      const activeProvider = provider as unknown as {
        getParticipants: (sessionId: string) => Promise<
          Array<{
            id: string;
            connectionId: string;
            role: string;
            location?: string;
            platform?: string;
            streams: Array<{
              streamId: string;
              hasAudio: boolean;
              hasVideo: boolean;
              audioActive: boolean;
              videoActive: boolean;
              typeOfVideo: 'CAMERA' | 'SCREEN';
            }>;
          }>
        >;
      };

      return await activeProvider.getParticipants(consultation.roomId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get session participants: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.getSessionParticipants',
        {
          appointmentId: resolvedAppointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Get session analytics
   */
  async getSessionAnalytics(appointmentId: string): Promise<{
    sessionId: string;
    duration: number;
    numberOfParticipants: number;
    numberOfConnections: number;
    recordingCount: number;
    recordingTotalDuration: number;
    recordingTotalSize: number;
    connections: Array<{
      connectionId: string;
      duration: number;
      location?: string;
      platform?: string;
      publishers: number;
      subscribers: number;
    }>;
  }> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'cloudflare') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Session analytics is only available with the active video provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.getSessionAnalytics'
        );
      }

      const consultation = await this.getConsultationSession(resolvedAppointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${resolvedAppointmentId}`,
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.getSessionAnalytics'
        );
      }

      const activeProvider = provider as unknown as {
        getSessionAnalytics: (sessionId: string) => Promise<{
          sessionId: string;
          duration: number;
          numberOfParticipants: number;
          numberOfConnections: number;
          recordingCount: number;
          recordingTotalDuration: number;
          recordingTotalSize: number;
          connections: Array<{
            connectionId: string;
            duration: number;
            location?: string;
            platform?: string;
            publishers: number;
            subscribers: number;
          }>;
        }>;
      };

      return await activeProvider.getSessionAnalytics(consultation.roomId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get session analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.getSessionAnalytics',
        {
          appointmentId: resolvedAppointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}
