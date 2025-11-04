import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocketService } from '@communication/socket/socket.service';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import type { DeviceInfo } from '@core/types/appointment.types';
import { LogType, LogLevel } from '@core/types';

export interface ConsultationEvent {
  type:
    | 'participant_joined'
    | 'participant_left'
    | 'status_changed'
    | 'technical_issue'
    | 'recording_started'
    | 'recording_stopped';
  appointmentId: string;
  userId: string;
  userRole: 'patient' | 'doctor';
  timestamp: Date;
  data?: unknown;
  [key: string]: unknown; // Make it compatible with SocketEventData
}

export interface ParticipantStatus {
  userId: string;
  userRole: 'patient' | 'doctor';
  name: string;
  isOnline: boolean;
  joinedAt?: Date;
  lastSeen?: Date;
  connectionQuality?: 'excellent' | 'good' | 'fair' | 'poor';
  deviceInfo?: {
    platform: string;
    browser: string;
    hasCamera: boolean;
    hasMicrophone: boolean;
  };
  issues?: string[];
}

export interface ConsultationMetrics {
  appointmentId: string;
  status: 'waiting' | 'starting' | 'active' | 'ending' | 'ended';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  participants: ParticipantStatus[];
  totalParticipants: number;
  currentParticipants: number;
  connectionIssues: number;
  recordingActive: boolean;
  recordingDuration?: number;
  technicalIssues: {
    audio: number;
    video: number;
    connection: number;
    other: number;
  };
  lastActivity: Date;
}

@Injectable()
export class VideoConsultationTracker {
  private readonly TRACKER_CACHE_TTL = 3600; // 1 hour
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 60000; // 1 minute

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly socketService: SocketService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {
    this.initializeEventListeners();
    this.startHeartbeatMonitoring();
  }

  /**
   * Initialize consultation tracking for an appointment
   */
  async initializeConsultationTracking(
    appointmentId: string,
    patientId: string,
    doctorId: string
  ): Promise<ConsultationMetrics> {
    try {
      const metrics: ConsultationMetrics = {
        appointmentId,
        status: 'waiting',
        participants: [
          {
            userId: patientId,
            userRole: 'patient',
            name: 'Patient', // This would be fetched from user service
            isOnline: false,
          },
          {
            userId: doctorId,
            userRole: 'doctor',
            name: 'Doctor', // This would be fetched from user service
            isOnline: false,
          },
        ],
        totalParticipants: 2,
        currentParticipants: 0,
        connectionIssues: 0,
        recordingActive: false,
        technicalIssues: {
          audio: 0,
          video: 0,
          connection: 0,
          other: 0,
        },
        lastActivity: new Date(),
      };

      // Store metrics in cache
      const cacheKey = `consultation_metrics:${appointmentId}`;
      await this.cacheService.set(cacheKey, metrics, this.TRACKER_CACHE_TTL);

      // Room creation is handled by Socket.IO automatically when users join

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Consultation tracking initialized for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          patientId,
          doctorId,
          status: metrics.status,
        }
      );

      return metrics;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to initialize consultation tracking for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
      throw _error;
    }
  }

  /**
   * Track participant joining the consultation
   */
  async trackParticipantJoined(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor',
    deviceInfo?: unknown
  ): Promise<void> {
    try {
      const metrics = await this.getConsultationMetrics(appointmentId);
      if (!metrics) {
        throw new Error(`No consultation metrics found for appointment ${appointmentId}`);
      }

      // Update participant status
      const participantIndex = metrics.participants.findIndex(p => p.userId === userId);
      if (participantIndex >= 0 && metrics.participants[participantIndex]) {
        const typedDeviceInfo = deviceInfo as {
          browser?: string;
          hasCamera?: boolean;
          hasMicrophone?: boolean;
          platform?: string;
          language?: string;
          timezone?: string;
          deviceType?: 'mobile' | 'tablet' | 'desktop';
        };
        metrics.participants[participantIndex].isOnline = true;
        metrics.participants[participantIndex].joinedAt = new Date();
        metrics.participants[participantIndex].lastSeen = new Date();
        metrics.participants[participantIndex].deviceInfo = {
          userAgent:
            typeof typedDeviceInfo === 'object' &&
            typedDeviceInfo !== null &&
            'userAgent' in typedDeviceInfo
              ? String(typedDeviceInfo.userAgent)
              : '',
          platform: typedDeviceInfo?.platform || '',
          browser: typedDeviceInfo?.browser || '',
          hasCamera: typedDeviceInfo?.hasCamera || false,
          hasMicrophone: typedDeviceInfo?.hasMicrophone || false,
        } as { platform: string; browser: string; hasCamera: boolean; hasMicrophone: boolean };
      }

      // Update metrics
      metrics.currentParticipants = metrics.participants.filter(p => p.isOnline).length;
      metrics.lastActivity = new Date();

      // Update status if this is the first participant
      if (metrics.status === 'waiting' && metrics.currentParticipants === 1) {
        metrics.status = 'starting';
      } else if (metrics.status === 'starting' && metrics.currentParticipants === 2) {
        metrics.status = 'active';
        metrics.startTime = new Date();
      }

      // Save updated metrics
      await this.saveConsultationMetrics(appointmentId, metrics);

      // User will be notified via room events

      // Emit participant joined event
      await this.emitConsultationEvent({
        type: 'participant_joined',
        appointmentId,
        userId,
        userRole,
        timestamp: new Date(),
        data: { deviceInfo, currentParticipants: metrics.currentParticipants },
      });

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Participant joined consultation for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          userId,
          userRole,
          currentParticipants: metrics.currentParticipants,
          status: metrics.status,
        }
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to track participant joining for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
          userId,
          userRole,
        }
      );
    }
  }

  /**
   * Track participant leaving the consultation
   */
  async trackParticipantLeft(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor'
  ): Promise<void> {
    try {
      const metrics = await this.getConsultationMetrics(appointmentId);
      if (!metrics) {
        throw new Error(`No consultation metrics found for appointment ${appointmentId}`);
      }

      // Update participant status
      const participantIndex = metrics.participants.findIndex(p => p.userId === userId);
      if (participantIndex >= 0 && metrics.participants[participantIndex]) {
        metrics.participants[participantIndex].isOnline = false;
        metrics.participants[participantIndex].lastSeen = new Date();
      }

      // Update metrics
      metrics.currentParticipants = metrics.participants.filter(p => p.isOnline).length;
      metrics.lastActivity = new Date();

      // Update status if all participants left
      if (metrics.currentParticipants === 0 && metrics.status === 'active') {
        metrics.status = 'ending';
        metrics.endTime = new Date();
        if (metrics.startTime) {
          metrics.duration = metrics.endTime.getTime() - metrics.startTime.getTime();
        }
      }

      // Save updated metrics
      await this.saveConsultationMetrics(appointmentId, metrics);

      // User will be notified via room events

      // Emit participant left event
      await this.emitConsultationEvent({
        type: 'participant_left',
        appointmentId,
        userId,
        userRole,
        timestamp: new Date(),
        data: { currentParticipants: metrics.currentParticipants },
      });

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Participant left consultation for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          userId,
          userRole,
          currentParticipants: metrics.currentParticipants,
          status: metrics.status,
        }
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to track participant leaving for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
          userId,
          userRole,
        }
      );
    }
  }

  /**
   * Track technical issues during consultation
   */
  async trackTechnicalIssue(
    appointmentId: string,
    userId: string,
    issueType: 'audio' | 'video' | 'connection' | 'other',
    description: string
  ): Promise<void> {
    try {
      const metrics = await this.getConsultationMetrics(appointmentId);
      if (!metrics) {
        throw new Error(`No consultation metrics found for appointment ${appointmentId}`);
      }

      // Update technical issues count
      metrics.technicalIssues[issueType]++;
      metrics.lastActivity = new Date();

      // Add issue to participant
      const participantIndex = metrics.participants.findIndex(p => p.userId === userId);
      if (participantIndex >= 0) {
        if (metrics.participants[participantIndex]) {
          if (!metrics.participants[participantIndex].issues) {
            metrics.participants[participantIndex].issues = [];
          }
          metrics.participants[participantIndex].issues.push(`[${issueType}] ${description}`);
        }
      }

      // Save updated metrics
      await this.saveConsultationMetrics(appointmentId, metrics);

      // Emit technical issue event
      await this.emitConsultationEvent({
        type: 'technical_issue',
        appointmentId,
        userId,
        userRole: metrics.participants.find(p => p.userId === userId)?.userRole || 'patient',
        timestamp: new Date(),
        data: {
          issueType,
          description,
          totalIssues: metrics.technicalIssues[issueType],
        },
      });

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Technical issue reported for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          userId,
          issueType,
          description,
          totalIssues: metrics.technicalIssues[issueType],
        }
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to track technical issue for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
          userId,
          issueType,
        }
      );
    }
  }

  /**
   * Update participant connection quality
   */
  async updateConnectionQuality(
    appointmentId: string,
    userId: string,
    quality: 'excellent' | 'good' | 'fair' | 'poor'
  ): Promise<void> {
    try {
      const metrics = await this.getConsultationMetrics(appointmentId);
      if (!metrics) {
        return;
      }

      // Update participant connection quality
      const participantIndex = metrics.participants.findIndex(p => p.userId === userId);
      if (participantIndex >= 0) {
        if (metrics.participants[participantIndex]) {
          metrics.participants[participantIndex].connectionQuality = quality;
          metrics.participants[participantIndex].lastSeen = new Date();
        }
      }

      // Track connection issues
      if (quality === 'poor') {
        metrics.connectionIssues++;
      }

      metrics.lastActivity = new Date();

      // Save updated metrics
      await this.saveConsultationMetrics(appointmentId, metrics);

      // Emit real-time update
      this.socketService.sendToRoom(`consultation_${appointmentId}`, 'connection_quality_update', {
        userId,
        quality,
        timestamp: new Date().toISOString(),
      });
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update connection quality for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
          userId,
          quality,
        }
      );
    }
  }

  /**
   * Track recording status
   */
  async trackRecordingStatus(
    appointmentId: string,
    isRecording: boolean,
    recordingDuration?: number
  ): Promise<void> {
    try {
      const metrics = await this.getConsultationMetrics(appointmentId);
      if (!metrics) {
        return;
      }

      metrics.recordingActive = isRecording;
      metrics.recordingDuration = recordingDuration || 0;
      metrics.lastActivity = new Date();

      // Save updated metrics
      await this.saveConsultationMetrics(appointmentId, metrics);

      // Emit recording status event
      await this.emitConsultationEvent({
        type: isRecording ? 'recording_started' : 'recording_stopped',
        appointmentId,
        userId: 'system',
        userRole: 'doctor',
        timestamp: new Date(),
        data: { recordingDuration },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Recording ${isRecording ? 'started' : 'stopped'} for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          recordingDuration,
        }
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to track recording status for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
          isRecording,
        }
      );
    }
  }

  /**
   * Get current consultation metrics
   */
  async getConsultationMetrics(appointmentId: string): Promise<ConsultationMetrics | null> {
    try {
      const cacheKey = `consultation_metrics:${appointmentId}`;
      return await this.cacheService.get(cacheKey);
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get consultation metrics for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
      return null;
    }
  }

  /**
   * End consultation tracking
   */
  async endConsultationTracking(appointmentId: string): Promise<ConsultationMetrics | null> {
    try {
      const metrics = await this.getConsultationMetrics(appointmentId);
      if (!metrics) {
        return null;
      }

      // Update final metrics
      metrics.status = 'ended';
      metrics.endTime = new Date();
      if (metrics.startTime) {
        metrics.duration = metrics.endTime.getTime() - metrics.startTime.getTime();
      }

      // Mark all participants as offline
      metrics.participants.forEach(participant => {
        participant.isOnline = false;
        participant.lastSeen = new Date();
      });

      metrics.currentParticipants = 0;
      metrics.recordingActive = false;

      // Save final metrics
      await this.saveConsultationMetrics(appointmentId, metrics);

      // Room cleanup is handled automatically by Socket.IO

      // Emit consultation ended event
      await this.emitConsultationEvent({
        type: 'status_changed',
        appointmentId,
        userId: 'system',
        userRole: 'doctor',
        timestamp: new Date(),
        data: { status: 'ended', duration: metrics.duration },
      });

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Consultation tracking ended for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          duration: metrics.duration,
          totalIssues: Object.values(metrics.technicalIssues).reduce(
            (sum, count) => sum + count,
            0
          ),
        }
      );

      return metrics;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end consultation tracking for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
      return null;
    }
  }

  /**
   * Save consultation metrics to cache
   */
  private async saveConsultationMetrics(
    appointmentId: string,
    metrics: ConsultationMetrics
  ): Promise<void> {
    try {
      const cacheKey = `consultation_metrics:${appointmentId}`;
      await this.cacheService.set(cacheKey, metrics, this.TRACKER_CACHE_TTL);
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to save consultation metrics for appointment ${appointmentId}`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
    }
  }

  /**
   * Emit consultation event
   */
  private async emitConsultationEvent(event: ConsultationEvent): Promise<void> {
    try {
      // Convert event to socket-compatible format
      const socketEvent = {
        type: event.type,
        appointmentId: event.appointmentId,
        userId: event.userId,
        userRole: event.userRole,
        timestamp: event.timestamp.toISOString(),
        data: (event.data || {}) as Record<string, string | number | boolean | null>,
      };
      // Emit to WebSocket room
      this.socketService.sendToRoom(
        `consultation_${event.appointmentId}`,
        'consultation_event',
        socketEvent
      );

      // Emit to event system
      this.eventEmitter.emit('consultation.event', event);

      // Log for audit trail
      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Video consultation ${event.type}`,
        'VideoConsultationTracker',
        {
          ...event,
          service: 'video_consultation_tracking',
          audit: true,
        }
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to emit consultation event`,
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
          event: event.type,
          appointmentId: event.appointmentId,
        }
      );
    }
  }

  /**
   * Initialize event listeners
   */
  private initializeEventListeners(): void {
    // Listen for socket connection events
    this.eventEmitter.on('socket.user.connected', async (data: { userId: string }) => {
      // Update user's last seen for active consultations
      await this.updateUserLastSeen(data.userId);
    });

    this.eventEmitter.on('socket.user.disconnected', async (data: { userId: string }) => {
      // Handle user disconnection for active consultations
      await this.handleUserDisconnection(data.userId);
    });
  }

  /**
   * Start heartbeat monitoring for active consultations
   */
  private startHeartbeatMonitoring(): void {
    setInterval(async () => {
      await this.checkActiveConsultations();
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Check active consultations for timeouts
   */
  private async checkActiveConsultations(): Promise<void> {
    try {
      // This would check all active consultations and handle timeouts
      // For now, it's a placeholder for the monitoring logic
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'Checking active consultations for timeouts',
        'VideoConsultationTracker'
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to check active consultations',
        'VideoConsultationTracker',
        {
          _error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
    }
  }

  /**
   * Update user's last seen timestamp
   */
  private async updateUserLastSeen(userId: string): Promise<void> {
    // This would update the last seen timestamp for the user in active consultations
  }

  /**
   * Handle user disconnection
   */
  private async handleUserDisconnection(userId: string): Promise<void> {
    // This would handle user disconnection for active consultations
  }
}
