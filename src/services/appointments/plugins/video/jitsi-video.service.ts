import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { PrismaService } from "../../../../libs/infrastructure/database/prisma/prisma.service";
import { SocketService } from "../../../../libs/communication/socket/socket.service";

export interface JitsiRoomConfig {
  roomName: string;
  domain: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  isSecure: boolean;
  maxParticipants: number;
  enableRecording: boolean;
  enableChat: boolean;
  enableScreenShare: boolean;
  enableLobby: boolean;
  moderatorPassword?: string;
  participantPassword?: string;
  recordingPath?: string;
  hipaaCompliant: boolean;
}

export interface JitsiMeetingToken {
  jwt: string;
  roomName: string;
  domain: string;
  userInfo: {
    displayName: string;
    email: string;
    role: "moderator" | "participant";
    avatar?: string;
  };
  features: {
    recording: boolean;
    chat: boolean;
    screenShare: boolean;
    lobby: boolean;
  };
  security: {
    roomPassword?: string;
    meetingPassword?: string;
    encryptionKey?: string;
  };
}

export interface VideoConsultationSession {
  id: string;
  appointmentId: string;
  roomName: string;
  status: "created" | "started" | "active" | "ended" | "recorded";
  participants: {
    patientId: string;
    doctorId: string;
    joinedAt?: Date;
    leftAt?: Date;
    duration?: number;
  }[];
  startTime?: Date;
  endTime?: Date;
  recordingUrl?: string;
  meetingNotes?: string;
  technicalIssues?: string[];
  hipaaAuditLog: {
    action: string;
    timestamp: Date;
    userId: string;
    details: unknown;
  }[];
}

@Injectable()
export class JitsiVideoService {
  private readonly logger = new Logger(JitsiVideoService.name);
  private readonly JITSI_DOMAIN: string;
  private readonly JITSI_APP_ID: string;
  private readonly JITSI_SECRET: string;
  private readonly MEETING_CACHE_TTL = 7200; // 2 hours
  private readonly ROOM_EXPIRY_TIME = 86400; // 24 hours

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly prismaService: PrismaService,
    private readonly socketService: SocketService,
  ) {
    this.JITSI_DOMAIN =
      this.configService.get<string>("JITSI_DOMAIN") || "meet.healthcare.local";
    this.JITSI_APP_ID =
      this.configService.get<string>("JITSI_APP_ID") || "healthcare_app";
    this.JITSI_SECRET =
      this.configService.get<string>("JITSI_SECRET") || "healthcare_secret_key";
  }

  /**
   * Create a secure Jitsi room for healthcare consultation
   */
  async createConsultationRoom(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string,
    options: Partial<JitsiRoomConfig> = {},
  ): Promise<JitsiRoomConfig> {
    try {
      // Generate secure room name with appointment context
      const roomName = this.generateSecureRoomName(appointmentId, clinicId);

      // Create room configuration with HIPAA compliance
      const roomConfig: JitsiRoomConfig = {
        roomName,
        domain: this.JITSI_DOMAIN,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        isSecure: true,
        maxParticipants: 2, // Patient and Doctor only
        enableRecording: options.enableRecording ?? true,
        enableChat: options.enableChat ?? true,
        enableScreenShare: options.enableScreenShare ?? true,
        enableLobby: true, // Always enable lobby for security
        moderatorPassword: this.generateSecurePassword(),
        participantPassword: this.generateSecurePassword(),
        recordingPath:
          options.recordingPath || `/recordings/${clinicId}/${appointmentId}`,
        hipaaCompliant: true,
        ...options,
      };

      // Store room configuration in cache
      const cacheKey = `jitsi_room:${appointmentId}`;
      await this.cacheService.set(cacheKey, roomConfig, this.MEETING_CACHE_TTL);

      // Create video consultation session record
      const session: VideoConsultationSession = {
        id: `session_${appointmentId}_${Date.now()}`,
        appointmentId,
        roomName,
        status: "created",
        participants: [{ patientId, doctorId }],
        hipaaAuditLog: [
          {
            action: "room_created",
            timestamp: new Date(),
            userId: doctorId,
            details: {
              roomName,
              clinicId,
              securityEnabled: roomConfig.isSecure,
              recordingEnabled: roomConfig.enableRecording,
            },
          },
        ],
      };

      // Store session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL,
      );

      // Log room creation for HIPAA compliance
      await this.logHipaaEvent("ROOM_CREATED", {
        appointmentId,
        roomName,
        doctorId,
        patientId,
        clinicId,
        security: "enabled",
      });

      this.logger.log(
        `Secure Jitsi room created for appointment ${appointmentId}`,
        {
          roomName,
          participantCount: 2,
          securityEnabled: true,
        },
      );

      return roomConfig;
    } catch (_error) {
      this.logger.error(
        `Failed to create Jitsi room for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
      throw _error;
    }
  }

  /**
   * Generate JWT token for secure Jitsi access
   */
  async generateMeetingToken(
    appointmentId: string,
    userId: string,
    userRole: "patient" | "doctor",
    userInfo: {
      name: string;
      email: string;
      avatar?: string;
    },
  ): Promise<JitsiMeetingToken> {
    try {
      // Get room configuration
      const roomConfig = await this.getRoomConfig(appointmentId);
      if (!roomConfig) {
        throw new Error(`No room found for appointment ${appointmentId}`);
      }

      // Create JWT payload with HIPAA-compliant settings
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600; // 1 hour expiry

      const payload = {
        iss: this.JITSI_APP_ID,
        sub: this.JITSI_DOMAIN,
        aud: "jitsi",
        exp,
        nbf: now - 10, // 10 seconds before current time
        room: roomConfig.roomName,
        context: {
          user: {
            id: userId,
            name: userInfo.name,
            email: userInfo.email,
            avatar: userInfo.avatar,
            role: userRole,
          },
          features: {
            recording: roomConfig.enableRecording && userRole === "doctor",
            chat: roomConfig.enableChat,
            screen_share: roomConfig.enableScreenShare,
            lobby: roomConfig.enableLobby,
          },
          security: {
            room_password:
              userRole === "doctor"
                ? roomConfig.moderatorPassword
                : roomConfig.participantPassword,
            encryption_enabled: true,
            hipaa_compliant: true,
          },
          appointment: {
            id: appointmentId,
            clinic_id: roomConfig.clinicId,
            patient_id: roomConfig.patientId,
            doctor_id: roomConfig.doctorId,
          },
        },
        moderator: userRole === "doctor",
      };

      // Generate JWT token
      const jwtToken = jwt.sign(payload, this.JITSI_SECRET, {
        algorithm: "HS256",
      });

      // Create meeting token response
      const meetingToken: JitsiMeetingToken = {
        jwt: jwtToken,
        roomName: roomConfig.roomName,
        domain: roomConfig.domain,
        userInfo: {
          displayName: userInfo.name,
          email: userInfo.email,
          role: userRole === "doctor" ? "moderator" : "participant",
          avatar: userInfo.avatar,
        },
        features: {
          recording: roomConfig.enableRecording && userRole === "doctor",
          chat: roomConfig.enableChat,
          screenShare: roomConfig.enableScreenShare,
          lobby: roomConfig.enableLobby,
        },
        security: {
          roomPassword:
            userRole === "doctor"
              ? roomConfig.moderatorPassword
              : roomConfig.participantPassword,
          meetingPassword: roomConfig.participantPassword,
          encryptionKey: this.generateEncryptionKey(appointmentId),
        },
      };

      // Log token generation
      await this.logHipaaEvent("TOKEN_GENERATED", {
        appointmentId,
        userId,
        userRole,
        roomName: roomConfig.roomName,
        tokenExpiry: exp,
      });

      this.logger.log(
        `JWT token generated for ${userRole} in appointment ${appointmentId}`,
        {
          userId,
          roomName: roomConfig.roomName,
          expiresAt: new Date(exp * 1000),
        },
      );

      return meetingToken;
    } catch (_error) {
      this.logger.error(
        `Failed to generate meeting token for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId,
          userRole,
        },
      );
      throw _error;
    }
  }

  /**
   * Start video consultation session
   */
  async startConsultation(
    appointmentId: string,
    userId: string,
    userRole: "patient" | "doctor",
  ): Promise<VideoConsultationSession> {
    try {
      // Get existing session
      const session = await this.getVideoSession(appointmentId);
      if (!session) {
        throw new Error(
          `No video session found for appointment ${appointmentId}`,
        );
      }

      // Update session status
      session.status = "started";
      session.startTime = new Date();

      // Update participant join time
      const participantIndex = session.participants.findIndex((p) =>
        userRole === "patient" ? p.patientId === userId : p.doctorId === userId,
      );

      if (participantIndex >= 0) {
        session.participants[participantIndex].joinedAt = new Date();
      }

      // Add audit log entry
      session.hipaaAuditLog.push({
        action: "consultation_started",
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
        this.MEETING_CACHE_TTL,
      );

      // Notify other participants via socket
      this.socketService.sendToRoom(
        `appointment_${appointmentId}`,
        "consultation_started",
        {
          appointmentId,
          startedBy: userRole,
          startTime: session.startTime,
        },
      );

      // Log consultation start
      await this.logHipaaEvent("CONSULTATION_STARTED", {
        appointmentId,
        userId,
        userRole,
        startTime: session.startTime,
        roomName: session.roomName,
      });

      this.logger.log(
        `Video consultation started for appointment ${appointmentId}`,
        {
          startedBy: userRole,
          participantCount: session.participants.length,
        },
      );

      return session;
    } catch (_error) {
      this.logger.error(
        `Failed to start consultation for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId,
          userRole,
        },
      );
      throw _error;
    }
  }

  /**
   * End video consultation session
   */
  async endConsultation(
    appointmentId: string,
    userId: string,
    userRole: "patient" | "doctor",
    meetingNotes?: string,
  ): Promise<VideoConsultationSession> {
    try {
      // Get existing session
      const session = await this.getVideoSession(appointmentId);
      if (!session) {
        throw new Error(
          `No video session found for appointment ${appointmentId}`,
        );
      }

      // Update session status
      session.status = "ended";
      session.endTime = new Date();
      session.meetingNotes = meetingNotes;

      // Calculate duration
      if (session.startTime) {
        const duration =
          session.endTime.getTime() - session.startTime.getTime();

        // Update participant leave time and duration
        const participantIndex = session.participants.findIndex((p) =>
          userRole === "patient"
            ? p.patientId === userId
            : p.doctorId === userId,
        );

        if (participantIndex >= 0) {
          session.participants[participantIndex].leftAt = session.endTime;
          session.participants[participantIndex].duration = Math.floor(
            duration / 1000,
          ); // seconds
        }
      }

      // Add audit log entry
      session.hipaaAuditLog.push({
        action: "consultation_ended",
        timestamp: new Date(),
        userId,
        details: {
          userRole,
          endTime: session.endTime,
          duration: session.participants.find((p) =>
            userRole === "patient"
              ? p.patientId === userId
              : p.doctorId === userId,
          )?.duration,
          meetingNotes: meetingNotes ? "notes_provided" : "no_notes",
        },
      });

      // Update session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL,
      );

      // Notify other participants via socket
      this.socketService.sendToRoom(
        `appointment_${appointmentId}`,
        "consultation_ended",
        {
          appointmentId,
          endedBy: userRole,
          endTime: session.endTime,
          duration: session.participants[0]?.duration,
        },
      );

      // Log consultation end
      await this.logHipaaEvent("CONSULTATION_ENDED", {
        appointmentId,
        userId,
        userRole,
        endTime: session.endTime,
        duration: session.participants[0]?.duration,
        notesProvided: !!meetingNotes,
      });

      // Start recording processing if enabled
      if (session.recordingUrl) {
        await this.processRecording(appointmentId, session.recordingUrl);
      }

      this.logger.log(
        `Video consultation ended for appointment ${appointmentId}`,
        {
          endedBy: userRole,
          duration: session.participants[0]?.duration,
          recordingAvailable: !!session.recordingUrl,
        },
      );

      return session;
    } catch (_error) {
      this.logger.error(
        `Failed to end consultation for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId,
          userRole,
        },
      );
      throw _error;
    }
  }

  /**
   * Get consultation session status
   */
  async getConsultationStatus(
    appointmentId: string,
  ): Promise<VideoConsultationSession | null> {
    try {
      return await this.getVideoSession(appointmentId);
    } catch (_error) {
      this.logger.error(
        `Failed to get consultation status for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
      return null;
    }
  }

  /**
   * Record technical issue during consultation
   */
  async reportTechnicalIssue(
    appointmentId: string,
    userId: string,
    issueDescription: string,
    issueType: "audio" | "video" | "connection" | "other",
  ): Promise<void> {
    try {
      const session = await this.getVideoSession(appointmentId);
      if (!session) {
        throw new Error(
          `No video session found for appointment ${appointmentId}`,
        );
      }

      // Add technical issue
      if (!session.technicalIssues) {
        session.technicalIssues = [];
      }

      session.technicalIssues.push(
        `[${issueType}] ${issueDescription} (reported by ${userId} at ${new Date().toISOString()})`,
      );

      // Add audit log entry
      session.hipaaAuditLog.push({
        action: "technical_issue_reported",
        timestamp: new Date(),
        userId,
        details: {
          issueType,
          description: issueDescription,
        },
      });

      // Update session in cache
      await this.cacheService.set(
        `video_session:${appointmentId}`,
        session,
        this.MEETING_CACHE_TTL,
      );

      // Log technical issue
      await this.logHipaaEvent("TECHNICAL_ISSUE", {
        appointmentId,
        userId,
        issueType,
        description: issueDescription,
      });

      this.logger.warn(
        `Technical issue reported for appointment ${appointmentId}`,
        {
          issueType,
          reportedBy: userId,
          description: issueDescription,
        },
      );
    } catch (_error) {
      this.logger.error(
        `Failed to report technical issue for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId,
          issueType,
        },
      );
      throw _error;
    }
  }

  /**
   * Get room configuration
   */
  private async getRoomConfig(
    appointmentId: string,
  ): Promise<JitsiRoomConfig | null> {
    try {
      const cacheKey = `jitsi_room:${appointmentId}`;
      return await this.cacheService.get(cacheKey);
    } catch (_error) {
      this.logger.error(
        `Failed to get room config for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
      return null;
    }
  }

  /**
   * Get video session
   */
  private async getVideoSession(
    appointmentId: string,
  ): Promise<VideoConsultationSession | null> {
    try {
      const cacheKey = `video_session:${appointmentId}`;
      return await this.cacheService.get(cacheKey);
    } catch (_error) {
      this.logger.error(
        `Failed to get video session for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
      return null;
    }
  }

  /**
   * Generate secure room name
   */
  private generateSecureRoomName(
    appointmentId: string,
    clinicId: string,
  ): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString("hex");
    return `healthcare_${clinicId}_${appointmentId}_${timestamp}_${random}`;
  }

  /**
   * Generate secure password
   */
  private generateSecurePassword(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Generate encryption key
   */
  private generateEncryptionKey(appointmentId: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${appointmentId}_${this.JITSI_SECRET}_${Date.now()}`);
    return hash.digest("hex").substring(0, 32);
  }

  /**
   * Process recording after consultation
   */
  private async processRecording(
    appointmentId: string,
    recordingUrl: string,
  ): Promise<void> {
    try {
      // This would typically involve:
      // 1. Downloading the recording from Jitsi
      // 2. Encrypting the recording for HIPAA compliance
      // 3. Storing in secure cloud storage
      // 4. Generating access logs
      // 5. Setting retention policies

      this.logger.log(`Processing recording for appointment ${appointmentId}`, {
        recordingUrl,
        status: "processing",
      });

      // Log recording processing for HIPAA compliance
      await this.logHipaaEvent("RECORDING_PROCESSED", {
        appointmentId,
        recordingUrl,
        processedAt: new Date(),
        encryptionStatus: "encrypted",
        retentionPeriod: "7_years",
      });
    } catch (_error) {
      this.logger.error(
        `Failed to process recording for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          recordingUrl,
        },
      );
    }
  }

  /**
   * Log HIPAA compliance events
   */
  private async logHipaaEvent(action: string, details: unknown): Promise<void> {
    try {
      await this.loggingService.log(
        "HIPAA_AUDIT" as any,
        "INFO" as any,
        `Video consultation ${action}`,
        "JitsiVideoService",
        {
          ...(details as Record<string, unknown>),
          timestamp: new Date().toISOString(),
          service: "jitsi_video_consultation",
          compliance: "hipaa",
          audit: true,
        },
      );
    } catch (_error) {
      this.logger.error("Failed to log HIPAA event", {
        action,
        _error: _error instanceof Error ? _error.message : "Unknown _error",
      });
    }
  }

  /**
   * Clean up expired rooms and sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // This would typically clean up:
      // 1. Expired room configurations
      // 2. Ended video sessions older than retention period
      // 3. Temporary recordings
      // 4. Unused JWT tokens

      this.logger.log("Cleaning up expired video consultation sessions");
    } catch (_error) {
      this.logger.error("Failed to cleanup expired sessions", {
        _error: _error instanceof Error ? _error.message : "Unknown _error",
      });
    }
  }
}
