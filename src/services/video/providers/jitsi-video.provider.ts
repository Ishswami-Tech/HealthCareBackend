/**
 * Jitsi Video Provider
 * @class JitsiVideoProvider
 * @description Jitsi implementation of IVideoProvider
 * Fallback video provider (similar to Redis in cache pattern)
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
} from '@core/types/video.types';
import { getVideoConsultationDelegate } from '@core/types/video-database.types';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

@Injectable()
export class JitsiVideoProvider implements IVideoProvider {
  readonly providerName: VideoProviderType = 'jitsi';
  private readonly MEETING_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  /**
   * Check if provider is enabled
   */
  isEnabled(): boolean {
    const videoConfig = this.configService.get<{ enabled: boolean; provider: string }>('video');
    return videoConfig?.enabled === true; // Jitsi is always enabled as fallback
  }

  /**
   * Generate secure room name
   */
  private generateSecureRoomName(appointmentId: string, clinicId: string): string {
    const hash = Buffer.from(`${appointmentId}-${clinicId}-${Date.now()}`)
      .toString('base64')
      .replace(/[+/=]/g, '')
      .substring(0, 16);
    return `appointment-${appointmentId}-${hash}`;
  }

  /**
   * Generate secure password
   */
  private generateSecurePassword(): string {
    return Buffer.from(crypto.randomBytes(16)).toString('base64').substring(0, 16);
  }

  /**
   * Generate Jitsi JWT token
   */
  private generateJitsiToken(
    userId: string,
    userRole: 'patient' | 'doctor',
    userInfo: { displayName: string; email: string; avatar?: string },
    roomName: string
  ): string {
    try {
      const jitsiConfig = this.configService.getJitsiConfig();

      if (!jitsiConfig.enabled || !jitsiConfig.appSecret) {
        return `jwt_token_${userId}_${userRole}_${Date.now()}`;
      }

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: jitsiConfig.appId,
        aud: jitsiConfig.appId,
        sub: jitsiConfig.domain,
        room: roomName,
        exp: now + 3600,
        nbf: now - 10,
        context: {
          user: {
            id: userId,
            name: userInfo.displayName,
            email: userInfo.email,
            avatar: userInfo.avatar,
            moderator: userRole === 'doctor',
          },
          features: {
            recording: jitsiConfig.enableRecording,
            livestreaming: false,
            transcription: false,
            'outbound-call': false,
          },
        },
      };

      return jwt.sign(payload, jitsiConfig.appSecret, {
        algorithm: 'HS256',
        header: {
          alg: 'HS256',
          typ: 'JWT',
        },
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to generate Jitsi JWT token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoProvider.generateJitsiToken',
        { userId, userRole, error: error instanceof Error ? error.message : String(error) }
      );
      return `jwt_token_${userId}_${userRole}_${Date.now()}`;
    }
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
      const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
      if (!appointment) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Appointment ${appointmentId} not found`,
          undefined,
          { appointmentId },
          'JitsiVideoProvider.generateMeetingToken'
        );
      }

      if (!isVideoCallAppointment(appointment)) {
        throw new HealthcareError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          `Appointment ${appointmentId} is not a video consultation`,
          undefined,
          { appointmentId, type: appointment.type },
          'JitsiVideoProvider.generateMeetingToken'
        );
      }

      const jitsiConfig = this.configService.getJitsiConfig();
      const roomName = this.generateSecureRoomName(appointmentId, appointment.clinicId);
      const roomId = roomName;
      const meetingUrl = `${jitsiConfig.baseUrl}/${roomName}`;
      const token = this.generateJitsiToken(userId, userRole, userInfo, roomName);

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
                recordingEnabled: jitsiConfig.enableRecording,
                screenSharingEnabled: true,
                chatEnabled: true,
                waitingRoomEnabled: jitsiConfig.enableWaitingRoom,
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

      return {
        token,
        roomName,
        roomId,
        meetingUrl,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to generate Jitsi meeting token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoProvider.generateMeetingToken',
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
      let session = await this.getConsultationSession(appointmentId);
      if (!session) {
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
            'JitsiVideoProvider.startConsultation'
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
              'JitsiVideoProvider.startConsultation'
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
        `Failed to start Jitsi consultation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoProvider.startConsultation',
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
          'JitsiVideoProvider.endConsultation'
        );
      }

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          return await delegate.update({
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
        `Failed to end Jitsi consultation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoProvider.endConsultation',
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
        `Failed to get Jitsi consultation session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoProvider.getConsultationSession',
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
  isHealthy(): Promise<boolean> {
    try {
      const jitsiConfig = this.configService.getJitsiConfig();
      // Simple health check - verify config is valid
      return Promise.resolve(jitsiConfig.enabled && !!jitsiConfig.domain);
    } catch {
      return Promise.resolve(false);
    }
  }
}
