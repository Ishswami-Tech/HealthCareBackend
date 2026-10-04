import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { VideoService } from '@services/video/video.service';
import { VideoConsultationTracker } from '@services/video/video-consultation-tracker.service';
import type { VideoCallerContext, VideoCallerRole } from '@services/video/video-access.helpers';
import { LoggingService } from '@infrastructure/logging';

/**
 * Features of the clinic video plugin. The plugin manager resolves a plugin by feature name, so a
 * request that names one of these reaches `ClinicVideoPlugin`, whatever its `domain` says.
 */
export const VIDEO_PLUGIN_FEATURES: readonly string[] = [
  'video-calls',
  'consultation-rooms',
  'recording',
  'screen-sharing',
  'medical-imaging',
  'real-time-tracking',
  'hipaa-compliance',
];

export function isVideoPluginFeature(feature: unknown): boolean {
  return typeof feature === 'string' && VIDEO_PLUGIN_FEATURES.includes(feature);
}

/** Roles accepted for a video operation (same set the video layer works with). */
const VIDEO_CALLER_ROLES: readonly VideoCallerRole[] = [
  'patient',
  'doctor',
  'receptionist',
  'clinic_admin',
];

/**
 * Interface for video plugin data validation
 */
export interface VideoPluginData {
  operation: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  /**
   * Clinic the caller is acting in. Required for the join / start / end operations: VideoService
   * authorizes the caller against the appointment's clinic with it. Callers must supply the
   * clinic validated by ClinicGuard (req.clinicContext.clinicId), never a request-body value.
   */
  clinicId?: string;
  callId?: string;
  /**
   * Acting user. Operations that run inside a user-initiated request must carry the authenticated
   * user (the plugin controller overwrites whatever the request body claimed).
   */
  userId?: string;
  /** Video role of the acting user, mapped from the authenticated platform role. */
  userRole?: VideoCallerRole;
  /** Platform role of the acting user before mapping (for example CLINIC_ADMIN). */
  rawRole?: string;
  displayName?: { name: string; email: string; avatar?: string };
  sessionNotes?: string;
  issueType?: string;
  description?: string;
  deviceInfo?: string;
  quality?: 'excellent' | 'good' | 'fair' | 'poor';
  isRecording?: boolean;
  recordingDuration?: number;
  imageData?: string;
  options?: Record<string, unknown>;
}

/**
 * Clinic Video Plugin for handling video consultation operations
 *
 * This plugin provides comprehensive video consultation functionality including:
 * - Backward-compatible video consultation operations
 * - Unified video consultations through the backend video service
 * - Real-time tracking and analytics
 * - HIPAA-compliant recording and data handling
 */
@Injectable()
export class ClinicVideoPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-video-plugin';
  readonly version = '1.0.0';
  readonly features = [...VIDEO_PLUGIN_FEATURES];

  /**
   * Creates an instance of ClinicVideoPlugin
   *
   * @param videoService - Single consolidated video service with provider fallback
   * @param consultationTracker - Service for tracking consultation metrics
   */
  constructor(
    @Inject(forwardRef(() => VideoService))
    private readonly videoService: VideoService,
    @Inject(forwardRef(() => VideoConsultationTracker))
    private readonly consultationTracker: VideoConsultationTracker,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    loggingService?: LoggingService
  ) {
    super(loggingService);
  }

  /**
   * Processes video plugin operations
   *
   * @param data - The video plugin data containing operation details
   * @returns Promise resolving to the operation result
   * @throws Error if the operation is unknown or fails
   */
  async process(data: unknown): Promise<unknown> {
    // Validate input data
    if (!this.isValidVideoData(data)) {
      throw new Error('Invalid video plugin data provided');
    }

    const videoData = data;
    await this.logPluginAction('Processing clinic video operation', {
      operation: videoData.operation,
    });

    try {
      // Delegate to existing video service - no functionality change
      switch (videoData.operation) {
        case 'createVideoCall':
        case 'createConsultationRoom':
          // Compatibility shim: room creation is now handled automatically during generateMeetingToken
          // Return success without calling non-existent videoService methods
          return { success: true, message: 'Room creation is handled dynamically.' };

        case 'generateJoinToken':
          return await this.videoService.generateMeetingToken(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!,
            {
              displayName: videoData.displayName?.name || 'User',
              email: '',
              // ...(videoData.avatar && { avatar: videoData.avatar }),
            },
            this.requireCallerContext(videoData)
          );

        case 'startConsultationSession':
          return await this.videoService.startConsultation(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!,
            this.requireCallerContext(videoData)
          );

        case 'endConsultationSession':
          return await this.videoService.endConsultation(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!,
            videoData.sessionNotes,
            this.requireCallerContext(videoData)
          );

        case 'getConsultationStatus':
          return await this.videoService.getConsultationStatus(videoData.appointmentId!);

        case 'reportTechnicalIssue':
          await this.videoService.reportTechnicalIssue(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.description || 'Technical issue',
            (videoData.issueType as 'audio' | 'video' | 'connection' | 'other') || 'other'
          );
          return {
            success: true,
            message: 'Technical issue reported',
          };

        // Real-time tracking operations
        case 'initializeTracking':
          return await this.consultationTracker.initializeConsultationTracking(
            videoData.appointmentId!,
            videoData.patientId!,
            videoData.doctorId!
          );

        case 'trackParticipantJoined':
          return await this.consultationTracker.trackParticipantJoined(
            videoData.appointmentId!,
            videoData.userId!,
            this.toTrackedParticipantRole(videoData.userRole),
            videoData.deviceInfo
          );

        case 'trackParticipantLeft':
          return await this.consultationTracker.trackParticipantLeft(
            videoData.appointmentId!,
            videoData.userId!,
            this.toTrackedParticipantRole(videoData.userRole)
          );

        case 'updateConnectionQuality':
          return await this.consultationTracker.updateConnectionQuality(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.quality!
          );

        case 'trackRecordingStatus':
          return await this.consultationTracker.trackRecordingStatus(
            videoData.appointmentId!,
            videoData.isRecording!,
            videoData.recordingDuration
          );

        case 'getConsultationMetrics':
          return await this.consultationTracker.getConsultationMetrics(videoData.appointmentId!);

        case 'endTracking':
          return await this.consultationTracker.endConsultationTracking(videoData.appointmentId!);

        default:
          await this.logPluginError('Unknown video operation', {
            operation: videoData.operation,
          });
          throw new Error(`Unknown video operation: ${videoData.operation}`);
      }
    } catch (error) {
      await this.logPluginError('Failed to process video operation', {
        operation: videoData.operation,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validates video plugin data
   *
   * @param data - The data to validate
   * @returns Promise resolving to true if the data is valid, false otherwise
   */
  async validate(data: unknown): Promise<boolean> {
    if (!this.isValidVideoData(data)) {
      return Promise.resolve(false);
    }

    const pluginData = data;
    // Validate that required fields are present for each operation
    const requiredFields = {
      // Backward-compatible video call operations
      createVideoCall: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      endVideoCall: ['callId', 'userId'],
      startRecording: ['callId', 'userId'],
      stopRecording: ['callId', 'userId'],
      shareMedicalImage: ['callId', 'userId', 'imageData'],
      getVideoCallHistory: ['userId'],

      // Current consultation operations
      createConsultationRoom: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      generateJoinToken: ['appointmentId', 'userId', 'userRole', 'displayName', 'clinicId'],
      startConsultationSession: ['appointmentId', 'userId', 'userRole', 'clinicId'],
      endConsultationSession: ['appointmentId', 'userId', 'clinicId'],
      getConsultationStatus: ['appointmentId'],
      reportTechnicalIssue: ['appointmentId', 'userId', 'issueType', 'description'],

      // Real-time tracking operations
      initializeTracking: ['appointmentId', 'patientId', 'doctorId'],
      trackParticipantJoined: ['appointmentId', 'userId', 'userRole'],
      trackParticipantLeft: ['appointmentId', 'userId', 'userRole'],
      updateConnectionQuality: ['appointmentId', 'userId', 'quality'],
      trackRecordingStatus: ['appointmentId', 'isRecording'],
      getConsultationMetrics: ['appointmentId'],
      endTracking: ['appointmentId'],
    };

    const operation = pluginData.operation;
    const fields = requiredFields[operation as keyof typeof requiredFields];

    if (!fields) {
      await this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every((field: string) => {
      const value = pluginData[field as keyof VideoPluginData];
      return value !== undefined && value !== null;
    });

    if (!isValid) {
      await this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return Promise.resolve(isValid);
  }

  /**
   * The caller context VideoService needs to authorize join / start / end. The clinic is the one
   * the request was validated for, and the raw platform role is the authenticated user's own (the
   * plugin controller sets both; without one the participant role stands in, which never claims a
   * SUPER_ADMIN / system bypass). A missing clinic fails closed instead of being sent on.
   */
  private requireCallerContext(videoData: VideoPluginData): VideoCallerContext {
    if (!videoData.clinicId) {
      throw new Error(`clinicId is required for the ${videoData.operation} video operation`);
    }
    return {
      clinicId: videoData.clinicId,
      rawRole: videoData.rawRole ?? String(videoData.userRole ?? ''),
    };
  }

  /** The consultation tracker only distinguishes the patient from the clinical side. */
  private toTrackedParticipantRole(role: VideoCallerRole | undefined): 'patient' | 'doctor' {
    return role === 'patient' ? 'patient' : 'doctor';
  }

  /**
   * Validates if the provided data is valid video plugin data
   *
   * @param data - The data to validate
   * @returns true if the data is valid, false otherwise
   */
  private isValidVideoData(data: unknown): data is VideoPluginData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const obj = data as Record<string, unknown>;

    // Check if operation is present and is a string
    if (typeof obj['operation'] !== 'string' || obj['operation'].length === 0) {
      return false;
    }

    // Check if all optional properties are of correct types when present
    const optionalStringFields = [
      'appointmentId',
      'patientId',
      'doctorId',
      'clinicId',
      'callId',
      'userId',
      'rawRole',
      'sessionNotes',
      'issueType',
      'description',
      'deviceInfo',
      'imageData',
    ];

    for (const field of optionalStringFields) {
      if (obj[field] !== undefined && typeof obj[field] !== 'string') {
        return false;
      }
    }

    // Check userRole if present
    if (
      obj['userRole'] !== undefined &&
      !VIDEO_CALLER_ROLES.includes(obj['userRole'] as VideoCallerRole)
    ) {
      return false;
    }

    // Check quality if present
    if (
      obj['quality'] !== undefined &&
      !['excellent', 'good', 'fair', 'poor'].includes(obj['quality'] as string)
    ) {
      return false;
    }

    // Check boolean fields
    if (obj['isRecording'] !== undefined && typeof obj['isRecording'] !== 'boolean') {
      return false;
    }

    // Check number fields
    if (obj['recordingDuration'] !== undefined && typeof obj['recordingDuration'] !== 'number') {
      return false;
    }

    // Check displayName if present
    if (obj['displayName'] !== undefined) {
      if (!obj['displayName'] || typeof obj['displayName'] !== 'object') {
        return false;
      }
      const displayName = obj['displayName'] as Record<string, unknown>;
      if (typeof displayName['name'] !== 'string' || typeof displayName['email'] !== 'string') {
        return false;
      }
      if (displayName['avatar'] !== undefined && typeof displayName['avatar'] !== 'string') {
        return false;
      }
    }

    // Check options if present
    if (
      obj['options'] !== undefined &&
      (typeof obj['options'] !== 'object' || obj['options'] === null)
    ) {
      return false;
    }

    return true;
  }
}
