/**
 * OpenVidu Video Provider
 * @class OpenViduVideoProvider
 * @description OpenVidu implementation of IVideoProvider
 * Primary video provider with modern architecture and AI-ready integration
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
// Use direct imports to avoid TDZ issues with barrel exports
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database/database.service';
import { HttpService } from '@infrastructure/http';
import type { HttpRequestOptions } from '@core/types';
import { ConfigService } from '@config';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { isVideoCallAppointment } from '@core/types/appointment-guards.types';
import type {
  IVideoProvider,
  VideoProviderType,
  VideoTokenResponse,
  VideoConsultationSession,
  OpenViduRoomConfig,
  OpenViduRecording,
  OpenViduParticipant,
  OpenViduSessionAnalytics,
  OpenViduSessionInfo,
} from '@core/types/video.types';
import * as crypto from 'crypto';
import type { VideoProviderConfig } from '@core/types/video.types';
import { getVideoConsultationDelegate } from '@core/types/video-database.types';

@Injectable()
export class OpenViduVideoProvider implements IVideoProvider {
  readonly providerName: VideoProviderType = 'openvidu';
  private readonly MEETING_CACHE_TTL = 3600; // 1 hour
  private readonly apiUrl: string;
  private readonly secret: string;
  private readonly domain: string;

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {
    const videoConfig = this.configService.get<VideoProviderConfig>('video');
    this.apiUrl = videoConfig?.openvidu?.url || 'http://openvidu-server:4443';
    this.secret = videoConfig?.openvidu?.secret || '';
    this.domain =
      videoConfig?.openvidu?.domain ||
      (() => {
        const envDomain = this.configService.getEnv('OPENVIDU_DOMAIN');
        if (!envDomain) {
          throw new Error(
            'Missing required environment variable: OPENVIDU_DOMAIN. ' +
              'Please set OPENVIDU_DOMAIN in your environment configuration.'
          );
        }
        return envDomain;
      })();
  }

  /**
   * Check if provider is enabled
   */
  isEnabled(): boolean {
    const videoConfig = this.configService.get<VideoProviderConfig>('video');
    return videoConfig?.enabled === true && videoConfig?.provider === 'openvidu';
  }

  /**
   * Generate authorization header for OpenVidu API
   */
  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`OPENVIDUAPP:${this.secret}`).toString('base64')}`;
  }

  /**
   * Get HTTP request config with SSL verification skipped in development
   */
  private getHttpConfig(options?: {
    headers?: Record<string, string>;
    timeout?: number;
  }): HttpRequestOptions {
    // Use the centralized HTTP service's getHttpConfig for SSL handling
    const baseConfig = this.httpService.getHttpConfig({
      ...options,
    });

    // Build HttpRequestOptions with merged headers
    const result: HttpRequestOptions = {
      headers: {
        Authorization: this.getAuthHeader(),
        ...(options?.headers || {}),
      },
    };

    // Only include timeout if it's defined (for exactOptionalPropertyTypes)
    if (options?.timeout !== undefined) {
      result.timeout = options.timeout;
    } else if (baseConfig.timeout !== undefined) {
      result.timeout = baseConfig.timeout;
    }

    // Note: httpsAgent is already handled by httpService.getHttpConfig() for SSL in dev
    // We don't need to copy it here as it will be applied automatically

    return result;
  }

  /**
   * Generate secure room name
   */
  private generateSecureRoomName(appointmentId: string, clinicId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${appointmentId}-${clinicId}-${Date.now()}`)
      .digest('hex');
    return `appointment-${appointmentId}-${hash.substring(0, 8)}`;
  }

  /**
   * Create or get OpenVidu session
   */
  private async createOrGetSession(roomName: string): Promise<OpenViduRoomConfig> {
    try {
      // Try to get existing session
      const response = await this.httpService.get<OpenViduRoomConfig>(
        `${this.apiUrl}/openvidu/api/sessions/${roomName}`,
        this.getHttpConfig()
      );

      if (response.data) {
        return response.data;
      }
    } catch (error) {
      // Session doesn't exist, create new one
      if (
        error instanceof HealthcareError &&
        error.metadata &&
        typeof error.metadata === 'object' &&
        'status' in error.metadata &&
        error.metadata['status'] === 404
      ) {
        // Session doesn't exist, create it
      } else {
        throw error;
      }
    }

    // Create new session
    const createResponse = await this.httpService.post<OpenViduRoomConfig>(
      `${this.apiUrl}/openvidu/api/sessions`,
      {
        customSessionId: roomName,
        mediaMode: 'ROUTED',
        recordingMode: 'MANUAL',
        defaultRecordingProperties: {
          name: `Consultation-${roomName}`,
          hasAudio: true,
          hasVideo: true,
          outputMode: 'COMPOSED',
          resolution: '1280x720',
          frameRate: 30,
        },
      },
      this.getHttpConfig({
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    return createResponse.data;
  }

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
      // Get appointment to create VideoConsultation
      const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
      if (!appointment) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Appointment ${appointmentId} not found`,
          undefined,
          { appointmentId },
          'OpenViduVideoProvider.generateMeetingToken'
        );
      }

      // Runtime validation
      if (!isVideoCallAppointment(appointment)) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          `Appointment ${appointmentId} is not a video consultation`,
          undefined,
          { appointmentId, type: appointment.type },
          'OpenViduVideoProvider.generateMeetingToken'
        );
      }

      // Generate room name
      const roomName = this.generateSecureRoomName(appointmentId, appointment.clinicId);
      const roomId = roomName;

      // Create or get session
      const session = await this.createOrGetSession(roomName);

      // Generate token
      // Use Connection API (new API) instead of deprecated Token API
      interface OpenViduConnectionResponse {
        token: string;
        id: string;
        connectionId?: string;
        session?: string;
        createdAt?: number;
        status?: string;
      }
      const connectionResponse = await this.httpService.post<OpenViduConnectionResponse>(
        `${this.apiUrl}/openvidu/api/sessions/${session.id}/connection`,
        {
          role: userRole === 'doctor' ? 'PUBLISHER' : 'SUBSCRIBER',
          data: JSON.stringify({
            userId,
            userRole,
            displayName: userInfo.displayName,
            email: userInfo.email,
            avatar: userInfo.avatar,
          }),
        },
        this.getHttpConfig({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      const token = connectionResponse.data.token;
      const meetingUrl = `${this.apiUrl}/#/sessions/${session.id}?token=${token}`;

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          const existing = await delegate.findFirst({
            where: { OR: [{ appointmentId }] },
          });

          if (!existing) {
            await delegate.create({
              data: {
                appointmentId,
                patientId: appointment.patientId,
                doctorId: appointment.doctorId,
                clinicId: appointment.clinicId,
                roomId,
                meetingUrl,
                status: 'SCHEDULED',
                recordingEnabled: true,
                screenSharingEnabled: true,
                chatEnabled: true,
                waitingRoomEnabled: true,
                autoRecord: false,
                maxParticipants: 2,
              },
            });
          }
        },
        {
          userId: appointment.doctorId,
          userRole: 'DOCTOR',
          clinicId: appointment.clinicId,
          operation: 'CREATE_VIDEO_CONSULTATION',
          resourceType: 'VIDEO_CONSULTATION',
          resourceId: appointmentId,
          timestamp: new Date(),
        }
      );

      const response: VideoTokenResponse = {
        token,
        roomName,
        roomId,
        meetingUrl,
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
      };
      return response;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to generate OpenVidu meeting token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.generateMeetingToken',
        {
          appointmentId,
          userId,
          userRole,
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
      // Get existing session or create new one
      let session = await this.getConsultationSession(appointmentId);
      if (!session) {
        // Generate token to create session
        const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
        if (!appointment || !isVideoCallAppointment(appointment)) {
          throw new HealthcareError(
            ErrorCode.DATABASE_RECORD_NOT_FOUND,
            `Appointment ${appointmentId} not found or not a video consultation`,
            undefined,
            { appointmentId },
            'OpenViduVideoProvider.startConsultation'
          );
        }

        await this.generateMeetingToken(appointmentId, userId, userRole, {
          displayName: 'User',
          email: '',
        });
        session = await this.getConsultationSession(appointmentId);
        if (!session) {
          throw new HealthcareError(
            ErrorCode.DATABASE_RECORD_NOT_FOUND,
            `Failed to create consultation session for appointment ${appointmentId}`,
            undefined,
            { appointmentId },
            'OpenViduVideoProvider.startConsultation'
          );
        }
      }

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          // Find consultation by appointmentId to get its id
          const consultation = await delegate.findFirst({
            where: { OR: [{ appointmentId }] },
          });
          if (!consultation) {
            throw new HealthcareError(
              ErrorCode.DATABASE_RECORD_NOT_FOUND,
              `Video consultation not found for appointment ${appointmentId}`,
              undefined,
              { appointmentId },
              'OpenViduVideoProvider.startConsultation'
            );
          }
          // Update using id
          return await delegate.update({
            where: { id: consultation.id },
            data: {
              status: 'ACTIVE',
              startTime: new Date(),
            },
          });
        },
        {
          userId,
          userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
          clinicId: '',
          operation: 'START_VIDEO_CONSULTATION',
          resourceType: 'VIDEO_CONSULTATION',
          resourceId: appointmentId,
          timestamp: new Date(),
        }
      );

      return (await this.getConsultationSession(appointmentId))!;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to start OpenVidu consultation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.startConsultation',
        {
          appointmentId,
          userId,
          userRole,
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
    userRole: 'patient' | 'doctor'
  ): Promise<VideoConsultationSession> {
    try {
      const session = await this.getConsultationSession(appointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Consultation session not found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'OpenViduVideoProvider.endConsultation'
        );
      }

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          // Find consultation by appointmentId to get its id
          const consultation = await delegate.findFirst({
            where: { OR: [{ appointmentId }] },
          });
          if (!consultation) {
            throw new HealthcareError(
              ErrorCode.DATABASE_RECORD_NOT_FOUND,
              `Video consultation not found for appointment ${appointmentId}`,
              undefined,
              { appointmentId },
              'OpenViduVideoProvider.endConsultation'
            );
          }
          // Update using id
          return await delegate.update({
            where: { id: consultation.id },
            data: {
              status: 'ENDED',
              endTime: new Date(),
            },
          });
        },
        {
          userId,
          userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
          clinicId: '',
          operation: 'END_VIDEO_CONSULTATION',
          resourceType: 'VIDEO_CONSULTATION',
          resourceId: appointmentId,
          timestamp: new Date(),
        }
      );

      return (await this.getConsultationSession(appointmentId))!;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to end OpenVidu consultation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.endConsultation',
        {
          appointmentId,
          userId,
          userRole,
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
      const consultation = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = getVideoConsultationDelegate(client);
        return await delegate.findFirst({
          where: {
            OR: [{ appointmentId }],
          },
          include: {
            participants: true,
          },
        });
      });

      if (!consultation) {
        return null;
      }

      return {
        id: (consultation as { id: string }).id,
        appointmentId,
        roomId: (consultation as { roomId: string }).roomId,
        roomName: (consultation as { roomId: string }).roomId,
        meetingUrl: (consultation as { meetingUrl: string }).meetingUrl,
        status: (consultation as { status: string }).status as
          | 'SCHEDULED'
          | 'ACTIVE'
          | 'ENDED'
          | 'CANCELLED',
        startTime: (consultation as { startTime: Date | null }).startTime,
        endTime: (consultation as { endTime: Date | null }).endTime,
        participants: ((consultation as { participants: Array<unknown> }).participants || []).map(
          (p: unknown) => {
            const participant = p as { userId: string; role: string; joinedAt: Date | null };
            return {
              userId: participant.userId,
              role: participant.role as 'HOST' | 'PARTICIPANT',
              joinedAt: participant.joinedAt,
            };
          }
        ),
        recordingEnabled: (consultation as { recordingEnabled: boolean }).recordingEnabled,
        screenSharingEnabled: (consultation as { screenSharingEnabled: boolean })
          .screenSharingEnabled,
        chatEnabled: (consultation as { chatEnabled: boolean }).chatEnabled,
        waitingRoomEnabled: (consultation as { waitingRoomEnabled: boolean }).waitingRoomEnabled,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu consultation session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.getConsultationSession',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  /**
   * Check if provider is healthy
   * Real-time check: Verifies OpenVidu container is actually running and accessible
   * Uses retry logic to handle temporary network issues during container startup
   */
  async isHealthy(): Promise<boolean> {
    // Check if OpenVidu is enabled first
    if (!this.isEnabled()) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'OpenVidu is disabled in configuration',
        'OpenViduVideoProvider.isHealthy',
        { apiUrl: this.apiUrl }
      );
      return false;
    }

    // Real-time health check with retry logic
    // OpenVidu may take time to fully start even after container is running
    const maxRetries = 3;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await Promise.race([
          this.httpService.get(
            `${this.apiUrl}/openvidu/api/config`,
            this.getHttpConfig({ timeout: 5000 }) // 5 second timeout
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          ),
        ]);

        // Success - any response means OpenVidu is running
        if (response.status >= 200 && response.status < 500) {
          if (attempt > 1) {
            await this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.INFO,
              `OpenVidu health check succeeded on attempt ${attempt}`,
              'OpenViduVideoProvider.isHealthy',
              { apiUrl: this.apiUrl, status: response.status }
            );
          }
          return true;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isConnectionError =
          errorMessage.includes('ECONNREFUSED') ||
          errorMessage.includes('ENOTFOUND') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorMessage.includes('EHOSTUNREACH') ||
          errorMessage.includes('ENETUNREACH');

        // Log attempt details
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `OpenVidu health check attempt ${attempt}/${maxRetries} failed: ${errorMessage}`,
          'OpenViduVideoProvider.isHealthy',
          {
            attempt,
            maxRetries,
            error: errorMessage,
            apiUrl: this.apiUrl,
            isConnectionError,
          }
        );

        // If not a connection error (e.g., auth error), OpenVidu is running
        if (!isConnectionError) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.DEBUG,
            'OpenVidu health check returned non-connection error - container is accessible',
            'OpenViduVideoProvider.isHealthy',
            { error: errorMessage, apiUrl: this.apiUrl }
          );
          return true; // Container is accessible
        }

        // Retry with delay if not last attempt
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    // All retries failed - log warning and return false
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `OpenVidu health check failed after ${maxRetries} attempts. Video features may be unavailable.`,
      'OpenViduVideoProvider.isHealthy',
      {
        apiUrl: this.apiUrl,
        attempts: maxRetries,
        note: 'OpenVidu container may not be running, not ready yet, or network issue. API will continue without video support.',
      }
    );

    return false;
  }

  /**
   * OpenVidu Pro - Start recording
   */
  async startRecording(
    sessionId: string,
    options?: {
      outputMode?: 'COMPOSED' | 'INDIVIDUAL';
      resolution?: string;
      frameRate?: number;
      customLayout?: string;
    }
  ): Promise<OpenViduRecording> {
    try {
      const response = await this.httpService.post<OpenViduRecording>(
        `${this.apiUrl}/openvidu/api/recordings/start`,
        {
          session: sessionId,
          ...(options?.outputMode && { outputMode: options.outputMode }),
          ...(options?.resolution && { resolution: options.resolution }),
          ...(options?.frameRate && { frameRate: options.frameRate }),
          ...(options?.customLayout && { customLayout: options.customLayout }),
        },
        this.getHttpConfig({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OpenVidu recording started: ${response.data.id}`,
        'OpenViduVideoProvider.startRecording',
        {
          sessionId,
          recordingId: response.data.id,
          outputMode: options?.outputMode,
        }
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to start OpenVidu recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.startRecording',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Stop recording
   */
  async stopRecording(recordingId: string): Promise<OpenViduRecording> {
    try {
      const response = await this.httpService.post<OpenViduRecording>(
        `${this.apiUrl}/openvidu/api/recordings/stop/${recordingId}`,
        {},
        this.getHttpConfig({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OpenVidu recording stopped: ${recordingId}`,
        'OpenViduVideoProvider.stopRecording',
        {
          recordingId,
          status: response.data.status,
        }
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to stop OpenVidu recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.stopRecording',
        {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Get recording
   */
  async getRecording(recordingId: string): Promise<OpenViduRecording> {
    try {
      const response = await this.httpService.get<OpenViduRecording>(
        `${this.apiUrl}/openvidu/api/recordings/${recordingId}`,
        this.getHttpConfig()
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.getRecording',
        {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - List recordings
   */
  async listRecordings(sessionId?: string): Promise<OpenViduRecording[]> {
    try {
      const url = sessionId
        ? `${this.apiUrl}/openvidu/api/recordings?sessionId=${sessionId}`
        : `${this.apiUrl}/openvidu/api/recordings`;
      const response = await this.httpService.get<{
        numberOfElements: number;
        content: OpenViduRecording[];
      }>(url, this.getHttpConfig());

      return response.data.content || [];
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to list OpenVidu recordings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.listRecordings',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Delete recording
   */
  async deleteRecording(recordingId: string): Promise<void> {
    try {
      await this.httpService.delete(
        `${this.apiUrl}/openvidu/api/recordings/${recordingId}`,
        this.getHttpConfig()
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OpenVidu recording deleted: ${recordingId}`,
        'OpenViduVideoProvider.deleteRecording',
        {
          recordingId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to delete OpenVidu recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.deleteRecording',
        {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Get session info with Pro features
   */
  async getSessionInfo(sessionId: string): Promise<OpenViduSessionInfo> {
    try {
      const response = await this.httpService.get<OpenViduSessionInfo>(
        `${this.apiUrl}/openvidu/api/sessions/${sessionId}`,
        this.getHttpConfig()
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu session info: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.getSessionInfo',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Get participants
   */
  async getParticipants(sessionId: string): Promise<OpenViduParticipant[]> {
    try {
      const sessionInfo = await this.getSessionInfo(sessionId);
      return sessionInfo.connections.content || [];
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu participants: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.getParticipants',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Kick participant
   */
  async kickParticipant(sessionId: string, connectionId: string): Promise<void> {
    try {
      await this.httpService.delete(
        `${this.apiUrl}/openvidu/api/sessions/${sessionId}/connection/${connectionId}`,
        this.getHttpConfig()
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OpenVidu participant kicked: ${connectionId}`,
        'OpenViduVideoProvider.kickParticipant',
        {
          sessionId,
          connectionId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to kick OpenVidu participant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.kickParticipant',
        {
          sessionId,
          connectionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Force unpublish stream
   */
  async forceUnpublish(sessionId: string, streamId: string): Promise<void> {
    try {
      await this.httpService.delete(
        `${this.apiUrl}/openvidu/api/sessions/${sessionId}/stream/${streamId}`,
        this.getHttpConfig()
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OpenVidu stream force unpublished: ${streamId}`,
        'OpenViduVideoProvider.forceUnpublish',
        {
          sessionId,
          streamId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to force unpublish OpenVidu stream: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.forceUnpublish',
        {
          sessionId,
          streamId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * OpenVidu Pro - Get session analytics
   */
  async getSessionAnalytics(sessionId: string): Promise<OpenViduSessionAnalytics> {
    try {
      // OpenVidu Pro provides analytics via /api/sessions/{sessionId}
      // Additional analytics can be obtained from the session info
      const sessionInfo = await this.getSessionInfo(sessionId);

      const analytics: OpenViduSessionAnalytics = {
        sessionId: sessionInfo.id,
        createdAt: sessionInfo.createdAt,
        duration: Math.floor((Date.now() - sessionInfo.createdAt) / 1000),
        numberOfParticipants: sessionInfo.connections.numberOfElements,
        numberOfConnections: sessionInfo.connections.numberOfElements,
        connections: sessionInfo.connections.content.map(conn => {
          const connection: {
            connectionId: string;
            createdAt: number;
            duration: number;
            location?: string;
            platform?: string;
            clientData?: string;
            serverData?: string;
            publishers: number;
            subscribers: number;
          } = {
            connectionId: conn.connectionId,
            createdAt: conn.createdAt,
            duration: Math.floor((Date.now() - conn.createdAt) / 1000),
            publishers: conn.streams.filter(s => s.typeOfVideo === 'CAMERA').length,
            subscribers: conn.streams.filter(s => s.typeOfVideo === 'SCREEN').length,
          };
          // Only include optional properties if they have values (for exactOptionalPropertyTypes)
          if (conn.location !== null && conn.location !== undefined) {
            connection.location = conn.location;
          }
          if (conn.platform !== null && conn.platform !== undefined) {
            connection.platform = conn.platform;
          }
          if (conn.clientData !== null && conn.clientData !== undefined) {
            connection.clientData = conn.clientData;
          }
          if (conn.serverData !== null && conn.serverData !== undefined) {
            connection.serverData = conn.serverData;
          }
          return connection;
        }),
        recordingCount: sessionInfo.recordings.numberOfElements,
        recordingTotalDuration: sessionInfo.recordings.content.reduce(
          (sum, rec) => sum + (rec.duration || 0),
          0
        ),
        recordingTotalSize: sessionInfo.recordings.content.reduce(
          (sum, rec) => sum + (rec.size || 0),
          0
        ),
      };

      return analytics;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get OpenVidu session analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'OpenViduVideoProvider.getSessionAnalytics',
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}
