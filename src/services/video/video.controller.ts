/**
 * Video Controller
 * @class VideoController
 * @description REST API endpoints for video consultation services
 * Standalone service that can be used by appointments and other services
 * Microservice-ready design
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ClinicRoute } from '@core/decorators/clinic-route.decorator';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import type { VideoTokenResponse, VideoConsultationSession } from '@core/types/video.types';
import { VideoService } from './video.service';
import {
  VideoTokenResponseDto,
  VideoConsultationSessionDto,
  EndVideoConsultationDto,
  VideoCallHistoryQueryDto,
  SuccessResponseDto,
} from '@dtos';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { EventService } from '@infrastructure/events';
import { EventCategory, EventPriority } from '@core/types';

@Controller('video')
@ApiTags('video')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
@ApiBearerAuth()
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService
  ) {}

  private isVideoTokenResponse(value: unknown): value is VideoTokenResponse {
    return (
      typeof value === 'object' &&
      value !== null &&
      'token' in value &&
      typeof (value as { token: unknown }).token === 'string' &&
      'roomName' in value &&
      typeof (value as { roomName: unknown }).roomName === 'string' &&
      'roomId' in value &&
      typeof (value as { roomId: unknown }).roomId === 'string' &&
      'meetingUrl' in value &&
      typeof (value as { meetingUrl: unknown }).meetingUrl === 'string'
    );
  }

  private extractVideoTokenResponse(value: unknown): VideoTokenResponse {
    if (!this.isVideoTokenResponse(value)) {
      throw new Error('Invalid VideoTokenResponse');
    }
    const tokenValue: string = value.token;
    const roomNameValue: string = value.roomName;
    const roomIdValue: string = value.roomId;
    const meetingUrlValue: string = value.meetingUrl;
    const roomPasswordValue: string | undefined = value.roomPassword;
    const meetingPasswordValue: string | undefined = value.meetingPassword;
    const encryptionKeyValue: string | undefined = value.encryptionKey;
    const expiresAtValue: Date | undefined = value.expiresAt;
    const response: VideoTokenResponse = {
      token: tokenValue,
      roomName: roomNameValue,
      roomId: roomIdValue,
      meetingUrl: meetingUrlValue,
    };
    if (roomPasswordValue !== undefined) {
      response.roomPassword = roomPasswordValue;
    }
    if (meetingPasswordValue !== undefined) {
      response.meetingPassword = meetingPasswordValue;
    }
    if (encryptionKeyValue !== undefined) {
      response.encryptionKey = encryptionKeyValue;
    }
    if (expiresAtValue !== undefined) {
      response.expiresAt = expiresAtValue;
    }
    return response;
  }

  private isVideoConsultationSession(value: unknown): value is VideoConsultationSession {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof (value as { id: unknown }).id === 'string' &&
      'appointmentId' in value &&
      typeof (value as { appointmentId: unknown }).appointmentId === 'string' &&
      'roomId' in value &&
      typeof (value as { roomId: unknown }).roomId === 'string' &&
      'roomName' in value &&
      typeof (value as { roomName: unknown }).roomName === 'string' &&
      'meetingUrl' in value &&
      typeof (value as { meetingUrl: unknown }).meetingUrl === 'string' &&
      'status' in value &&
      'startTime' in value &&
      'endTime' in value &&
      'participants' in value &&
      Array.isArray((value as { participants: unknown }).participants) &&
      'recordingEnabled' in value &&
      typeof (value as { recordingEnabled: unknown }).recordingEnabled === 'boolean' &&
      'screenSharingEnabled' in value &&
      typeof (value as { screenSharingEnabled: unknown }).screenSharingEnabled === 'boolean' &&
      'chatEnabled' in value &&
      typeof (value as { chatEnabled: unknown }).chatEnabled === 'boolean' &&
      'waitingRoomEnabled' in value &&
      typeof (value as { waitingRoomEnabled: unknown }).waitingRoomEnabled === 'boolean'
    );
  }

  private extractVideoConsultationSession(value: unknown): VideoConsultationSession {
    if (!this.isVideoConsultationSession(value)) {
      throw new Error('Invalid VideoConsultationSession');
    }
    const idValue: string = value.id;
    const appointmentIdValue: string = value.appointmentId;
    const roomIdValue: string = value.roomId;
    const roomNameValue: string = value.roomName;
    const meetingUrlValue: string = value.meetingUrl;
    const statusValue = value.status;
    const startTimeValue = value.startTime;
    const endTimeValue = value.endTime;
    const participantsValue = value.participants;
    const recordingEnabledValue: boolean = value.recordingEnabled;
    const screenSharingEnabledValue: boolean = value.screenSharingEnabled;
    const chatEnabledValue: boolean = value.chatEnabled;
    const waitingRoomEnabledValue: boolean = value.waitingRoomEnabled;
    return {
      id: idValue,
      appointmentId: appointmentIdValue,
      roomId: roomIdValue,
      roomName: roomNameValue,
      meetingUrl: meetingUrlValue,
      status: statusValue,
      startTime: startTimeValue,
      endTime: endTimeValue,
      participants: participantsValue,
      recordingEnabled: recordingEnabledValue,
      screenSharingEnabled: screenSharingEnabledValue,
      chatEnabled: chatEnabledValue,
      waitingRoomEnabled: waitingRoomEnabledValue,
    };
  }

  private extractVideoConsultationSessionOrNull(value: unknown): VideoConsultationSession | null {
    if (value === null) {
      return null;
    }
    if (this.isVideoConsultationSession(value)) {
      return this.extractVideoConsultationSession(value);
    }
    return null;
  }

  private createVideoTokenResponseDto(
    token: string,
    roomName: string,
    roomId: string,
    meetingUrl: string,
    roomPassword: string | undefined,
    meetingPassword: string | undefined,
    encryptionKey: string | undefined,
    expiresAt: Date | undefined
  ): VideoTokenResponseDto {
    const VideoTokenResponseDtoConstructor = VideoTokenResponseDto;
    const dtoInstance: unknown = new VideoTokenResponseDtoConstructor();
    if (
      typeof dtoInstance !== 'object' ||
      dtoInstance === null ||
      !('token' in dtoInstance) ||
      !('roomName' in dtoInstance) ||
      !('roomId' in dtoInstance) ||
      !('meetingUrl' in dtoInstance)
    ) {
      throw new Error('Failed to create VideoTokenResponseDto');
    }
    const dto = dtoInstance as VideoTokenResponseDto;
    const dtoToken: string = token;
    const dtoRoomName: string = roomName;
    const dtoRoomId: string = roomId;
    const dtoMeetingUrl: string = meetingUrl;
    dto.token = dtoToken;
    dto.roomName = dtoRoomName;
    dto.roomId = dtoRoomId;
    dto.meetingUrl = dtoMeetingUrl;
    if (roomPassword !== undefined) {
      const dtoRoomPassword: string = roomPassword;
      dto.roomPassword = dtoRoomPassword;
    }
    if (meetingPassword !== undefined) {
      const dtoMeetingPassword: string = meetingPassword;
      dto.meetingPassword = dtoMeetingPassword;
    }
    if (encryptionKey !== undefined) {
      const dtoEncryptionKey: string = encryptionKey;
      dto.encryptionKey = dtoEncryptionKey;
    }
    if (expiresAt !== undefined) {
      const dtoExpiresAt: Date = expiresAt;
      dto.expiresAt = dtoExpiresAt;
    }
    return dto;
  }

  private createVideoConsultationSessionDto(
    id: string,
    appointmentId: string,
    roomId: string,
    roomName: string,
    meetingUrl: string,
    status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED',
    startTime: Date | null,
    endTime: Date | null,
    participants: Array<{
      userId: string;
      role: 'HOST' | 'PARTICIPANT';
      joinedAt: Date | null;
    }>,
    recordingEnabled: boolean,
    screenSharingEnabled: boolean,
    chatEnabled: boolean,
    waitingRoomEnabled: boolean
  ): VideoConsultationSessionDto {
    const VideoConsultationSessionDtoConstructor = VideoConsultationSessionDto;
    const dtoInstance: unknown = new VideoConsultationSessionDtoConstructor();
    if (
      typeof dtoInstance !== 'object' ||
      dtoInstance === null ||
      !('id' in dtoInstance) ||
      !('appointmentId' in dtoInstance) ||
      !('roomId' in dtoInstance) ||
      !('roomName' in dtoInstance) ||
      !('meetingUrl' in dtoInstance)
    ) {
      throw new Error('Failed to create VideoConsultationSessionDto');
    }
    const dto = dtoInstance as VideoConsultationSessionDto;
    const dtoId: string = id;
    const dtoAppointmentId: string = appointmentId;
    const dtoRoomId: string = roomId;
    const dtoRoomName: string = roomName;
    const dtoMeetingUrl: string = meetingUrl;
    dto.id = dtoId;
    dto.appointmentId = dtoAppointmentId;
    dto.roomId = dtoRoomId;
    dto.roomName = dtoRoomName;
    dto.meetingUrl = dtoMeetingUrl;
    dto.status = status;
    dto.startTime = startTime;
    dto.endTime = endTime;
    dto.participants = participants;
    dto.recordingEnabled = recordingEnabled;
    dto.screenSharingEnabled = screenSharingEnabled;
    dto.chatEnabled = chatEnabled;
    dto.waitingRoomEnabled = waitingRoomEnabled;
    return dto;
  }

  /**
   * Generate video meeting token
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Generate video meeting token',
    description: 'Generate a secure token for joining a video consultation.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['appointmentId', 'userId', 'userRole', 'displayName'],
      properties: {
        appointmentId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the appointment',
        },
        userId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the user requesting the token',
        },
        userRole: {
          type: 'string',
          enum: ['patient', 'doctor'],
          description: 'Role of the user in the consultation',
        },
        displayName: {
          type: 'string',
          description: 'Display name of the user',
        },
        email: {
          type: 'string',
          format: 'email',
          description: 'Email of the user (optional)',
        },
        avatar: {
          type: 'string',
          description: 'Avatar URL of the user (optional)',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Token generated successfully',
    type: VideoTokenResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request',
  })
  async generateToken(
    @Body()
    body: {
      appointmentId: string;
      userId: string;
      userRole: 'patient' | 'doctor';
      displayName: string;
      email?: string;
      avatar?: string;
    },
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<VideoTokenResponseDto> {
    try {
      const tokenResponseResult: unknown = await this.videoService.generateMeetingToken(
        body.appointmentId,
        body.userId,
        body.userRole,
        {
          displayName: body.displayName,
          email: body.email || '',
          ...(body.avatar && { avatar: body.avatar }),
        }
      );
      if (!this.isVideoTokenResponse(tokenResponseResult)) {
        throw new Error('Invalid token response from video service');
      }
      const tokenResponse: VideoTokenResponse = tokenResponseResult;
      const responseToken: string = tokenResponse.token;
      const responseRoomName: string = tokenResponse.roomName;
      const responseRoomId: string = tokenResponse.roomId;
      const responseMeetingUrl: string = tokenResponse.meetingUrl;
      const responseRoomPassword: string | undefined = tokenResponse.roomPassword;
      const responseMeetingPassword: string | undefined = tokenResponse.meetingPassword;
      const responseEncryptionKey: string | undefined = tokenResponse.encryptionKey;
      const responseExpiresAt: Date | undefined = tokenResponse.expiresAt;

      // Emit event
      await this.eventService.emitEnterprise('video.token.generated', {
        eventId: `video-token-${body.appointmentId}-${Date.now()}`,
        eventType: 'video.token.generated',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoController',
        version: '1.0.0',
        payload: {
          appointmentId: body.appointmentId,
          userId: body.userId,
          provider: this.videoService.getCurrentProvider(),
        },
      });

      // Map to DTO - all values already extracted above
      const tokenDto = this.createVideoTokenResponseDto(
        responseToken,
        responseRoomName,
        responseRoomId,
        responseMeetingUrl,
        responseRoomPassword,
        responseMeetingPassword,
        responseEncryptionKey,
        responseExpiresAt
      );

      return tokenDto;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate video token: ${errorMessage}`,
        'VideoController.generateToken',
        {
          appointmentId: body.appointmentId,
          userId: body.userId,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * Start video consultation
   */
  @Post('consultation/start')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('video', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'Start video consultation',
    description: 'Start a video consultation session.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['appointmentId', 'userId', 'userRole'],
      properties: {
        appointmentId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the appointment',
        },
        userId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the user starting the consultation',
        },
        userRole: {
          type: 'string',
          enum: ['patient', 'doctor'],
          description: 'Role of the user',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consultation started successfully',
    type: VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  async startConsultation(
    @Body()
    body: {
      appointmentId: string;
      userId: string;
      userRole: 'patient' | 'doctor';
    },
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const sessionResult: unknown = await this.videoService.startConsultation(
        body.appointmentId,
        body.userId,
        body.userRole
      );
      if (!this.isVideoConsultationSession(sessionResult)) {
        throw new Error('Invalid session response from video service');
      }
      const session: VideoConsultationSession = sessionResult;
      const sessionId: string = session.id;
      const sessionAppointmentId: string = session.appointmentId;
      const sessionRoomId: string = session.roomId;
      const sessionRoomName: string = session.roomName;
      const sessionMeetingUrl: string = session.meetingUrl;
      const sessionStatus = session.status;
      const sessionStartTime = session.startTime;
      const sessionEndTime = session.endTime;
      const sessionParticipants = session.participants;
      const sessionRecordingEnabled: boolean = session.recordingEnabled;
      const sessionScreenSharingEnabled: boolean = session.screenSharingEnabled;
      const sessionChatEnabled: boolean = session.chatEnabled;
      const sessionWaitingRoomEnabled: boolean = session.waitingRoomEnabled;

      // Emit event
      await this.eventService.emitEnterprise('video.consultation.started', {
        eventId: `video-consultation-started-${body.appointmentId}-${Date.now()}`,
        eventType: 'video.consultation.started',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoController',
        version: '1.0.0',
        payload: {
          appointmentId: body.appointmentId,
          sessionId,
          userId: body.userId,
          userRole: body.userRole,
          provider: this.videoService.getCurrentProvider(),
        },
      });

      // Map to DTO - all values already extracted above
      const sessionDto = this.createVideoConsultationSessionDto(
        sessionId,
        sessionAppointmentId,
        sessionRoomId,
        sessionRoomName,
        sessionMeetingUrl,
        sessionStatus,
        sessionStartTime,
        sessionEndTime,
        sessionParticipants,
        sessionRecordingEnabled,
        sessionScreenSharingEnabled,
        sessionChatEnabled,
        sessionWaitingRoomEnabled
      );

      return sessionDto;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${errorMessage}`,
        'VideoController.startConsultation',
        {
          appointmentId: body.appointmentId,
          userId: body.userId,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * End video consultation
   */
  @Post('consultation/end')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('video', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'End video consultation',
    description: 'End a video consultation session.',
  })
  @ApiBody({
    type: EndVideoConsultationDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consultation ended successfully',
    type: VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Consultation session not found',
  })
  async endConsultation(
    @Body()
    body: {
      appointmentId: string;
      userId: string;
      userRole: 'patient' | 'doctor';
      meetingNotes?: string;
    },
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const sessionResult: unknown = await this.videoService.endConsultation(
        body.appointmentId,
        body.userId,
        body.userRole,
        body.meetingNotes
      );
      if (!this.isVideoConsultationSession(sessionResult)) {
        throw new Error('Invalid session response from video service');
      }
      const session: VideoConsultationSession = sessionResult;
      const sessionId: string = session.id;
      const sessionAppointmentId: string = session.appointmentId;
      const sessionRoomId: string = session.roomId;
      const sessionRoomName: string = session.roomName;
      const sessionMeetingUrl: string = session.meetingUrl;
      const sessionStatus = session.status;
      const sessionStartTime = session.startTime;
      const sessionEndTime = session.endTime;
      const sessionParticipants = session.participants;
      const sessionRecordingEnabled: boolean = session.recordingEnabled;
      const sessionScreenSharingEnabled: boolean = session.screenSharingEnabled;
      const sessionChatEnabled: boolean = session.chatEnabled;
      const sessionWaitingRoomEnabled: boolean = session.waitingRoomEnabled;

      // Calculate duration - all values already extracted above
      const duration =
        sessionStartTime && sessionEndTime
          ? Math.floor((sessionEndTime.getTime() - sessionStartTime.getTime()) / 1000)
          : undefined;

      // Emit event
      await this.eventService.emitEnterprise('video.consultation.ended', {
        eventId: `video-consultation-ended-${body.appointmentId}-${Date.now()}`,
        eventType: 'video.consultation.ended',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoController',
        version: '1.0.0',
        payload: {
          appointmentId: body.appointmentId,
          sessionId,
          duration,
          recordingUrl: undefined, // Would be populated from session if available
        },
      });

      // Map to DTO - all values already extracted above
      const sessionDto = this.createVideoConsultationSessionDto(
        sessionId,
        sessionAppointmentId,
        sessionRoomId,
        sessionRoomName,
        sessionMeetingUrl,
        sessionStatus,
        sessionStartTime,
        sessionEndTime,
        sessionParticipants,
        sessionRecordingEnabled,
        sessionScreenSharingEnabled,
        sessionChatEnabled,
        sessionWaitingRoomEnabled
      );

      return sessionDto;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end consultation: ${errorMessage}`,
        'VideoController.endConsultation',
        {
          appointmentId: body.appointmentId,
          userId: body.userId,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * Get consultation status
   */
  @Get('consultation/:appointmentId/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('video', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Get video consultation status',
    description: 'Get the current status of a video consultation session.',
  })
  @ApiParam({
    name: 'appointmentId',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consultation status retrieved successfully',
    type: VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Consultation session not found',
  })
  async getConsultationStatus(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const sessionResult: unknown = await this.videoService.getConsultationSession(appointmentId);
      if (sessionResult === null) {
        throw new NotFoundException('Video consultation session not found');
      }
      if (!this.isVideoConsultationSession(sessionResult)) {
        throw new NotFoundException('Invalid session response from video service');
      }
      const session: VideoConsultationSession = sessionResult;
      const sessionId: string = session.id;
      const sessionAppointmentId: string = session.appointmentId;
      const sessionRoomId: string = session.roomId;
      const sessionRoomName: string = session.roomName;
      const sessionMeetingUrl: string = session.meetingUrl;
      const sessionStatus = session.status;
      const sessionStartTime = session.startTime;
      const sessionEndTime = session.endTime;
      const sessionParticipants = session.participants;
      const sessionRecordingEnabled: boolean = session.recordingEnabled;
      const sessionScreenSharingEnabled: boolean = session.screenSharingEnabled;
      const sessionChatEnabled: boolean = session.chatEnabled;
      const sessionWaitingRoomEnabled: boolean = session.waitingRoomEnabled;

      // Map to DTO - all values already extracted above
      const sessionDto = this.createVideoConsultationSessionDto(
        sessionId,
        sessionAppointmentId,
        sessionRoomId,
        sessionRoomName,
        sessionMeetingUrl,
        sessionStatus,
        sessionStartTime,
        sessionEndTime,
        sessionParticipants,
        sessionRecordingEnabled,
        sessionScreenSharingEnabled,
        sessionChatEnabled,
        sessionWaitingRoomEnabled
      );

      return sessionDto;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get consultation status: ${errorMessage}`,
        'VideoController.getConsultationStatus',
        {
          appointmentId,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * Report technical issue
   */
  @Post('consultation/:appointmentId/report')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('video', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'Report technical issue',
    description: 'Report a technical issue during a video consultation.',
  })
  @ApiParam({
    name: 'appointmentId',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['issueType', 'description'],
      properties: {
        issueType: {
          type: 'string',
          enum: ['audio', 'video', 'connection', 'other'],
          description: 'Type of technical issue',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the issue',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Technical issue reported successfully',
    type: SuccessResponseDto,
  })
  async reportTechnicalIssue(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body()
    body: {
      issueType: 'audio' | 'video' | 'connection' | 'other';
      description: string;
    },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('User ID required');
      }

      await this.videoService.reportTechnicalIssue(
        appointmentId,
        userId,
        body.description,
        body.issueType
      );

      // Emit event
      await this.eventService.emitEnterprise('video.technical.issue.reported', {
        eventId: `video-issue-${appointmentId}-${Date.now()}`,
        eventType: 'video.technical.issue.reported',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoController',
        version: '1.0.0',
        payload: {
          appointmentId,
          userId,
          issueType: body.issueType,
          description: body.description,
        },
      });

      return new SuccessResponseDto('Technical issue reported successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to report technical issue: ${errorMessage}`,
        'VideoController.reportTechnicalIssue',
        {
          appointmentId,
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * Get video call history
   */
  @Get('history')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get video call history',
    description: 'Get video call history for a user.',
  })
  @ApiQuery({
    name: 'userId',
    description: 'ID of the user',
    type: 'string',
    format: 'uuid',
    required: false,
  })
  @ApiQuery({
    name: 'clinicId',
    description: 'ID of the clinic',
    type: 'string',
    format: 'uuid',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Video call history retrieved successfully',
    // Note: Using object type as VideoCallResponseDto doesn't match history structure
  })
  async getVideoCallHistory(
    @Query() query: VideoCallHistoryQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{
    userId: string;
    clinicId?: string;
    calls: unknown[];
    total: number;
    retrievedAt: string;
  }> {
    try {
      const queryValue: unknown = query;
      const queryUserIdValue: string | undefined =
        typeof queryValue === 'object' &&
        queryValue !== null &&
        'userId' in queryValue &&
        (typeof (queryValue as { userId: unknown }).userId === 'string' ||
          (queryValue as { userId: unknown }).userId === undefined)
          ? (queryValue as { userId: string | undefined }).userId
          : undefined;
      const reqUserValue: unknown = req.user;
      const reqUserSubValue: unknown =
        typeof reqUserValue === 'object' &&
        reqUserValue !== null &&
        'sub' in reqUserValue &&
        typeof (reqUserValue as { sub: unknown }).sub === 'string'
          ? (reqUserValue as { sub: string }).sub
          : undefined;
      const userId: string =
        queryUserIdValue || (typeof reqUserSubValue === 'string' ? reqUserSubValue : '');
      const queryClinicIdValue: string | undefined =
        typeof queryValue === 'object' &&
        queryValue !== null &&
        'clinicId' in queryValue &&
        (typeof (queryValue as { clinicId: unknown }).clinicId === 'string' ||
          (queryValue as { clinicId: unknown }).clinicId === undefined)
          ? (queryValue as { clinicId: string | undefined }).clinicId
          : undefined;
      const reqClinicContextValue: unknown = req.clinicContext;
      const reqClinicContextClinicIdValue: unknown =
        typeof reqClinicContextValue === 'object' &&
        reqClinicContextValue !== null &&
        'clinicId' in reqClinicContextValue &&
        (typeof (reqClinicContextValue as { clinicId: unknown }).clinicId === 'string' ||
          (reqClinicContextValue as { clinicId: unknown }).clinicId === undefined)
          ? (reqClinicContextValue as { clinicId: string | undefined }).clinicId
          : undefined;
      const clinicId: string | undefined =
        queryClinicIdValue ||
        (typeof reqClinicContextClinicIdValue === 'string'
          ? reqClinicContextClinicIdValue
          : undefined);

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      const historyResult: unknown = await this.videoService.getVideoCallHistory(userId, clinicId);
      if (
        typeof historyResult !== 'object' ||
        historyResult === null ||
        !('data' in historyResult)
      ) {
        throw new BadRequestException('Invalid history response from video service');
      }
      const history = historyResult as { data: unknown };
      if (!history.data) {
        throw new BadRequestException('No history data available');
      }

      // Return history data structure (different from VideoCallResponseDto)
      // Extract data immediately to avoid unsafe access
      const historyDataResult: unknown = history.data;
      if (
        !historyDataResult ||
        typeof historyDataResult !== 'object' ||
        !('userId' in historyDataResult) ||
        typeof (historyDataResult as { userId: unknown }).userId !== 'string' ||
        !('calls' in historyDataResult) ||
        !Array.isArray((historyDataResult as { calls: unknown }).calls) ||
        !('total' in historyDataResult) ||
        typeof (historyDataResult as { total: unknown }).total !== 'number' ||
        !('retrievedAt' in historyDataResult) ||
        typeof (historyDataResult as { retrievedAt: unknown }).retrievedAt !== 'string'
      ) {
        throw new BadRequestException('No history data available');
      }
      const validatedHistoryData = historyDataResult as {
        userId: string;
        clinicId?: string;
        calls: unknown[];
        total: number;
        retrievedAt: string;
      };
      const dataUserId: string = validatedHistoryData.userId;
      const dataCalls: unknown[] = validatedHistoryData.calls;
      const dataTotal: number = validatedHistoryData.total;
      const dataRetrievedAt: string = validatedHistoryData.retrievedAt;
      const dataClinicId: string | undefined = validatedHistoryData.clinicId;
      const result: {
        userId: string;
        clinicId?: string;
        calls: unknown[];
        total: number;
        retrievedAt: string;
      } = {
        userId: dataUserId,
        calls: dataCalls,
        total: dataTotal,
        retrievedAt: dataRetrievedAt,
      };

      if (dataClinicId !== undefined && dataClinicId !== null) {
        result.clinicId = dataClinicId;
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get video call history: ${errorMessage}`,
        'VideoController.getVideoCallHistory',
        {
          error: errorMessage,
        }
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Video service health check',
    description: 'Check the health status of the video service and providers.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        primaryProvider: { type: 'string', example: 'openvidu' },
        fallbackProvider: { type: 'string', example: 'jitsi' },
        isHealthy: { type: 'boolean', example: true },
      },
    },
  })
  async healthCheck(): Promise<{
    status: string;
    primaryProvider: string;
    fallbackProvider: string;
    isHealthy: boolean;
  }> {
    const isHealthy = await this.videoService.isHealthy();
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      primaryProvider: this.videoService.getCurrentProvider(),
      fallbackProvider: this.videoService.getFallbackProvider(),
      isHealthy,
    };
  }
}
