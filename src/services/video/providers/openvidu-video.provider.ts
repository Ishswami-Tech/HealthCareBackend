/**
 * OpenVidu Video Provider
 * @class OpenViduVideoProvider
 * @description OpenVidu implementation of IVideoProvider
 * Primary video provider with modern architecture and AI-ready integration
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database';
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
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {
    const videoConfig = this.configService.get<VideoProviderConfig>('video');
    this.apiUrl = videoConfig?.openvidu?.url || 'https://video.yourdomain.com';
    this.secret = videoConfig?.openvidu?.secret || '';
    this.domain = videoConfig?.openvidu?.domain || 'video.yourdomain.com';
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
      const response = await firstValueFrom(
        this.httpService.get<OpenViduRoomConfig>(`${this.apiUrl}/api/sessions/${roomName}`, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        })
      );

      if (response.data) {
        return response.data;
      }
    } catch (error) {
      // Session doesn't exist, create new one
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'status' in error.response &&
        error.response.status === 404
      ) {
        // Session doesn't exist, create it
      } else {
        throw error;
      }
    }

    // Create new session
    const createResponse = await firstValueFrom(
      this.httpService.post<OpenViduRoomConfig>(
        `${this.apiUrl}/api/sessions`,
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
        {
          headers: {
            Authorization: this.getAuthHeader(),
            'Content-Type': 'application/json',
          },
        }
      )
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
      interface OpenViduTokenResponse {
        token: string;
        id?: string;
        session?: string;
      }
      const tokenResponse = await firstValueFrom(
        this.httpService.post<OpenViduTokenResponse>(
          `${this.apiUrl}/api/tokens`,
          {
            session: session.id,
            role: userRole === 'doctor' ? 'PUBLISHER' : 'SUBSCRIBER',
            data: JSON.stringify({
              userId,
              userRole,
              displayName: userInfo.displayName,
              email: userInfo.email,
              avatar: userInfo.avatar,
            }),
          },
          {
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
          }
        )
      );

      const token = tokenResponse.data.token;
      const meetingUrl = `${this.apiUrl}/#/sessions/${session.id}?token=${token}`;

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          const existing = await delegate.findUnique({
            where: { appointmentId },
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
          const consultation = await delegate.findUnique({
            where: { appointmentId },
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
          const consultation = await delegate.findUnique({
            where: { appointmentId },
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
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}/api/config`, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
          timeout: 5000,
        })
      );
      return response.status === 200;
    } catch {
      return false;
    }
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
      const response: AxiosResponse<OpenViduRecording> = await firstValueFrom(
        this.httpService.post<OpenViduRecording>(
          `${this.apiUrl}/api/recordings/start`,
          {
            session: sessionId,
            ...(options?.outputMode && { outputMode: options.outputMode }),
            ...(options?.resolution && { resolution: options.resolution }),
            ...(options?.frameRate && { frameRate: options.frameRate }),
            ...(options?.customLayout && { customLayout: options.customLayout }),
          },
          {
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
          }
        )
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
      const response: AxiosResponse<OpenViduRecording> = await firstValueFrom(
        this.httpService.post<OpenViduRecording>(
          `${this.apiUrl}/api/recordings/stop/${recordingId}`,
          {},
          {
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
          }
        )
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
      const response: AxiosResponse<OpenViduRecording> = await firstValueFrom(
        this.httpService.get<OpenViduRecording>(`${this.apiUrl}/api/recordings/${recordingId}`, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        })
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
        ? `${this.apiUrl}/api/recordings?sessionId=${sessionId}`
        : `${this.apiUrl}/api/recordings`;
      const response: AxiosResponse<{ numberOfElements: number; content: OpenViduRecording[] }> =
        await firstValueFrom(
        this.httpService.get<{ numberOfElements: number; content: OpenViduRecording[] }>(url, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        })
      );

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
      await firstValueFrom(
        this.httpService.delete(`${this.apiUrl}/api/recordings/${recordingId}`, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        })
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
      const response: AxiosResponse<OpenViduSessionInfo> = await firstValueFrom(
        this.httpService.get<OpenViduSessionInfo>(`${this.apiUrl}/api/sessions/${sessionId}`, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        })
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
      await firstValueFrom(
        this.httpService.delete(
          `${this.apiUrl}/api/sessions/${sessionId}/connection/${connectionId}`,
          {
            headers: {
              Authorization: this.getAuthHeader(),
            },
          }
        )
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
      await firstValueFrom(
        this.httpService.delete(`${this.apiUrl}/api/sessions/${sessionId}/stream/${streamId}`, {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        })
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
