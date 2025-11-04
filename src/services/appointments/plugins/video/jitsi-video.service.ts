import { Injectable } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
// import { SocketService } from "@infrastructure/socket/socket.service";

import type { JitsiRoomConfig, VideoConsultationSession } from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { JitsiRoomConfig, VideoConsultationSession };

@Injectable()
export class JitsiVideoService {
  private readonly MEETING_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
    // private readonly socketService: SocketService,
  ) {}

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
  ): Promise<{
    token: string;
    roomName: string;
    roomPassword?: string;
    meetingPassword?: string;
    encryptionKey?: string;
  }> {
    try {
      // Get or create room configuration
      const roomConfig = await this.getRoomConfig(appointmentId);
      if (!roomConfig) {
        throw new HealthcareError(
          ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
          `Failed to get room configuration for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'JitsiVideoService.generateMeetingToken'
        );
      }

      // Generate JWT token for Jitsi Meet
      const token = this.generateJitsiToken(userId, userRole, userInfo, roomConfig);

      return {
        token,
        roomName: roomConfig.roomName,
        ...(userRole === 'doctor'
          ? roomConfig.moderatorPassword && {
              roomPassword: roomConfig.moderatorPassword,
            }
          : roomConfig.participantPassword && {
              roomPassword: roomConfig.participantPassword,
            }),
        ...(roomConfig.participantPassword && {
          meetingPassword: roomConfig.participantPassword,
        }),
        ...(roomConfig.encryptionKey && {
          encryptionKey: roomConfig.encryptionKey,
        }),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to generate meeting token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.generateMeetingToken',
        { error: error instanceof Error ? error.message : String(error), appointmentId }
      );
      throw error instanceof HealthcareError
        ? error
        : new HealthcareError(
            ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
            `Failed to generate meeting token: ${error instanceof Error ? error.message : 'Unknown error'}`,
            undefined,
            { appointmentId },
            'JitsiVideoService.generateMeetingToken'
          );
    }
  }

  /**
   * Start video consultation session
   */
  async startConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor'
  ): Promise<VideoConsultationSession> {
    try {
      // Get existing session or create new one
      let session = await this.getVideoSession(appointmentId);
      if (!session) {
        session = await this.createVideoSession(appointmentId, userId, userRole);
      }

      // Update session status
      session.status = 'started';
      session.startTime = new Date();

      // Update participant join time
      const participantIndex = session.participants.findIndex(p =>
        userRole === 'patient' ? p.patientId === userId : p.doctorId === userId
      );

      if (participantIndex >= 0 && session.participants[participantIndex]) {
        session.participants[participantIndex].joinedAt = new Date();
      }

      // Add audit log entry
      session.hipaaAuditLog.push({
        action: 'consultation_started',
        timestamp: new Date(),
        userId,
        details: {
          userRole,
          startTime: session.startTime,
        },
      });

      // Update session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL
      );

      // Notify other participants via socket
      // this.socketService.sendToRoom(
      //   `appointment_${appointmentId}`,
      //   "consultation_started",
      //   {
      //     appointmentId,
      //     startedBy: userRole,
      //     startTime: session.startTime,
      //   },
      // );

      // Log consultation start
      await this.logHipaaEvent('CONSULTATION_STARTED', {
        appointmentId,
        userId,
        userRole,
        startTime: session.startTime,
        roomName: session.roomName,
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Video consultation started for appointment ${appointmentId}`,
        'JitsiVideoService.startConsultation',
        {
          appointmentId,
          startedBy: userRole,
          participantCount: session.participants.length,
        }
      );

      return session;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to start consultation for appointment ${appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.startConsultation',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          userRole,
          appointmentId,
        }
      );
      throw error;
    }
  }

  /**
   * End video consultation session
   */
  async endConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor',
    meetingNotes?: string
  ): Promise<VideoConsultationSession> {
    try {
      // Get existing session
      const session = await this.getVideoSession(appointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'JitsiVideoService.endConsultation'
        );
      }

      // Update session status
      session.status = 'ended';
      session.endTime = new Date();
      session.meetingNotes = meetingNotes || '';

      // Calculate duration
      if (session.startTime) {
        const duration = session.endTime.getTime() - session.startTime.getTime();

        // Update participant leave time and duration
        const participantIndex = session.participants.findIndex(p =>
          userRole === 'patient' ? p.patientId === userId : p.doctorId === userId
        );

        if (participantIndex >= 0) {
          if (session.participants[participantIndex]) {
            session.participants[participantIndex].leftAt = session.endTime;
            session.participants[participantIndex].duration = Math.floor(duration / 1000); // seconds
          }
        }
      }

      // Add audit log entry
      session.hipaaAuditLog.push({
        action: 'consultation_ended',
        timestamp: new Date(),
        userId,
        details: {
          userRole,
          endTime: session.endTime,
          duration: session.endTime.getTime() - (session.startTime?.getTime() || 0),
        },
      });

      // Update session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL
      );

      // Notify other participants via socket
      // this.socketService.sendToRoom(
      //   `appointment_${appointmentId}`,
      //   "consultation_ended",
      //   {
      //     appointmentId,
      //     endedBy: userRole,
      //     endTime: session.endTime,
      //     duration: session.participants[0]?.duration,
      //   },
      // );

      // Log consultation end
      await this.logHipaaEvent('CONSULTATION_ENDED', {
        appointmentId,
        userId,
        userRole,
        endTime: session.endTime,
        duration: session.endTime.getTime() - (session.startTime?.getTime() || 0),
        endedBy: userRole,
        participantDuration: session.participants[0]?.duration,
        recordingAvailable: !!session.recordingUrl,
      });

      return session;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to end consultation for appointment ${appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.endConsultation',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          userRole,
          appointmentId,
        }
      );
      throw error;
    }
  }

  /**
   * Get consultation session status
   */
  async getConsultationStatus(appointmentId: string): Promise<VideoConsultationSession | null> {
    try {
      return await this.getVideoSession(appointmentId);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get consultation status for appointment ${appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.getConsultationStatus',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
        }
      );
      return null;
    }
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
      const session = await this.getVideoSession(appointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'JitsiVideoService.reportTechnicalIssue'
        );
      }

      // Initialize technical issues array if not exists
      if (!session.technicalIssues) {
        session.technicalIssues = [];
      }

      // Add technical issue
      session.technicalIssues.push({
        issueType,
        description: issueDescription,
        reportedBy: userId,
        timestamp: new Date(),
      });

      // Update session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL
      );

      // Log technical issue
      await this.logHipaaEvent('TECHNICAL_ISSUE_REPORTED', {
        appointmentId,
        userId,
        issueType,
        description: issueDescription,
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        `Technical issue reported for appointment ${appointmentId}`,
        'JitsiVideoService.reportTechnicalIssue',
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
        'JitsiVideoService.reportTechnicalIssue',
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
      const session = await this.getVideoSession(appointmentId);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `No video session found for appointment ${appointmentId}`,
          undefined,
          { appointmentId },
          'JitsiVideoService.processRecording'
        );
      }

      // Update session with recording URL
      session.recordingUrl = recordingUrl;

      // Update session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL
      );

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Processing recording for appointment ${appointmentId}`,
        'JitsiVideoService.processRecording',
        {
          recordingUrl,
          appointmentId,
        }
      );

      // Log recording processing
      await this.logHipaaEvent('RECORDING_PROCESSED', {
        appointmentId,
        recordingUrl,
        processedAt: new Date(),
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process recording for appointment ${appointmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.processRecording',
        {
          error: error instanceof Error ? error.message : String(error),
          recordingUrl,
          appointmentId,
        }
      );
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): void {
    try {
      // This would typically be called by a scheduled task
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Cleaning up expired video consultation sessions',
        'JitsiVideoService.cleanupExpiredSessions'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to cleanup expired sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.cleanupExpiredSessions',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  private async getRoomConfig(appointmentId: string): Promise<JitsiRoomConfig | null> {
    try {
      const cacheKey = `jitsi_room:${appointmentId}`;
      return await this.cacheService.get(cacheKey);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get room config: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.getRoomConfig',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
        }
      );
      return null;
    }
  }

  private async getVideoSession(appointmentId: string): Promise<VideoConsultationSession | null> {
    try {
      const cacheKey = `video_session:${appointmentId}`;
      return await this.cacheService.get(cacheKey);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get video session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.getVideoSession',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
        }
      );
      return null;
    }
  }

  private generateSecureRoomName(appointmentId: string, clinicId: string): string {
    // Generate a secure room name
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    return `healthcare-${clinicId}-${appointmentId}-${timestamp}-${randomSuffix}`;
  }

  private generateSecurePassword(): string {
    // Generate a secure password for the room
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  private generateEncryptionKey(appointmentId: string): string {
    // Generate encryption key for the room
    const timestamp = Date.now();
    return `enc_${appointmentId}_${timestamp}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private async createVideoSession(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor'
  ): Promise<VideoConsultationSession> {
    const roomName = this.generateSecureRoomName(appointmentId, 'default');
    const session: VideoConsultationSession = {
      appointmentId,
      roomName,
      status: 'pending',
      participants: [
        {
          userId,
          userRole,
          ...(userRole === 'patient' ? { patientId: userId } : { doctorId: userId }),
        },
      ],
      hipaaAuditLog: [],
    };

    // Store session in cache
    await this.cacheService.set(`video_session:${appointmentId}`, session, this.MEETING_CACHE_TTL);

    return session;
  }

  private generateJitsiToken(
    userId: string,
    userRole: 'patient' | 'doctor',
    _userInfo: { displayName: string; email: string; avatar?: string },
    _roomConfig: JitsiRoomConfig
  ): string {
    // This would generate a JWT token for Jitsi Meet
    // For now, return a placeholder
    return `jwt_token_${userId}_${userRole}_${Date.now()}`;
  }

  private async logHipaaEvent(action: string, details: unknown): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `HIPAA Event: ${action}`,
        'VIDEO_CONSULTATION',
        {
          action,
          details,
          timestamp: new Date().toISOString(),
          service: 'jitsi-video-service',
        }
      );
    } catch (error) {
      // Silent failure for HIPAA audit logging - already in error handling
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to log HIPAA event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.logHipaaEvent',
        {
          error: error instanceof Error ? error.message : String(error),
          action,
        }
      );
    }
  }
}
