/**
 * OpenVidu Video Provider
 * @class OpenViduVideoProvider
 * @description OpenVidu implementation of IVideoProvider
 * Primary video provider with modern architecture and AI-ready integration
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
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
} from '@core/types/video.types';
import axios from 'axios';
import * as crypto from 'crypto';
import type { VideoProviderConfig } from '@core/types/video.types';

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
      const response = await axios.get<OpenViduRoomConfig>(
        `${this.apiUrl}/api/sessions/${roomName}`,
        {
          headers: {
            Authorization: this.getAuthHeader(),
          },
        }
      );

      if (response.data) {
        return response.data;
      }
    } catch (error) {
      // Session doesn't exist, create new one
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Session doesn't exist, create it
      } else {
        throw error;
      }
    }

    // Create new session
    const createResponse = await axios.post<OpenViduRoomConfig>(
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
      const tokenResponse = await axios.post<OpenViduTokenResponse>(
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
      );

      const token = tokenResponse.data.token;
      const meetingUrl = `${this.apiUrl}/#/sessions/${session.id}?token=${token}`;

      // Create or update VideoConsultation in database
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const existing = await (
            client as unknown as {
              videoConsultation: {
                findUnique: <T>(args: T) => Promise<unknown>;
                upsert: <T>(args: T) => Promise<unknown>;
              };
            }
          ).videoConsultation.findUnique({
            where: { appointmentId },
          });

          if (!existing) {
            await (
              client as unknown as {
                videoConsultation: {
                  create: <T>(args: T) => Promise<unknown>;
                };
              }
            ).videoConsultation.create({
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

      // Update session status
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              videoConsultation: {
                update: <T>(args: T) => Promise<unknown>;
              };
            }
          ).videoConsultation.update({
            where: { appointmentId },
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

      // Update session status
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              videoConsultation: {
                update: <T>(args: T) => Promise<unknown>;
              };
            }
          ).videoConsultation.update({
            where: { appointmentId },
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
        return await (
          client as unknown as {
            videoConsultation: {
              findUnique: <T>(args: T) => Promise<unknown>;
            };
          }
        ).videoConsultation.findUnique({
          where: { appointmentId },
          include: { participants: true },
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
      const response = await axios.get(`${this.apiUrl}/api/config`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
        timeout: 5000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
