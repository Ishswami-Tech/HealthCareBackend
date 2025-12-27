/**
 * Video Service - Consolidated Single Service
 * @class VideoService
 * @description SINGLE video service for all video operations
 *
 * This is the ONLY video service in the application.
 * Provider-agnostic: works with OpenVidu (primary), Jitsi (fallback).
 *
 * Architecture:
 * - Uses Factory pattern for provider selection
 * - OpenVidu as primary (modern, AI-ready)
 * - Jitsi as fallback (already working, reliable)
 * - Automatic fallback if primary provider fails
 * - Follows SOLID principles
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache';
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
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { VIDEO_RECORDING_QUEUE } from '@queue/src/queue.constants';
// Future use: VIDEO_TRANSCODING_QUEUE, VIDEO_ANALYTICS_QUEUE
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { isVideoCallAppointment } from '@core/types/appointment-guards.types';
import type { VideoCallAppointment } from '@core/types/appointment.types';
import type { VideoCall, VideoCallSettings, ServiceResponse } from '@core/types';
import type { VideoConsultationSession as AppointmentVideoConsultationSession } from '@core/types/appointment.types';
import {
  getVideoConsultationDelegate,
  getVideoRecordingDelegate,
} from '@core/types/video-database.types';

export type { VideoCall, VideoCallSettings };

// Type aliases for response data structures using existing ServiceResponse<T>
type CreateVideoCallResponse = ServiceResponse<VideoCall>;
type JoinVideoCallResponse = ServiceResponse<{
  callId: string;
  meetingUrl?: string;
  joinToken: string;
  settings: VideoCallSettings;
}>;
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

// Database consultation type (matches Prisma schema)
interface VideoConsultation {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  roomId: string;
  status: string;
  meetingUrl: string | null;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  recordingUrl: string | null;
  recordingEnabled: boolean;
  screenSharingEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomEnabled: boolean;
  autoRecord: boolean;
  maxParticipants: number;
  participants: Array<{ userId: string }>;
}

@Injectable()
export class VideoService implements OnModuleInit, OnModuleDestroy {
  private provider!: IVideoProvider;
  private fallbackProvider!: IVideoProvider;
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
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize provider (OpenVidu ONLY - no fallback)
    this.provider = await this.providerFactory.getProviderWithFallback();
    // Note: No fallback provider - OpenVidu only configuration
    // this.fallbackProvider = this.providerFactory.getFallbackProvider();

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Video Service initialized (OpenVidu ONLY - no Jitsi fallback)',
      'VideoService',
      {
        provider: this.provider.providerName,
        fallbackDisabled: true,
      }
    );
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
   * Get current provider (OpenVidu only - no fallback)
   */
  private async getProvider(): Promise<IVideoProvider> {
    // Check if primary provider is healthy
    const isHealthy = await this.provider.isHealthy();
    if (isHealthy) {
      return this.provider;
    }

    // No fallback provider - OpenVidu only configuration
    // Log warning and return primary provider anyway (let caller handle errors)
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Video provider (${this.provider.providerName}) health check failed, but no fallback available`,
      'VideoService.getProvider',
      {
        provider: this.provider.providerName,
      }
    );

    return this.provider;
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
    userRole: 'patient' | 'doctor',
    userInfo: {
      displayName: string;
      email: string;
      avatar?: string;
    }
  ): Promise<VideoTokenResponse> {
    try {
      const provider = await this.getProvider();
      return await provider.generateMeetingToken(appointmentId, userId, userRole, userInfo);
    } catch (error) {
      // No fallback provider - OpenVidu only configuration
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Video provider failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.generateMeetingToken',
        {
          appointmentId,
          provider: this.provider?.providerName ?? 'unknown',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Start consultation session
   */
  async startConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor'
  ): Promise<VideoConsultationSession> {
    try {
      const provider = await this.getProvider();
      const session = await provider.startConsultation(appointmentId, userId, userRole);

      // Emit event
      await this.eventService.emitEnterprise('video.consultation.started', {
        eventId: `video-consultation-started-${appointmentId}-${Date.now()}`,
        eventType: 'video.consultation.started',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoService',
        version: '1.0.0',
        payload: {
          appointmentId,
          sessionId: session.id,
          userId,
          userRole,
          provider: provider.providerName,
        },
      });

      return session;
    } catch (error) {
      // No fallback provider - OpenVidu only configuration
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Video provider failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.startConsultation',
        {
          appointmentId,
          provider: this.provider?.providerName ?? 'unknown',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * End consultation session
   */
  async endConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor',
    sessionNotes?: string
  ): Promise<VideoConsultationSession> {
    try {
      const provider = await this.getProvider();
      const session = await provider.endConsultation(appointmentId, userId, userRole);

      // Save session notes if provided
      if (sessionNotes) {
        // Session notes can be saved to database or added to session metadata
        // Implementation can be extended here
      }

      // Calculate duration
      const duration =
        session.startTime && session.endTime
          ? Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 1000)
          : undefined;

      // Emit event
      await this.eventService.emitEnterprise('video.consultation.ended', {
        eventId: `video-consultation-ended-${appointmentId}-${Date.now()}`,
        eventType: 'video.consultation.ended',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoService',
        version: '1.0.0',
        payload: {
          appointmentId,
          sessionId: session.id,
          duration,
          provider: provider.providerName,
        },
      });

      return session;
    } catch (error) {
      // No fallback provider - OpenVidu only configuration
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Video provider failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.endConsultation',
        {
          appointmentId,
          provider: this.provider?.providerName ?? 'unknown',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Get consultation session
   */
  async getConsultationSession(appointmentId: string): Promise<VideoConsultationSession | null> {
    try {
      const provider = await this.getProvider();
      return await provider.getConsultationSession(appointmentId);
    } catch (_error) {
      // No fallback provider - OpenVidu only configuration
      return null;
    }
  }

  /**
   * Get consultation status
   * Returns consultation session in appointment format for plugin compatibility
   */
  async getConsultationStatus(
    appointmentId: string
  ): Promise<AppointmentVideoConsultationSession | null> {
    const session = await this.getConsultationSession(appointmentId);
    if (!session) {
      return null;
    }

    // Map to legacy format
    return {
      appointmentId: session.appointmentId,
      roomName: session.roomName,
      status:
        session.status === 'SCHEDULED'
          ? 'pending'
          : session.status === 'ACTIVE'
            ? 'started'
            : session.status === 'ENDED'
              ? 'ended'
              : 'cancelled',
      startTime: session.startTime || undefined,
      endTime: session.endTime || undefined,
      participants: session.participants.map(p => {
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
      }),
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
    try {
      const session = await this.getConsultationSession(appointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.reportTechnicalIssue'
        );
      }

      // Store technical issue in cache
      const cacheKey = `video_session:${appointmentId}`;
      const cachedSessionValue: unknown = await this.cacheService.get(cacheKey);

      if (
        cachedSessionValue &&
        typeof cachedSessionValue === 'object' &&
        cachedSessionValue !== null
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
        `Technical issue reported for appointment ${appointmentId}`,
        'VideoService.reportTechnicalIssue',
        {
          appointmentId,
          issueType,
          reportedBy: userId,
          description: issueDescription,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to report technical issue for appointment ${appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.reportTechnicalIssue',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          issueType,
          appointmentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process recording after consultation
   */
  async processRecording(appointmentId: string, recordingUrl: string): Promise<void> {
    try {
      const session = await this.getConsultationSession(appointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.processRecording'
        );
      }

      // Update session with recording URL in cache
      const cacheKey = `video_session:${appointmentId}`;
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
        `Processing recording for appointment ${appointmentId}`,
        'VideoService.processRecording',
        {
          recordingUrl,
          appointmentId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process recording for appointment ${appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.processRecording',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
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

    try {
      // Validate appointment exists and belongs to participants
      await this.validateAppointment(appointmentId, patientId, doctorId, clinicId);

      // Generate unique meeting URL
      const meetingUrl = await this.generateMeetingUrl(appointmentId);

      // Create video call record
      const videoCall: VideoCall = {
        id: `vc-${appointmentId}-${Date.now()}`,
        appointmentId,
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

      // Store in database (placeholder implementation)
      await this.storeVideoCall(videoCall);

      // Cache the video call
      const cacheKey = `videocall:${videoCall.id}`;
      await this.cacheService.set(cacheKey, JSON.stringify(videoCall), this.VIDEO_CACHE_TTL);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Video call created successfully',
        'VideoService',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      const response: CreateVideoCallResponse = {
        success: true,
        data: videoCall,
        message: 'Video call created successfully',
      };
      return response;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create video call: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async joinVideoCall(callId: string, userId: string): Promise<JoinVideoCallResponse> {
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

      // Update call status if first participant
      if (videoCall.status === 'scheduled') {
        videoCall.status = 'active';
        videoCall.startTime = new Date().toISOString();
        await this.updateVideoCall(videoCall);
      }

      // Generate join token
      const joinToken = await this.generateJoinToken(callId, userId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'User joined video call successfully',
        'VideoService',
        { callId, userId, responseTime: Date.now() - startTime }
      );

      const response: JoinVideoCallResponse = {
        success: true,
        data: {
          callId,
          ...(videoCall.meetingUrl && { meetingUrl: videoCall.meetingUrl }),
          joinToken,
          settings: videoCall.settings,
        },
        message: 'User joined video call successfully',
      };
      return response;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to join video call: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async startRecording(callId: string, userId: string): Promise<unknown> {
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

      // Start recording (placeholder implementation)
      const recordingId = await this.initiateRecording(callId);

      // Update video call with recording info
      videoCall.recordingUrl = `https://recordings.example.com/${recordingId}`;
      await this.updateVideoCall(videoCall);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Recording started successfully',
        'VideoService',
        { callId, userId, recordingId, responseTime: Date.now() - startTime }
      );

      const response: RecordingResponse = {
        success: true,
        data: {
          recordingId,
          recordingUrl: videoCall.recordingUrl,
        },
        message: 'Recording started',
      };
      return response;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start recording: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async stopRecording(callId: string, userId: string): Promise<unknown> {
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

      // Stop recording (placeholder implementation)
      const recordingResult = await this.finalizeRecording(callId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Recording stopped successfully',
        'VideoService',
        { callId, userId, responseTime: Date.now() - startTime }
      );

      const response: RecordingResponse = {
        success: true,
        data: {
          ...(videoCall.recordingUrl && { recordingUrl: videoCall.recordingUrl }),
          duration: recordingResult.duration,
        },
        message: 'Recording stopped',
      };
      return response;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to stop recording: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
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
      videoCall.status = 'completed';
      videoCall.endTime = new Date().toISOString();
      if (videoCall.startTime) {
        videoCall.duration = Math.floor(
          (new Date(videoCall.endTime).getTime() - new Date(videoCall.startTime).getTime()) / 1000
        );
      }

      await this.updateVideoCall(videoCall);

      // Stop any active recording
      if (videoCall.recordingUrl) {
        await this.stopRecording(callId, userId);
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Video call ended successfully',
        'VideoService',
        {
          callId,
          userId,
          duration: videoCall.duration,
          responseTime: Date.now() - startTime,
        }
      );

      const response: EndVideoCallResponse = {
        success: true,
        data: {
          callId,
          ...(videoCall.duration !== undefined && { duration: videoCall.duration }),
        },
        message: 'Video call ended',
      };
      return response;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end video call: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async shareMedicalImage(
    callId: string,
    userId: string,
    imageData: Record<string, unknown>
  ): Promise<ShareMedicalImageResponse> {
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

      // Upload and share image (placeholder implementation)
      const imageUrl = await this.uploadMedicalImage(imageData, callId, userId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Medical image shared successfully',
        'VideoService',
        { callId, userId, imageUrl, responseTime: Date.now() - startTime }
      );

      const response: ShareMedicalImageResponse = {
        success: true,
        data: {
          imageUrl,
        },
        message: 'Medical image shared',
      };
      return response;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to share medical image: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getVideoCallHistory(userId: string, clinicId?: string): Promise<VideoCallHistoryResponse> {
    const startTime = Date.now();
    const cacheKey = `videocalls:history:${userId}:${clinicId || 'all'}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as VideoCallHistoryResponse;
      }

      // Get video call history from database (placeholder implementation)
      const calls = await this.fetchVideoCallHistory(userId, clinicId);

      const result: VideoCallHistoryResponse = {
        success: true,
        data: {
          userId,
          ...(clinicId && { clinicId }),
          calls,
          total: calls.length,
          retrievedAt: new Date().toISOString(),
        },
        message: 'Video call history retrieved successfully',
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.VIDEO_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Video call history retrieved successfully',
        'VideoService',
        {
          userId,
          clinicId,
          count: calls.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get video call history: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          userId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
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
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    // Runtime validation at boundary - narrow to VideoCallAppointment
    if (!isVideoCallAppointment(appointment)) {
      throw new BadRequestException(`Appointment ${appointmentId} is not a video consultation`);
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

  /**
   * Generate join token for video call
   * @param callId - The video call ID
   * @param userId - The user ID
   * @returns JWT token for joining the video call
   */
  private async generateJoinToken(callId: string, userId: string): Promise<string> {
    // Get video consultation to find appointment
    const consultation = await this.getVideoConsultationByCallId(callId);
    if (!consultation) {
      throw new NotFoundException(`Video consultation not found for call ${callId}`);
    }

    // Get appointment to validate type
    const appointment = await this.databaseService.findAppointmentByIdSafe(
      consultation.appointmentId
    );
    if (!appointment) {
      throw new NotFoundException(`Appointment ${consultation.appointmentId} not found`);
    }
    if (!isVideoCallAppointment(appointment)) {
      throw new BadRequestException(
        `Appointment ${consultation.appointmentId} is not a video consultation`
      );
    }

    // Determine user role
    const userRole = consultation.patientId === userId ? 'patient' : 'doctor';

    // Generate token using provider (OpenVidu primary, Jitsi fallback)
    const tokenData = await this.generateMeetingToken(
      consultation.appointmentId,
      userId,
      userRole,
      {
        displayName: 'User',
        email: '',
      }
    );

    return tokenData.token;
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
    if (cached) {
      return JSON.parse(cached as string) as VideoCall;
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
      ...(consultation.meetingUrl && { meetingUrl: consultation.meetingUrl }),
      participants: consultation.participants.map((p: { userId: string }) => p.userId),
      ...(consultation.startTime && { startTime: consultation.startTime.toISOString() }),
      ...(consultation.endTime && { endTime: consultation.endTime.toISOString() }),
      ...(consultation.duration && { duration: consultation.duration }),
      ...(consultation.recordingUrl && { recordingUrl: consultation.recordingUrl }),
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

  private async getVideoConsultationByCallId(callId: string): Promise<VideoConsultation | null> {
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
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const delegate = getVideoConsultationDelegate(client);
            return await delegate.update({
              where: { id: consultation.id },
              data: {
                status: this.mapVideoCallStatusToDbStatus(videoCall.status),
                meetingUrl: videoCall.meetingUrl,
                ...(videoCall.startTime && { startTime: new Date(videoCall.startTime) }),
                ...(videoCall.endTime && { endTime: new Date(videoCall.endTime) }),
                ...(videoCall.duration && { duration: videoCall.duration }),
                ...(videoCall.recordingUrl && { recordingUrl: videoCall.recordingUrl }),
                recordingEnabled: videoCall.settings.recordingEnabled,
                screenSharingEnabled: videoCall.settings.screenSharingEnabled,
                chatEnabled: videoCall.settings.chatEnabled,
                waitingRoomEnabled: videoCall.settings.waitingRoomEnabled,
                autoRecord: videoCall.settings.autoRecord,
                maxParticipants: videoCall.settings.maxParticipants,
              },
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
      const duration =
        consultation.startTime && consultation.endTime
          ? Math.floor((consultation.endTime.getTime() - consultation.startTime.getTime()) / 1000)
          : 0;

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
    // This would integrate with actual file storage service
    // For now, return mock URL
    return Promise.resolve(
      `https://images.example.com/medical/${callId}/${userId}/${Date.now()}.jpg`
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

      const videoCalls = consultations.map(consultation => ({
        id: consultation.id,
        appointmentId: consultation.appointmentId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        clinicId: consultation.clinicId,
        status: this.mapDbStatusToVideoCallStatus(consultation.status),
        ...(consultation.meetingUrl && { meetingUrl: consultation.meetingUrl }),
        participants: consultation.participants.map((p: { userId: string }) => p.userId),
        ...(consultation.startTime && { startTime: consultation.startTime.toISOString() }),
        ...(consultation.endTime && { endTime: consultation.endTime.toISOString() }),
        ...(consultation.duration && { duration: consultation.duration }),
        ...(consultation.recordingUrl && { recordingUrl: consultation.recordingUrl }),
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

  /**
   * Get current provider name
   */
  getCurrentProvider(): string {
    if (!this.provider) {
      return 'unknown';
    }
    return this.provider.providerName;
  }

  /**
   * Get fallback provider name
   */
  getFallbackProvider(): string {
    if (!this.fallbackProvider) {
      return 'unknown';
    }
    return this.fallbackProvider.providerName;
  }

  /**
   * Check if video service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.provider) {
        return false;
      }
      const provider = await this.getProvider();
      return await provider.isHealthy();
    } catch {
      return false;
    }
  }

  // ============================================================================
  // OPENVIDU PRO FEATURES
  // ============================================================================

  /**
   * OpenVidu Pro - Start recording for a session
   */
  async startOpenViduRecording(
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
          'Recording feature is only available with OpenVidu provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.startOpenViduRecording'
        );
      }

      const consultation = await this.getConsultationSession(appointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.startOpenViduRecording'
        );
      }

      const openviduProvider = provider as unknown as {
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

      const recording = await openviduProvider.startRecording(consultation.roomId, options);

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
        `Failed to start OpenVidu recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.startOpenViduRecording',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Stop recording
   */
  async stopOpenViduRecording(
    appointmentId: string,
    recordingId: string
  ): Promise<{ recordingId: string; url?: string; duration: number }> {
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording feature is only available with OpenVidu provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.stopOpenViduRecording'
        );
      }

      const openviduProvider = provider as unknown as {
        stopRecording: (recordingId: string) => Promise<{
          id: string;
          url?: string;
          duration: number;
        }>;
      };

      const recording = await openviduProvider.stopRecording(recordingId);

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
            VIDEO_RECORDING_QUEUE as string,
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
                provider: 'openvidu',
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
        `Failed to stop OpenVidu recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.stopOpenViduRecording',
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
   * OpenVidu Pro - Get recordings for a session
   */
  async getOpenViduRecordings(appointmentId: string): Promise<
    Array<{
      recordingId: string;
      url?: string;
      duration: number;
      size: number;
      status: string;
      createdAt: string;
    }>
  > {
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Recording feature is only available with OpenVidu provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.getOpenViduRecordings'
        );
      }

      const consultation = await this.getConsultationSession(appointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.getOpenViduRecordings'
        );
      }

      const openviduProvider = provider as unknown as {
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

      const recordings = await openviduProvider.listRecordings(consultation.roomId);

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
        `Failed to get OpenVidu recordings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.getOpenViduRecordings',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Manage participant (kick, mute, etc.)
   */
  async manageOpenViduParticipant(
    appointmentId: string,
    connectionId: string,
    action: 'kick' | 'mute' | 'unmute' | 'forceUnpublish'
  ): Promise<void> {
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Participant management is only available with OpenVidu provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.manageOpenViduParticipant'
        );
      }

      const consultation = await this.getConsultationSession(appointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.manageOpenViduParticipant'
        );
      }

      const openviduProvider = provider as unknown as {
        kickParticipant: (sessionId: string, connectionId: string) => Promise<void>;
        forceUnpublish: (sessionId: string, streamId: string) => Promise<void>;
        getParticipants: (
          sessionId: string
        ) => Promise<Array<{ connectionId: string; streams: Array<{ streamId: string }> }>>;
      };

      if (action === 'kick') {
        await openviduProvider.kickParticipant(consultation.roomId, connectionId);
      } else if (action === 'forceUnpublish') {
        const participants = await openviduProvider.getParticipants(consultation.roomId);
        const participant = participants.find(p => p.connectionId === connectionId);
        if (participant && participant.streams.length > 0 && participant.streams[0]) {
          await openviduProvider.forceUnpublish(
            consultation.roomId,
            participant.streams[0].streamId
          );
        }
      }
      // Note: mute/unmute are typically handled client-side in OpenVidu
      // But can be implemented via signal API if needed

      // Emit event
      await this.eventService.emitEnterprise('video.participant.managed', {
        eventId: `video-participant-managed-${appointmentId}-${Date.now()}`,
        eventType: 'video.participant.managed',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoService',
        version: '1.0.0',
        payload: {
          appointmentId,
          connectionId,
          action,
        },
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to manage OpenVidu participant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.manageOpenViduParticipant',
        {
          appointmentId,
          connectionId,
          action,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Get participants for a session
   */
  async getOpenViduParticipants(appointmentId: string): Promise<
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
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Participant management is only available with OpenVidu provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.getOpenViduParticipants'
        );
      }

      const consultation = await this.getConsultationSession(appointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.getOpenViduParticipants'
        );
      }

      const openviduProvider = provider as unknown as {
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

      return await openviduProvider.getParticipants(consultation.roomId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu participants: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.getOpenViduParticipants',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Get session analytics
   */
  async getOpenViduSessionAnalytics(appointmentId: string): Promise<{
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
    try {
      const provider = await this.getProvider();
      if (provider.providerName !== 'openvidu') {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Session analytics is only available with OpenVidu provider',
          undefined,
          { provider: provider.providerName },
          'VideoService.getOpenViduSessionAnalytics'
        );
      }

      const consultation = await this.getConsultationSession(appointmentId);
      if (!consultation) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'VideoService.getOpenViduSessionAnalytics'
        );
      }

      const openviduProvider = provider as unknown as {
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

      return await openviduProvider.getSessionAnalytics(consultation.roomId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu session analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoService.getOpenViduSessionAnalytics',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}
