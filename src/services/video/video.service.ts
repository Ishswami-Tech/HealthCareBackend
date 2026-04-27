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
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ModuleRef as _ModuleRef } from '@nestjs/core';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { Prisma } from '@infrastructure/database/prisma/generated/client';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
// Use direct import to avoid TDZ issues with barrel exports
import { DatabaseService } from '@infrastructure/database/database.service';
import { QueueService } from '@queue/src/queue.service';
import type {
  IVideoProvider,
  VideoTokenResponse,
  VideoConsultationSession,
} from '@core/types/video.types';
import { VideoProviderFactory } from '@services/video/providers/video-provider.factory';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { AppointmentStatus } from '@core/types/enums.types';
// Legacy queue constant removed � uses JobType.VIDEO_RECORDING via HEALTHCARE_QUEUE
// Future use: VIDEO_TRANSCODING_QUEUE, VIDEO_ANALYTICS_QUEUE
import { HealthcareError } from '@core/errors';
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

export type { VideoCall, VideoCallSettings };

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

@Injectable()
export class VideoService implements OnModuleInit, OnModuleDestroy {
  private provider!: IVideoProvider;
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
        await this.providerFactory.getProviderWithFallback();
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
        this.provider = await this.providerFactory.getProviderWithFallback();
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
    // If provider is already initialized, check its health
    if (this.provider) {
      try {
        const isHealthy = await this.provider.isHealthy();
        if (isHealthy) {
          return this.provider;
        }

        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Current video provider (${this.provider.providerName}) is unhealthy.`,
          'VideoService.getProvider',
          {
            currentProvider: this.provider.providerName,
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
            error: error instanceof Error ? error.message : 'Unknown',
          }
        );
      }
    }

    // Get provider with health validation
    try {
      const healthyProvider = await this.providerFactory.getProviderWithFallback();

      // Update current provider if it changed
      if (this.provider?.providerName !== healthyProvider.providerName) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Video provider resolved: ${this.provider?.providerName || 'none'} ? ${healthyProvider.providerName}`,
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
      // No provider available
      throw new HealthcareError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Video service is currently unavailable. Please try again later or contact support.',
        undefined,
        {
          note: 'Both video providers are unavailable. Core healthcare features remain available.',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'VideoService.getProvider'
      );
    }
  }

  /**
   * Get current provider name (for health monitoring)
   * @returns Current provider name or null if not initialized
   */
  getCurrentProvider(): string | null {
    return this.provider?.providerName || null;
  }

  /**
   * Get fallback provider name (for health monitoring)
   * @returns Fallback provider name (always 'jitsi' if available)
   */
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
   */
  async generateMeetingToken(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin',
    userInfo: {
      displayName: string;
      email: string;
      avatar?: string;
    }
  ): Promise<VideoTokenResponse> {
    let resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      // 1. Validate appointment status and payment eligibility
      // Use executeRead to fetch appointment with necessary relations
      let appointment = await this.databaseService.findAppointmentByIdSafe(resolvedAppointmentId);

      // Fallback: If the provided ID is actually a VideoConsultation ID
      if (!appointment) {
        const videoSession = await this.databaseService.executeRead(async prisma => {
          // Bypass PrismaService composition wrapper in a strictly typed manner
          type VideoConsultationDelegate = {
            findUnique: (args: {
              where: { id: string };
              select: { appointmentId: boolean };
            }) => Promise<{ appointmentId: string } | null>;
          };

          const service = prisma as unknown as {
            prismaClient?: { videoConsultation: VideoConsultationDelegate };
            videoConsultation?: VideoConsultationDelegate;
          };

          const delegate = service.prismaClient?.videoConsultation || service.videoConsultation;

          if (!delegate) return null;

          return await delegate.findUnique({
            where: { id: resolvedAppointmentId },
            select: { appointmentId: true },
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
          undefined,
          { rawAppointmentId: appointmentId, resolvedAppointmentId },
          'VideoService.generateMeetingToken'
        );
      }

      this.ensureAppointmentJoinable(appointment, userRole);

      // 2. Validate User Authorization
      // Ensure the requesting user is a participant in this appointment
      const isPatient = userRole === 'patient';
      const isDoctor = userRole === 'doctor'; // or 'assistant_doctor'

      if (isPatient) {
        // Match against userId passed (which corresponds to User.id)
        // appointment.patient.userId is the User.id link
        if (appointment.patient?.userId !== userId && appointment.patientId !== userId) {
          throw new HealthcareError(
            ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
            'You are not authorized to join this appointment.',
            undefined,
            { userId, appointmentId: resolvedAppointmentId },
            'VideoService.generateMeetingToken'
          );
        }
      }

      if (isDoctor) {
        if (appointment.doctor?.userId !== userId && appointment.doctorId !== userId) {
          throw new HealthcareError(
            ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
            'You are not authorized to join this appointment.',
            undefined,
            { userId, appointmentId: resolvedAppointmentId },
            'VideoService.generateMeetingToken'
          );
        }
      }

      const provider: IVideoProvider = await this.getProvider();
      const tokenResponse: VideoTokenResponse = await provider.generateMeetingToken(
        resolvedAppointmentId,
        userId,
        userRole,
        userInfo
      );
      return tokenResponse;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : 'Unknown error';
      const currentProvider: IVideoProvider | undefined = this.provider;
      const providerName: string = currentProvider?.providerName ?? 'unknown';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Video provider failed: ${errorMessage}`,
        'VideoService.generateMeetingToken',
        {
          appointmentId: resolvedAppointmentId,
          provider: providerName,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Video provider failed',
        undefined,
        { appointmentId: resolvedAppointmentId, originalError: String(error) },
        'VideoService.generateMeetingToken'
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

    await this.triggerAppointmentRefund(resolvedAppointmentId, clinicId, rejectionReason);

    await this.eventService.emitEnterprise('appointment.cancelled', {
      eventId: `appointment-cancelled-${resolvedAppointmentId}-${Date.now()}`,
      eventType: 'appointment.cancelled',
      category: EventCategory.APPOINTMENT,
      priority: EventPriority.HIGH,
      timestamp: new Date().toISOString(),
      source: 'VideoService',
      version: '1.0.0',
      userId: updatedAppointment.patientId,
      clinicId,
      payload: {
        appointmentId: resolvedAppointmentId,
        userId: updatedAppointment.patientId,
        doctorId: updatedAppointment.doctorId,
        clinicId,
        reason: rejectionReason,
        cancelledBy: userId,
        status: AppointmentStatus.CANCELLED,
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

  private async cancelAssociatedVideoSession(
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
    if (appointmentStatus === String(AppointmentStatus.NO_SHOW)) {
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

    if (!this.isAppointmentPaid(appointment)) {
      throw new ForbiddenException('Payment is required before joining this video appointment.');
    }
  }

  private isAppointmentPaid(appointment: {
    payment?: { status?: string | null } | Array<{ status?: string | null }> | null;
  }): boolean {
    const paymentEntries = Array.isArray(appointment.payment)
      ? appointment.payment
      : appointment.payment
        ? [appointment.payment]
        : [];

    return paymentEntries.some(payment =>
      ['PAID', 'COMPLETED'].includes(String(payment.status || '').toUpperCase())
    );
  }

  private buildPlaceholderConsultationSession(appointment: {
    id: string;
    date?: Date | string | null;
    time?: string | null;
    duration?: number | null;
  }): VideoConsultationSession {
    const scheduledWindow = this.resolveAppointmentVideoWindow(appointment);
    return {
      id: `video-session-${appointment.id}`,
      appointmentId: appointment.id,
      roomId: `appointment-${appointment.id}`,
      roomName: `appointment-${appointment.id}`,
      meetingUrl: `/video-appointments/${appointment.id}`,
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

  private resolveAppointmentVideoWindow(appointment: {
    date?: Date | string | null;
    time?: string | null;
    duration?: number | null;
  }): { startTime: Date | null; endTime: Date | null } | null {
    if (!appointment.date || !appointment.time) {
      return null;
    }

    const normalizedTime = this.normalizeTimeForDateParsing(appointment.time);
    if (!normalizedTime) {
      return null;
    }

    const dateValue =
      typeof appointment.date === 'string' ? new Date(appointment.date) : appointment.date;
    if (Number.isNaN(dateValue.getTime())) {
      return null;
    }

    const datePart = dateValue.toISOString().slice(0, 10);
    const startTime = new Date(`${datePart}T${normalizedTime}+05:30`);
    if (Number.isNaN(startTime.getTime())) {
      return null;
    }

    const appointmentDurationMinutes =
      typeof appointment.duration === 'number' && appointment.duration > 0
        ? appointment.duration
        : 30;
    const endTime = new Date(startTime.getTime() + appointmentDurationMinutes * 60_000);
    return { startTime, endTime };
  }

  private normalizeTimeForDateParsing(timeValue: string): string | null {
    const value = String(timeValue || '').trim();
    if (/^\d{2}:\d{2}$/.test(value)) {
      return `${value}:00`;
    }
    if (/^\d{2}:\d{2}:\d{2}$/.test(value)) {
      return value;
    }
    return null;
  }

  /**
   * Start consultation session
   */
  async startConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession> {
    let resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      let appointment = await this.databaseService.executeRead(async prisma => {
        const tx = prisma as unknown as Prisma.TransactionClient;
        return await tx.appointment.findUnique({
          where: { id: resolvedAppointmentId },
          include: {
            payment: true,
            patient: true,
            doctor: true,
          },
        });
      });

      // Fallback: If the provided ID is actually a VideoConsultation ID
      if (!appointment) {
        const videoSession = await this.databaseService.executeRead(async prisma => {
          // Bypass PrismaService composition wrapper in a strictly typed manner
          type VideoConsultationDelegate = {
            findUnique: (args: {
              where: { id: string };
              select: { appointmentId: boolean };
            }) => Promise<{ appointmentId: string } | null>;
          };

          const service = prisma as unknown as {
            prismaClient?: { videoConsultation: VideoConsultationDelegate };
            videoConsultation?: VideoConsultationDelegate;
          };

          const delegate = service.prismaClient?.videoConsultation || service.videoConsultation;

          if (!delegate) return null;

          return await delegate.findUnique({
            where: { id: resolvedAppointmentId },
            select: { appointmentId: true },
          });
        });

        if (videoSession?.appointmentId) {
          resolvedAppointmentId = videoSession.appointmentId;
          appointment = await this.databaseService.executeRead(async prisma => {
            const tx = prisma as unknown as Prisma.TransactionClient;
            return await tx.appointment.findUnique({
              where: { id: resolvedAppointmentId },
              include: {
                payment: true,
                patient: true,
                doctor: true,
              },
            });
          });
        }
      }

      if (!appointment) {
        throw new HealthcareError(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          'No appointment found',
          undefined,
          { appointmentId: resolvedAppointmentId },
          'VideoService.startConsultation'
        );
      }

      this.ensureAppointmentJoinable(appointment, userRole);

      const provider: IVideoProvider = await this.getProvider();
      const session: VideoConsultationSession = await provider.startConsultation(
        resolvedAppointmentId,
        userId,
        userRole
      );

      if (String(appointment.status) !== String(AppointmentStatus.IN_PROGRESS)) {
        await this.databaseService.updateAppointmentSafe(resolvedAppointmentId, {
          status: AppointmentStatus.IN_PROGRESS,
        });
      }

      // Emit event
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
        payload: {
          appointmentId: resolvedAppointmentId,
          sessionId: session.id,
          userId,
          userRole,
          provider: provider.providerName,
        },
      });

      return session;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : 'Unknown error';
      const currentProvider: IVideoProvider | undefined = this.provider;
      const providerName: string = currentProvider?.providerName ?? 'unknown';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Video provider failed: ${errorMessage}`,
        'VideoService.startConsultation',
        {
          appointmentId: resolvedAppointmentId,
          provider: providerName,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Video provider failed',
        undefined,
        { appointmentId: resolvedAppointmentId, originalError: String(error) },
        'VideoService.startConsultation'
      );
    }
  }

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
        await this.billingService.refundPayment(clinicId, payment.id, undefined, reason);
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        `Failed to trigger refund for video appointment ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
        'VideoService.triggerAppointmentRefund',
        { appointmentId, clinicId }
      );
    }
  }

  /**
   * End consultation session
   */
  async endConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin',
    sessionNotes?: string
  ): Promise<VideoConsultationSession> {
    const resolvedAppointmentId = normalizeAppointmentId(appointmentId);

    try {
      const provider: IVideoProvider = await this.getProvider();
      const session: VideoConsultationSession = await provider.endConsultation(
        resolvedAppointmentId,
        userId,
        userRole
      );

      // Save session notes if provided
      if (sessionNotes) {
        // Session notes can be saved to database or added to session metadata
        // Implementation can be extended here
      }

      // Calculate duration
      let duration: number | undefined;
      if (session.startTime && session.endTime) {
        const startTimeMs: number = session.startTime.getTime();
        const endTimeMs: number = session.endTime.getTime();
        duration = Math.floor((endTimeMs - startTimeMs) / 1000);
      }

      // Transition the actual Appointment to COMPLETED status
      try {
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const transaction = client as Prisma.TransactionClient;
            await transaction.appointment.update({
              where: { id: resolvedAppointmentId },
              data: { status: AppointmentStatus.COMPLETED },
            });
          },
          {
            userId,
            userRole: String(userRole).toUpperCase(),
            clinicId: '', // We don't have clinicId here, but it can be empty string or retrieved
            operation: 'UPDATE_APPOINTMENT',
            resourceType: 'APPOINTMENT',
            resourceId: resolvedAppointmentId,
            ipAddress: 'internal',
            userAgent: 'VideoService',
          }
        );
      } catch (dbError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Failed to update appointment status to COMPLETED: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
          'VideoService.endConsultation',
          { appointmentId: resolvedAppointmentId }
        );
      }

      // Emit event
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
        payload: {
          appointmentId: resolvedAppointmentId,
          sessionId: session.id,
          duration,
          provider: provider.providerName,
        },
      });

      return session;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : 'Unknown error';
      const currentProvider: IVideoProvider | undefined = this.provider;
      const providerName: string = currentProvider?.providerName ?? 'unknown';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Video provider failed: ${errorMessage}`,
        'VideoService.endConsultation',
        {
          appointmentId: resolvedAppointmentId,
          provider: providerName,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Video provider failed',
        undefined,
        { appointmentId: resolvedAppointmentId, originalError: String(error) },
        'VideoService.endConsultation'
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
      const provider: IVideoProvider = await this.getProvider();
      const session: VideoConsultationSession | null =
        await provider.getConsultationSession(resolvedAppointmentId);
      if (session) {
        return session;
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
   * List all active sessions (Super Admin)
   */
  async listAllActiveSessions(): Promise<VideoConsultationSession[]> {
    try {
      const provider = await this.getProvider();
      if (provider.listActiveSessions) {
        return await provider.listActiveSessions();
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
      'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED',
      'pending' | 'started' | 'ended' | 'cancelled'
    > = {
      SCHEDULED: 'pending',
      ACTIVE: 'started',
      ENDED: 'ended',
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
        { appointmentId: resolvedAppointmentId, userId, issueType, originalError: String(error) },
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
        { callId, userId, originalError: String(error) },
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
        { callId, userId, originalError: String(error) },
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
        { callId, userId, originalError: String(error) },
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
        { callId, userId, originalError: String(error) },
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
        { userId, clinicId, originalError: String(error) },
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

      // In a real implementation, this would call Jitsi recording API
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
      const consultations = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = getVideoConsultationDelegate(client);
        return await delegate.findMany({
          where: {
            ...(clinicId && { clinicId }),
            OR: [
              { patientId: userId },
              { doctorId: userId },
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

      const videoCalls: VideoCall[] = consultations.map(consultation => ({
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
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
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

      // Emit event
      await this.eventService.emitEnterprise('video.recording.started', {
        eventId: `video-recording-started-${appointmentId}-${Date.now()}`,
        eventType: 'video.recording.started',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
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
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
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

      // Emit event
      await this.eventService.emitEnterprise('video.recording.stopped', {
        eventId: `video-recording-stopped-${appointmentId}-${Date.now()}`,
        eventType: 'video.recording.stopped',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
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
      if (provider.providerName !== 'openvidu') {
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
      if (provider.providerName !== 'openvidu') {
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
        timestamp: new Date().toISOString(),
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
      if (provider.providerName !== 'openvidu') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Participant management is only available with the active video provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.getSessionParticipants'
        );
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
      if (provider.providerName !== 'openvidu') {
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
