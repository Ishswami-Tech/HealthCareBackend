import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { JitsiVideoService } from './jitsi-video.service';

import type { VideoCall, VideoCallSettings } from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { VideoCall, VideoCallSettings };

// VirtualFitting interface removed - healthcare application only

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly VIDEO_CACHE_TTL = 1800; // 30 minutes
  private readonly CALL_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly jitsiVideoService: JitsiVideoService
  ) {}

  async createVideoCall(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to participants
      const appointment = await this.validateAppointment(
        appointmentId,
        patientId,
        doctorId,
        clinicId
      );

      // Generate unique meeting URL
      const meetingUrl = await this.generateMeetingUrl(appointmentId);

      // Create video call record
      const videoCall: VideoCall = {
        id: `vc-${appointmentId}-${Date.now()}`,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        status: 'scheduled',
        meetingUrl,
        participants: [patientId, doctorId],
        settings: {
          maxParticipants: 2,
          recordingEnabled: true,
          screenSharingEnabled: true,
          chatEnabled: true,
          waitingRoomEnabled: true,
          autoRecord: false,
        },
      };

      // Store in database (placeholder implementation)
      await this.storeVideoCall(videoCall);

      // Cache the video call
      const cacheKey = `videocall:${videoCall.id}`;
      await this.cacheService.set(cacheKey, JSON.stringify(videoCall), this.VIDEO_CACHE_TTL);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Video call created successfully',
        'VideoService',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return videoCall;
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create video call: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async joinVideoCall(callId: string, userId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Get video call details
      const videoCall = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Update call status if first participant
      if (videoCall.status === 'scheduled') {
        videoCall.status = 'active';
        videoCall.startTime = new Date().toISOString();
        await this.updateVideoCall(videoCall);
      }

      // Generate join token
      const joinToken = await this.generateJoinToken(callId, userId);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'User joined video call successfully',
        'VideoService',
        { callId, userId, responseTime: Date.now() - startTime }
      );

      return {
        callId,
        meetingUrl: videoCall.meetingUrl,
        joinToken,
        settings: videoCall.settings,
      };
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to join video call: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async startRecording(callId: string, userId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Get video call details
      const videoCall = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Start recording (placeholder implementation)
      const recordingId = await this.initiateRecording(callId);

      // Update video call with recording info
      videoCall.recordingUrl = `https://recordings.example.com/${recordingId}`;
      await this.updateVideoCall(videoCall);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Recording started successfully',
        'VideoService',
        { callId, userId, recordingId, responseTime: Date.now() - startTime }
      );

      return {
        success: true,
        recordingId,
        recordingUrl: videoCall.recordingUrl,
        message: 'Recording started',
      };
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start recording: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async stopRecording(callId: string, userId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Get video call details
      const videoCall = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Stop recording (placeholder implementation)
      const recordingResult = await this.finalizeRecording(callId);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Recording stopped successfully',
        'VideoService',
        { callId, userId, responseTime: Date.now() - startTime }
      );

      return {
        success: true,
        recordingUrl: videoCall.recordingUrl,
        duration: (recordingResult as { duration: number }).duration,
        message: 'Recording stopped',
      };
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to stop recording: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async endVideoCall(callId: string, userId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Get video call details
      const videoCall = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // End the call
      videoCall.status = 'completed';
      videoCall.endTime = new Date().toISOString();
      if (videoCall.startTime) {
        videoCall.duration = Math.floor(
          (new Date(videoCall.endTime).getTime() - new Date(videoCall.startTime).getTime()) / 1000
        );
      }

      await this.updateVideoCall(videoCall);

      // Stop any active recording
      if (videoCall.recordingUrl) {
        await this.stopRecording(callId, userId);
      }

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Video call ended successfully',
        'VideoService',
        {
          callId,
          userId,
          duration: videoCall.duration,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        callId,
        duration: videoCall.duration,
        message: 'Video call ended',
      };
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end video call: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async shareMedicalImage(callId: string, userId: string, imageData: unknown): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Get video call details
      const videoCall = await this.getVideoCall(callId);
      if (!videoCall) {
        throw new NotFoundException('Video call not found');
      }

      // Validate user is a participant
      if (!videoCall.participants.includes(userId)) {
        throw new BadRequestException('User is not a participant in this call');
      }

      // Upload and share image (placeholder implementation)
      const imageUrl = await this.uploadMedicalImage(imageData, callId, userId);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Medical image shared successfully',
        'VideoService',
        { callId, userId, imageUrl, responseTime: Date.now() - startTime }
      );

      return {
        success: true,
        imageUrl,
        message: 'Medical image shared',
      };
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to share medical image: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          callId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // startVirtualFitting method removed - healthcare application only

  async getVideoCallHistory(userId: string, clinicId?: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `videocalls:history:${userId}:${clinicId || 'all'}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get video call history from database (placeholder implementation)
      const calls = await this.fetchVideoCallHistory(userId, clinicId);

      const result = {
        userId,
        clinicId,
        calls,
        total: calls.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.VIDEO_CACHE_TTL);

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Video call history retrieved successfully',
        'VideoService',
        {
          userId,
          clinicId,
          count: calls.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get video call history: ${_error instanceof Error ? _error.message : String(_error)}`,
        'VideoService',
        {
          userId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // getVirtualFittingHistory method removed - healthcare application only

  // Helper methods (placeholder implementations that would integrate with actual services)
  private async validateAppointment(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string
  ): Promise<unknown> {
    // This would integrate with the actual appointment service
    // For now, return mock data
    return {
      id: appointmentId,
      patientId,
      doctorId,
      clinicId,
      status: 'CONFIRMED',
    };
  }

  // validateFashionAppointment method removed - healthcare application only

  private async generateMeetingUrl(appointmentId: string): Promise<string> {
    // This would integrate with actual video service (Zoom, Teams, etc.)
    // For now, return mock URL
    return `https://meet.example.com/${appointmentId}-${Date.now()}`;
  }

  private async generateJoinToken(callId: string, userId: string): Promise<string> {
    // This would integrate with actual video service
    // For now, return mock token
    return `token-${callId}-${userId}-${Date.now()}`;
  }

  private async storeVideoCall(videoCall: VideoCall): Promise<void> {
    // This would integrate with the actual database
    // For now, just log
    this.logger.log(`Stored video call: ${videoCall.id}`);
  }

  private async getVideoCall(callId: string): Promise<VideoCall | null> {
    // Try cache first
    const cacheKey = `videocall:${callId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached as string);
    }

    // This would integrate with the actual database
    // For now, return mock data
    return {
      id: callId,
      appointmentId: 'app-1',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      clinicId: 'clinic-1',
      status: 'scheduled',
      meetingUrl: 'https://meet.example.com/test',
      participants: ['patient-1', 'doctor-1'],
      settings: {
        maxParticipants: 2,
        recordingEnabled: true,
        screenSharingEnabled: true,
        chatEnabled: true,
        waitingRoomEnabled: true,
        autoRecord: false,
      },
    };
  }

  private async updateVideoCall(videoCall: VideoCall): Promise<void> {
    // Update cache
    const cacheKey = `videocall:${videoCall.id}`;
    await this.cacheService.set(cacheKey, JSON.stringify(videoCall), this.VIDEO_CACHE_TTL);

    // This would integrate with the actual database
    // For now, just log
    this.logger.log(`Updated video call: ${videoCall.id}`);
  }

  private async initiateRecording(callId: string): Promise<string> {
    // This would integrate with actual video service
    // For now, return mock recording ID
    return `rec-${callId}-${Date.now()}`;
  }

  private async finalizeRecording(callId: string): Promise<unknown> {
    // This would integrate with actual video service
    // For now, return mock result
    return {
      duration: 1800, // 30 minutes
      url: `https://recordings.example.com/${callId}`,
    };
  }

  private async uploadMedicalImage(
    imageData: unknown,
    callId: string,
    userId: string
  ): Promise<string> {
    // This would integrate with actual file storage service
    // For now, return mock URL
    return `https://images.example.com/medical/${callId}/${userId}/${Date.now()}.jpg`;
  }

  // storeVirtualFitting method removed - healthcare application only

  private async fetchVideoCallHistory(userId: string, clinicId?: string): Promise<VideoCall[]> {
    // This would integrate with the actual database
    // For now, return mock data
    return [
      {
        id: 'vc-1',
        appointmentId: 'app-1',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        clinicId: 'clinic-1',
        status: 'completed',
        startTime: new Date(Date.now() - 3600000).toISOString(),
        endTime: new Date().toISOString(),
        duration: 3600,
        meetingUrl: 'https://meet.example.com/test',
        participants: ['patient-1', 'doctor-1'],
        settings: {
          maxParticipants: 2,
          recordingEnabled: true,
          screenSharingEnabled: true,
          chatEnabled: true,
          waitingRoomEnabled: true,
          autoRecord: false,
        },
      },
    ];
  }
}
