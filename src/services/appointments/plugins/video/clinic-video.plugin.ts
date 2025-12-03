import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { VideoService } from './video.service';
import { JitsiVideoService } from './jitsi-video.service';
import { VideoConsultationTracker } from './video-consultation-tracker.service';

/**
 * Interface for video plugin data validation
 */
export interface VideoPluginData {
  operation: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  callId?: string;
  userId?: string;
  userRole?: 'patient' | 'doctor';
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
 * - Legacy video call operations
 * - Jitsi-based consultation rooms
 * - Real-time tracking and analytics
 * - HIPAA-compliant recording and data handling
 */
@Injectable()
export class ClinicVideoPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-video-plugin';
  readonly version = '1.0.0';
  readonly features = [
    'video-calls',
    'consultation-rooms',
    'recording',
    'screen-sharing',
    'medical-imaging',
    'jitsi-consultation',
    'real-time-tracking',
    'hipaa-compliance',
  ];

  /**
   * Creates an instance of ClinicVideoPlugin
   *
   * @param videoService - Service for legacy video call operations
   * @param jitsiVideoService - Service for Jitsi-based consultations
   * @param consultationTracker - Service for tracking consultation metrics
   */
  constructor(
    private readonly videoService: VideoService,
    private readonly jitsiVideoService: JitsiVideoService,
    private readonly consultationTracker: VideoConsultationTracker
  ) {
    super();
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
    this.logPluginAction('Processing clinic video operation', {
      operation: videoData.operation,
    });

    try {
      // Delegate to existing video service - no functionality change
      switch (videoData.operation) {
        case 'createVideoCall':
          return await this.videoService.createVideoCall(
            videoData.appointmentId!,
            videoData.patientId!,
            videoData.doctorId!,
            videoData.clinicId!
          );

        case 'joinVideoCall':
          return await this.videoService.joinVideoCall(videoData.callId!, videoData.userId!);

        case 'endVideoCall':
          return await this.videoService.endVideoCall(videoData.callId!, videoData.userId!);

        case 'startRecording':
          return await this.videoService.startRecording(videoData.callId!, videoData.userId!);

        case 'stopRecording':
          return await this.videoService.stopRecording(videoData.callId!, videoData.userId!);

        case 'shareMedicalImage':
          return await this.videoService.shareMedicalImage(
            videoData.callId!,
            videoData.userId!,
            videoData.imageData!
          );

        case 'getVideoCallHistory':
          return await this.videoService.getVideoCallHistory(videoData.userId!, videoData.clinicId);

        // Jitsi consultation operations
        case 'createConsultationRoom':
          return await this.jitsiVideoService.generateMeetingToken(
            videoData.appointmentId!,
            videoData.patientId!,
            'patient',
            {
              displayName: videoData.displayName?.name || 'User',
              email: '',
              // ...(videoData.avatar && { avatar: videoData.avatar }),
            }
          );

        case 'generateJoinToken':
          return await this.jitsiVideoService.generateMeetingToken(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!,
            {
              displayName: videoData.displayName?.name || 'User',
              email: '',
              // ...(videoData.avatar && { avatar: videoData.avatar }),
            }
          );

        case 'startConsultationSession':
          return await this.jitsiVideoService.startConsultation(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!
          );

        case 'endConsultationSession':
          return await this.jitsiVideoService.endConsultation(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!,
            videoData.sessionNotes
          );

        case 'getConsultationStatus':
          return await this.jitsiVideoService.getConsultationStatus(videoData.appointmentId!);

        case 'reportTechnicalIssue':
          return await this.jitsiVideoService.reportTechnicalIssue(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.issueType!,
            videoData.description! as 'other' | 'audio' | 'video' | 'connection'
          );

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
            videoData.userRole!,
            videoData.deviceInfo
          );

        case 'trackParticipantLeft':
          return await this.consultationTracker.trackParticipantLeft(
            videoData.appointmentId!,
            videoData.userId!,
            videoData.userRole!
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
          this.logPluginError('Unknown video operation', {
            operation: videoData.operation,
          });
          throw new Error(`Unknown video operation: ${videoData.operation}`);
      }
    } catch (error) {
      this.logPluginError('Failed to process video operation', {
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
  validate(data: unknown): Promise<boolean> {
    if (!this.isValidVideoData(data)) {
      return Promise.resolve(false);
    }

    const pluginData = data;
    // Validate that required fields are present for each operation
    const requiredFields = {
      // Legacy video call operations
      createVideoCall: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      joinVideoCall: ['callId', 'userId'],
      endVideoCall: ['callId', 'userId'],
      startRecording: ['callId', 'userId'],
      stopRecording: ['callId', 'userId'],
      shareMedicalImage: ['callId', 'userId', 'imageData'],
      getVideoCallHistory: ['userId'],

      // Jitsi consultation operations
      createConsultationRoom: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      generateJoinToken: ['appointmentId', 'userId', 'userRole', 'displayName'],
      startConsultationSession: ['appointmentId', 'userId', 'userRole'],
      endConsultationSession: ['appointmentId', 'userId'],
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
      this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every((field: string) => {
      const value = pluginData[field as keyof VideoPluginData];
      return value !== undefined && value !== null;
    });

    if (!isValid) {
      this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return Promise.resolve(isValid);
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
      !['patient', 'doctor'].includes(obj['userRole'] as string)
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
