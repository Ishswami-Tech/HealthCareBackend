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

    // Get URL from config or environment variable directly (NO hardcoded fallback)
    const configUrl = videoConfig?.openvidu?.url;
    const envUrl = this.configService.getEnv('OPENVIDU_URL');
    this.apiUrl =
      configUrl ||
      envUrl ||
      (() => {
        throw new Error(
          'Missing required environment variable: OPENVIDU_URL. ' +
            'Please set OPENVIDU_URL in your environment configuration.'
        );
      })();

    // Get secret from config or environment variable directly
    const configSecret = videoConfig?.openvidu?.secret;
    const envSecret = this.configService.getEnv('OPENVIDU_SECRET');
    this.secret = configSecret || envSecret || '';

    // Get domain from config or environment variable directly
    const configDomain = videoConfig?.openvidu?.domain;
    const envDomain = this.configService.getEnv('OPENVIDU_DOMAIN');
    this.domain =
      configDomain ||
      envDomain ||
      (() => {
        throw new Error(
          'Missing required environment variable: OPENVIDU_DOMAIN. ' +
            'Please set OPENVIDU_DOMAIN in your environment configuration.'
        );
      })();

    // Log configuration for debugging (async, don't await)
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'OpenVidu provider initialized',
      'OpenViduVideoProvider.constructor',
      {
        apiUrl: this.apiUrl,
        domain: this.domain,
        secretConfigured: !!this.secret,
        configSource: {
          urlFromConfig: !!configUrl,
          urlFromEnv: !!envUrl,
          secretFromConfig: !!configSecret,
          secretFromEnv: !!envSecret,
          domainFromConfig: !!configDomain,
          domainFromEnv: !!envDomain,
        },
        note: 'If URL is incorrect, check OPENVIDU_URL in .env.production or .env.local file and restart the application.',
      }
    );
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
   * Uses the official OpenVidu health endpoint: /openvidu/api/health
   * See: https://docs.openvidu.io/en/stable/reference-docs/REST-API/
   * Returns {"status": "UP"} when healthy, 503 with {"status": "DOWN"} when unhealthy
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

    // Real-time health check with retry logic - NO AUTHENTICATION
    // According to OpenVidu documentation (https://docs.openvidu.io):
    // 1. Root URL should show "Welcome to OpenVidu" message (default behavior for all editions)
    // 2. /openvidu/api/health endpoint exists but is ONLY available in PRO/ENTERPRISE editions
    // 3. /openvidu/api/config is a public endpoint available in ALL editions (including CE)
    //
    // Strategy: Try root URL first, fallback to /openvidu/api/config if needed
    // Treat 403/401 as healthy (server is responding, just blocking access)
    // OpenVidu may take time to fully start even after container is running
    const maxRetries = 3;
    const retryDelayMs = 2000;

    // Prepare endpoints
    let rootEndpoint = this.apiUrl;
    if (rootEndpoint.endsWith('/')) {
      rootEndpoint = rootEndpoint.slice(0, -1);
    }
    const configEndpoint = `${rootEndpoint}/openvidu/api/config`;

    // Track last error for detailed error message
    let lastError = 'Unknown error';
    let lastErrorCode: string | undefined;
    let finalIsConnectionError = true;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let response: { status: number; data?: unknown } | null = null;
      let healthCheckError: Error | null = null;
      let endpointUsed = rootEndpoint;

      try {
        // Try root URL first (should show "Welcome to OpenVidu")
        // Increased timeout to 10 seconds to handle slow OpenVidu responses
        const healthCheckTimeout = 10000; // 10 seconds

        try {
          response = await Promise.race([
            this.httpService.get(rootEndpoint, {
              timeout: healthCheckTimeout,
              // No auth - public health check
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout')), healthCheckTimeout)
            ),
          ]);

          endpointUsed = rootEndpoint;
        } catch (error) {
          healthCheckError = error instanceof Error ? error : new Error(String(error));
          // Axios errors have status in error.response.status, not error.status
          const errorStatus = (error as { response?: { status?: number } })?.response?.status;

          // If root URL returns 403/401, server is responding (healthy)
          // Only try fallback for actual connection errors or other 4xx/5xx
          if (errorStatus !== 403 && errorStatus !== 401) {
            // Try fallback: /openvidu/api/config (public endpoint available in all editions)
            try {
              response = await Promise.race([
                this.httpService.get<{ version?: string; [key: string]: unknown }>(configEndpoint, {
                  timeout: healthCheckTimeout,
                  // No auth - public endpoint
                }),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Health check timeout')), healthCheckTimeout)
                ),
              ]);

              endpointUsed = configEndpoint;
              healthCheckError = null; // Clear error since fallback succeeded
            } catch (fallbackError) {
              // Axios errors have status in error.response.status, not error.status
              const fallbackErrorStatus = (fallbackError as { response?: { status?: number } })
                ?.response?.status;

              // If fallback endpoint returns 403/401, server is responding (healthy)
              if (fallbackErrorStatus === 403 || fallbackErrorStatus === 401) {
                response = { status: fallbackErrorStatus };
                endpointUsed = configEndpoint;
                healthCheckError = null;
              } else {
                healthCheckError =
                  fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
                // Will be handled below
              }
            }
          } else {
            // 403/401 from root URL - server is responding, treat as healthy
            response = { status: errorStatus };
            endpointUsed = rootEndpoint;
            healthCheckError = null;
          }
        }

        if (!response && healthCheckError) {
          throw healthCheckError;
        }

        // Check for successful response according to OpenVidu documentation:
        // - 2xx/3xx: Server is up and responding (healthy) - shows "Welcome to OpenVidu" or config
        // - 403 Forbidden: Server is up but blocking access (still healthy - server is responding)
        //   Common with reverse proxies or security policies
        // - 401 Unauthorized: Server is up but requires auth (still healthy - server is responding)
        // - Other 4xx/5xx: Server error (unhealthy)
        const isUp =
          (response!.status >= 200 && response!.status < 400) || // Success responses (200-399)
          response!.status === 403 || // Forbidden - server is up, just blocking (common with reverse proxies)
          response!.status === 401; // Unauthorized - server is up, just requires auth

        if (isUp) {
          if (attempt > 1) {
            await this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.INFO,
              `OpenVidu health check succeeded on attempt ${attempt}`,
              'OpenViduVideoProvider.isHealthy',
              {
                apiUrl: this.apiUrl,
                status: response!.status,
                endpoint: endpointUsed,
                endpointUsed: endpointUsed === rootEndpoint ? 'root' : 'config',
              }
            );
          }
          return true;
        }

        // OpenVidu responded but with error status (service unavailable)
        if (response && response.status === 503) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `OpenVidu reported service unavailable on attempt ${attempt}`,
            'OpenViduVideoProvider.isHealthy',
            {
              apiUrl: this.apiUrl,
              status: response.status,
            }
          );
          // Don't retry if OpenVidu explicitly says it's unavailable
          return false;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = (error as { code?: string })?.code;
        const isConnectionError =
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ETIMEDOUT' ||
          errorCode === 'EHOSTUNREACH' ||
          errorCode === 'ENETUNREACH' ||
          errorMessage.includes('ECONNREFUSED') ||
          errorMessage.includes('ENOTFOUND') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorMessage.includes('EHOSTUNREACH') ||
          errorMessage.includes('ENETUNREACH') ||
          errorMessage.includes('getaddrinfo') ||
          errorMessage.includes('connect ECONNREFUSED');

        // Enhanced logging with more diagnostic information
        await this.loggingService.log(
          LogType.SYSTEM,
          attempt === maxRetries ? LogLevel.WARN : LogLevel.DEBUG,
          `OpenVidu health check attempt ${attempt}/${maxRetries} failed: ${errorMessage}`,
          'OpenViduVideoProvider.isHealthy',
          {
            attempt,
            maxRetries,
            error: errorMessage,
            errorCode,
            apiUrl: this.apiUrl,
            endpoint: endpointUsed,
            endpointUsed: endpointUsed === rootEndpoint ? 'root' : 'config',
            isConnectionError,
            diagnostic: {
              message: finalIsConnectionError
                ? 'Cannot connect to OpenVidu server. Check: 1) Is OpenVidu container running? 2) Is OPENVIDU_URL correct? 3) Can backend reach OpenVidu network?'
                : 'OpenVidu server may be running but health endpoint returned an error. Check OpenVidu logs.',
              possibleCauses: finalIsConnectionError
                ? [
                    'OpenVidu container not running',
                    'Incorrect OPENVIDU_URL configuration',
                    'Network connectivity issue between backend and OpenVidu',
                    'OpenVidu REST API not started (KMS may be running but REST API not ready)',
                  ]
                : ['OpenVidu REST API error', 'Authentication issue', 'OpenVidu service degraded'],
            },
          }
        );

        // If not a connection error (e.g., auth error, 500 error), OpenVidu is running but may have issues
        if (!isConnectionError) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.DEBUG,
            'OpenVidu health check returned non-connection error - container is accessible but may have issues',
            'OpenViduVideoProvider.isHealthy',
            { error: errorMessage, errorCode, apiUrl: this.apiUrl }
          );
          // Return true if we got a response (even if error) - means server is reachable
          // This allows the API to continue even if OpenVidu has temporary issues
          if (attempt === maxRetries) {
            return false; // After all retries, mark as unhealthy
          }
        }

        // Store last error for final error message
        lastError = errorMessage;
        lastErrorCode = errorCode;
        finalIsConnectionError = isConnectionError;

        // Retry with delay if not last attempt
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    // All retries failed - build detailed error message using last error
    // Build comprehensive error message with diagnostic information
    let detailedErrorMessage = `OpenVidu health check failed after ${maxRetries} attempts. `;
    detailedErrorMessage += `Last error: ${lastError}${lastErrorCode ? ` (code: ${lastErrorCode})` : ''}. `;
    if (finalIsConnectionError) {
      detailedErrorMessage += `Cannot connect to OpenVidu server at ${this.apiUrl}. `;
      detailedErrorMessage += `Possible causes: 1) OpenVidu container not running, 2) Incorrect OPENVIDU_URL configuration (current: ${this.apiUrl}), 3) Network connectivity issue, 4) OpenVidu REST API not started (KMS may be running but REST API not ready).`;
    } else {
      detailedErrorMessage += `OpenVidu server may be running but health endpoint returned an error. Check OpenVidu logs.`;
    }

    // Log warning with detailed information
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `OpenVidu health check failed after ${maxRetries} attempts. Video features may be unavailable.`,
      'OpenViduVideoProvider.isHealthy',
      {
        apiUrl: this.apiUrl,
        attempts: maxRetries,
        error: detailedErrorMessage,
        note: 'OpenVidu container may not be running, not ready yet, or network issue. API will continue without video support.',
      }
    );

    // Throw error with detailed message so health indicator can capture it
    throw new HealthcareError(
      ErrorCode.SERVICE_UNAVAILABLE,
      detailedErrorMessage,
      undefined,
      {
        apiUrl: this.apiUrl,
        attempts: maxRetries,
        isConnectionError: finalIsConnectionError,
        errorCode: lastErrorCode,
        lastError,
        diagnostic: {
          message: finalIsConnectionError
            ? 'Cannot connect to OpenVidu server. Check: 1) Is OpenVidu container running? 2) Is OPENVIDU_URL correct? 3) Can backend reach OpenVidu network?'
            : 'OpenVidu server may be running but health endpoint returned an error. Check OpenVidu logs.',
          possibleCauses: finalIsConnectionError
            ? [
                'OpenVidu container not running',
                'Incorrect OPENVIDU_URL configuration',
                'Network connectivity issue between backend and OpenVidu',
                'OpenVidu REST API not started (KMS may be running but REST API not ready)',
              ]
            : ['OpenVidu REST API error', 'Authentication issue', 'OpenVidu service degraded'],
        },
      },
      'OpenViduVideoProvider.isHealthy'
    );
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
