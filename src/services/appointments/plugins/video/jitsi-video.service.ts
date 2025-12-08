import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database';
import { ConfigService } from '@config';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { isVideoCallAppointment } from '@core/types/appointment-guards.types';
import * as jwt from 'jsonwebtoken';
// import { SocketService } from "@infrastructure/socket/socket.service";

import type { JitsiRoomConfig, VideoConsultationSession } from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { JitsiRoomConfig, VideoConsultationSession };

@Injectable()
export class JitsiVideoService {
  private readonly MEETING_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => DatabaseService)) private readonly databaseService: DatabaseService
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
      let roomConfig = await this.getRoomConfig(appointmentId);

      // If room doesn't exist, create it
      if (!roomConfig) {
        // Get appointment to create VideoConsultation
        const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
        if (!appointment) {
          throw new HealthcareError(
            ErrorCode.DATABASE_RECORD_NOT_FOUND,
            `Appointment ${appointmentId} not found`,
            undefined,
            { appointmentId },
            'JitsiVideoService.generateMeetingToken'
          );
        }

        // Runtime validation at boundary - narrow to VideoCallAppointment
        if (!isVideoCallAppointment(appointment)) {
          throw new HealthcareError(
            ErrorCode.VALIDATION_INVALID_FORMAT,
            `Appointment ${appointmentId} is not a video consultation`,
            undefined,
            { appointmentId, type: appointment.type },
            'JitsiVideoService.generateMeetingToken'
          );
        }

        // TypeScript now knows appointment is VideoCallAppointment

        // Create VideoConsultation
        const jitsiConfig = this.configService.getJitsiConfig();
        const roomId = this.generateSecureRoomName(appointmentId, appointment.clinicId);
        const meetingUrl = `${jitsiConfig.baseUrl}/${roomId}`;
        const moderatorPassword = this.generateSecurePassword();
        const participantPassword = this.generateSecurePassword();

        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await (
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

        // Create room config
        roomConfig = {
          roomName: roomId,
          meetingUrl,
          appointmentId: appointmentId,
          isSecure: true,
          enableRecording: true,
          recordingEnabled: true,
          maxParticipants: 2,
          hipaaCompliant: true,
          moderatorPassword: moderatorPassword,
          participantPassword: participantPassword,
        };

        // Cache the config
        await this.cacheService.set(
          `jitsi_room:${appointmentId}`,
          roomConfig,
          this.MEETING_CACHE_TTL
        );
      }

      if (!roomConfig) {
        throw new HealthcareError(
          ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
          `Failed to get or create room configuration for appointment ${appointmentId}`,
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

      // Update database - VideoConsultation
      const consultation = (await this.databaseService.executeHealthcareRead(async client => {
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
      })) as { id: string; participants: Array<{ id: string; userId: string }> } | null;

      if (consultation) {
        // Update consultation status and start time
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await (
              client as unknown as {
                videoConsultation: {
                  update: <T>(args: T) => Promise<unknown>;
                };
              }
            ).videoConsultation.update({
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
            operation: 'UPDATE_VIDEO_CONSULTATION',
            resourceType: 'VIDEO_CONSULTATION',
            resourceId: consultation.id,
            timestamp: new Date(),
          }
        );

        // Update or create participant
        const participantRole = userRole === 'doctor' ? 'HOST' : 'PARTICIPANT';
        const existingParticipant = consultation.participants.find(
          (p: { userId: string }) => p.userId === userId
        );

        if (existingParticipant) {
          await this.databaseService.executeHealthcareWrite(
            async client => {
              return await (
                client as unknown as {
                  videoParticipant: {
                    update: <T>(args: T) => Promise<unknown>;
                  };
                }
              ).videoParticipant.update({
                where: { id: existingParticipant.id },
                data: {
                  status: 'JOINED',
                  joinedAt: new Date(),
                },
              });
            },
            {
              userId,
              userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
              clinicId: '',
              operation: 'UPDATE_VIDEO_PARTICIPANT',
              resourceType: 'VIDEO_PARTICIPANT',
              resourceId: existingParticipant.id,
              timestamp: new Date(),
            }
          );
        } else {
          await this.databaseService.executeHealthcareWrite(
            async client => {
              return await (
                client as unknown as {
                  videoParticipant: {
                    create: <T>(args: T) => Promise<unknown>;
                  };
                }
              ).videoParticipant.create({
                data: {
                  consultationId: consultation.id,
                  userId,
                  role: participantRole,
                  status: 'JOINED',
                  joinedAt: new Date(),
                },
              });
            },
            {
              userId,
              userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
              clinicId: '',
              operation: 'CREATE_VIDEO_PARTICIPANT',
              resourceType: 'VIDEO_PARTICIPANT',
              resourceId: '',
              timestamp: new Date(),
            }
          );
        }
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
      } else {
        // Add new participant to session
        session.participants.push({
          userId,
          userRole,
          ...(userRole === 'patient' ? { patientId: userId } : { doctorId: userId }),
          joinedAt: new Date(),
        });
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
      this.logHipaaEvent('CONSULTATION_STARTED', {
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

      // Update database - VideoConsultation
      const consultation = (await this.databaseService.executeHealthcareRead(async client => {
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
      })) as {
        id: string;
        startTime: Date | null;
        participants: Array<{ id: string; userId: string; joinedAt: Date | null }>;
      } | null;

      if (consultation) {
        const endTime = new Date();
        const duration = consultation.startTime
          ? Math.floor((endTime.getTime() - consultation.startTime.getTime()) / 1000)
          : null;

        // Update consultation
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await (
              client as unknown as {
                videoConsultation: {
                  update: <T>(args: T) => Promise<unknown>;
                };
              }
            ).videoConsultation.update({
              where: { id: consultation.id },
              data: {
                status: 'COMPLETED',
                endTime,
                ...(duration && { duration }),
              },
            });
          },
          {
            userId,
            userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
            clinicId: '',
            operation: 'UPDATE_VIDEO_CONSULTATION',
            resourceType: 'VIDEO_CONSULTATION',
            resourceId: consultation.id,
            timestamp: new Date(),
          }
        );

        // Update participant
        const participant = consultation.participants.find(
          (p: { userId: string }) => p.userId === userId
        );
        if (participant) {
          const participantDuration = participant.joinedAt
            ? Math.floor((endTime.getTime() - participant.joinedAt.getTime()) / 1000)
            : null;

          await this.databaseService.executeHealthcareWrite(
            async client => {
              return await (
                client as unknown as {
                  videoParticipant: {
                    update: <T>(args: T) => Promise<unknown>;
                  };
                }
              ).videoParticipant.update({
                where: { id: participant.id },
                data: {
                  status: 'LEFT',
                  leftAt: endTime,
                  ...(participantDuration && { duration: participantDuration }),
                },
              });
            },
            {
              userId,
              userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
              clinicId: '',
              operation: 'UPDATE_VIDEO_PARTICIPANT',
              resourceType: 'VIDEO_PARTICIPANT',
              resourceId: participant.id,
              timestamp: new Date(),
            }
          );
        }
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
      this.logHipaaEvent('CONSULTATION_ENDED', {
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
      this.logHipaaEvent('TECHNICAL_ISSUE_REPORTED', {
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
      this.logHipaaEvent('RECORDING_PROCESSED', {
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
      // Try cache first
      const cacheKey = `jitsi_room:${appointmentId}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as JitsiRoomConfig;
      }

      // Get from database (VideoConsultation)
      const consultation = (await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            videoConsultation: {
              findUnique: <T>(args: T) => Promise<unknown>;
            };
          }
        ).videoConsultation.findUnique({
          where: { appointmentId },
        });
      })) as {
        roomId: string;
        meetingUrl: string | null;
        appointmentId: string;
        recordingEnabled: boolean;
        maxParticipants: number;
      } | null;

      if (consultation) {
        const roomConfig: JitsiRoomConfig = {
          roomName: consultation.roomId,
          ...(consultation.meetingUrl && { meetingUrl: consultation.meetingUrl }),
          appointmentId: consultation.appointmentId,
          isSecure: true,
          enableRecording: consultation.recordingEnabled,
          recordingEnabled: consultation.recordingEnabled,
          maxParticipants: consultation.maxParticipants,
          hipaaCompliant: true,
        };

        // Cache the config
        await this.cacheService.set(cacheKey, roomConfig, this.MEETING_CACHE_TTL);
        return roomConfig;
      }

      return null;
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
      // Try cache first
      const cacheKey = `video_session:${appointmentId}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as VideoConsultationSession;
      }

      // Get from database (VideoConsultation with participants)
      const consultation = (await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            videoConsultation: {
              findUnique: <T>(args: T) => Promise<unknown>;
            };
          }
        ).videoConsultation.findUnique({
          where: { appointmentId },
          include: {
            participants: true,
            appointment: {
              include: {
                patient: {
                  include: {
                    user: true,
                  },
                },
                doctor: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        });
      })) as {
        appointmentId: string;
        roomId: string;
        status: string;
        startTime: Date | null;
        endTime: Date | null;
        recordingUrl: string | null;
        participants: Array<{
          userId: string;
          role: string;
          joinedAt: Date | null;
          leftAt: Date | null;
          duration: number | null;
        }>;
      } | null;

      if (!consultation) {
        return null;
      }

      // Map to VideoConsultationSession
      const mappedStatus = this.mapDbStatusToSessionStatus(consultation.status);
      const sessionStatus: 'pending' | 'started' | 'ended' =
        mappedStatus === 'cancelled' ? 'ended' : mappedStatus;
      const session: VideoConsultationSession = {
        appointmentId: consultation.appointmentId,
        roomName: consultation.roomId,
        status: sessionStatus,
        ...(consultation.startTime && { startTime: consultation.startTime }),
        ...(consultation.endTime && { endTime: consultation.endTime }),
        participants: consultation.participants.map(
          (p: {
            userId: string;
            role: string;
            joinedAt: Date | null;
            leftAt: Date | null;
            duration: number | null;
          }) => {
            const participant: {
              userId: string;
              userRole: 'doctor' | 'patient';
              patientId?: string;
              doctorId?: string;
              joinedAt?: Date;
              leftAt?: Date;
              duration?: number;
            } = {
              userId: p.userId,
              userRole: p.role === 'HOST' ? 'doctor' : 'patient',
            };
            if (p.role === 'HOST') {
              participant.doctorId = p.userId;
            } else {
              participant.patientId = p.userId;
            }
            if (p.joinedAt) {
              participant.joinedAt = p.joinedAt;
            }
            if (p.leftAt) {
              participant.leftAt = p.leftAt;
            }
            if (p.duration) {
              participant.duration = p.duration;
            }
            return participant;
          }
        ),
        ...(consultation.recordingUrl && { recordingUrl: consultation.recordingUrl }),
        hipaaAuditLog: [], // Would be populated from audit logs if needed
        technicalIssues: [], // Would be populated if stored
      };

      // Cache the session
      await this.cacheService.set(cacheKey, session, this.MEETING_CACHE_TTL);
      return session;
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

  private mapDbStatusToSessionStatus(
    status: string
  ): 'pending' | 'started' | 'ended' | 'cancelled' {
    switch (status) {
      case 'SCHEDULED':
        return 'pending';
      case 'ACTIVE':
        return 'started';
      case 'COMPLETED':
        return 'ended';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'pending';
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
    try {
      // Get appointment to get clinicId
      const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
      if (!appointment) {
        throw new HealthcareError(
          ErrorCode.DATABASE_RECORD_NOT_FOUND,
          `Appointment ${appointmentId} not found`,
          undefined,
          { appointmentId },
          'JitsiVideoService.createVideoSession'
        );
      }

      // Check if VideoConsultation already exists
      let consultation = (await this.databaseService.executeHealthcareRead(async client => {
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
      })) as {
        id: string;
        status: string;
        appointmentId: string;
        roomId: string;
        startTime: Date | null;
        endTime: Date | null;
        participants: Array<{ userId: string }>;
      } | null;

      if (!consultation) {
        // Create new VideoConsultation
        const jitsiConfig = this.configService.getJitsiConfig();
        const roomId = this.generateSecureRoomName(appointmentId, appointment.clinicId);
        const meetingUrl = `${jitsiConfig.baseUrl}/${roomId}`;

        consultation = (await this.databaseService.executeHealthcareWrite(
          async client => {
            return await (
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
              include: { participants: true },
            });
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
        )) as {
          id: string;
          status: string;
          appointmentId: string;
          roomId: string;
          startTime: Date | null;
          endTime: Date | null;
          participants: Array<{ userId: string }>;
        };
      }

      // Create or update participant
      const participantRole = userRole === 'doctor' ? 'HOST' : 'PARTICIPANT';
      const existingParticipant = consultation.participants.find(
        (p: { userId: string }) => p.userId === userId
      );

      if (!existingParticipant) {
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await (
              client as unknown as {
                videoParticipant: {
                  create: <T>(args: T) => Promise<unknown>;
                };
              }
            ).videoParticipant.create({
              data: {
                consultationId: consultation.id,
                userId,
                role: participantRole,
                status: 'INVITED',
              },
            });
          },
          {
            userId,
            userRole: userRole === 'doctor' ? 'DOCTOR' : 'PATIENT',
            clinicId: appointment.clinicId,
            operation: 'CREATE_VIDEO_PARTICIPANT',
            resourceType: 'VIDEO_PARTICIPANT',
            resourceId: '',
            timestamp: new Date(),
          }
        );
      }

      // Map to VideoConsultationSession
      const mappedStatus = this.mapDbStatusToSessionStatus(consultation.status);
      const sessionStatus: 'pending' | 'started' | 'ended' =
        mappedStatus === 'cancelled' ? 'ended' : mappedStatus;
      const session: VideoConsultationSession = {
        appointmentId: consultation.appointmentId,
        roomName: consultation.roomId,
        status: sessionStatus,
        ...(consultation.startTime && { startTime: consultation.startTime }),
        ...(consultation.endTime && { endTime: consultation.endTime }),
        participants: [
          {
            userId,
            userRole,
            ...(userRole === 'patient' ? { patientId: userId } : { doctorId: userId }),
          },
        ],
        hipaaAuditLog: [],
        technicalIssues: [],
      };

      // Store session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL
      );

      return session;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create video session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.createVideoSession',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
          userId,
          userRole,
        }
      );
      throw error instanceof HealthcareError
        ? error
        : new HealthcareError(
            ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
            `Failed to create video session: ${error instanceof Error ? error.message : 'Unknown error'}`,
            undefined,
            { appointmentId },
            'JitsiVideoService.createVideoSession'
          );
    }
  }

  private generateJitsiToken(
    userId: string,
    userRole: 'patient' | 'doctor',
    userInfo: { displayName: string; email: string; avatar?: string },
    roomConfig: JitsiRoomConfig
  ): string {
    try {
      const jitsiConfig = this.configService.getJitsiConfig();

      // If Jitsi is not enabled or no app secret, return placeholder
      if (!jitsiConfig.enabled || !jitsiConfig.appSecret) {
        return `jwt_token_${userId}_${userRole}_${Date.now()}`;
      }

      // Generate JWT token for Jitsi Meet
      // Jitsi JWT format: https://github.com/jitsi/lib-jitsi-meet/blob/master/doc/tokens.md
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: jitsiConfig.appId,
        aud: jitsiConfig.appId,
        sub: jitsiConfig.domain,
        room: roomConfig.roomName,
        exp: now + 3600, // 1 hour expiration
        nbf: now - 10, // Not before (10 seconds ago to account for clock skew)
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

      // Sign token with Jitsi app secret
      return jwt.sign(payload, jitsiConfig.appSecret, {
        algorithm: 'HS256',
        header: {
          alg: 'HS256',
          typ: 'JWT',
        },
      });
    } catch (error) {
      // Fallback to placeholder if token generation fails
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to generate Jitsi JWT token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JitsiVideoService.generateJitsiToken',
        { userId, userRole, error: error instanceof Error ? error.message : String(error) }
      );
      return `jwt_token_${userId}_${userRole}_${Date.now()}`;
    }
  }

  private logHipaaEvent(action: string, details: unknown): void {
    try {
      void this.loggingService.log(
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
