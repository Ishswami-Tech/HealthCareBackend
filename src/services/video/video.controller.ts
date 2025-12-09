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
import { VideoService } from './video.service';
import {
  VideoTokenResponseDto,
  VideoConsultationSessionDto,
  EndVideoConsultationDto,
  ShareMedicalImageDto,
  VideoCallHistoryQueryDto,
  VideoCallResponseDto,
  DataResponseDto,
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoTokenResponseDto> {
    try {
      const tokenResponse = await this.videoService.generateMeetingToken(
        body.appointmentId,
        body.userId,
        body.userRole,
        {
          displayName: body.displayName,
          email: body.email || '',
          avatar: body.avatar,
        }
      );

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

      // Map to DTO
      const tokenDto = new VideoTokenResponseDto();
      tokenDto.token = tokenResponse.token;
      tokenDto.roomName = tokenResponse.roomName;
      tokenDto.roomId = tokenResponse.roomId;
      tokenDto.meetingUrl = tokenResponse.meetingUrl;
      tokenDto.roomPassword = tokenResponse.roomPassword;
      tokenDto.meetingPassword = tokenResponse.meetingPassword;
      tokenDto.encryptionKey = tokenResponse.encryptionKey;
      tokenDto.expiresAt = tokenResponse.expiresAt;

      return tokenDto;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate video token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoController.generateToken',
        {
          appointmentId: body.appointmentId,
          userId: body.userId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const session = await this.videoService.startConsultation(
        body.appointmentId,
        body.userId,
        body.userRole
      );

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
          sessionId: session.id,
          userId: body.userId,
          userRole: body.userRole,
          provider: this.videoService.getCurrentProvider(),
        },
      });

      // Map to DTO
      const sessionDto = new VideoConsultationSessionDto();
      sessionDto.id = session.id;
      sessionDto.appointmentId = session.appointmentId;
      sessionDto.roomId = session.roomId;
      sessionDto.roomName = session.roomName;
      sessionDto.meetingUrl = session.meetingUrl;
      sessionDto.status = session.status;
      sessionDto.startTime = session.startTime;
      sessionDto.endTime = session.endTime;
      sessionDto.participants = session.participants;
      sessionDto.recordingEnabled = session.recordingEnabled;
      sessionDto.screenSharingEnabled = session.screenSharingEnabled;
      sessionDto.chatEnabled = session.chatEnabled;
      sessionDto.waitingRoomEnabled = session.waitingRoomEnabled;

      return sessionDto;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoController.startConsultation',
        {
          appointmentId: body.appointmentId,
          userId: body.userId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const session = await this.videoService.endConsultation(
        body.appointmentId,
        body.userId,
        body.userRole,
        body.meetingNotes
      );

      // Calculate duration
      const duration =
        session.startTime && session.endTime
          ? Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 1000)
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
          sessionId: session.id,
          duration,
          recordingUrl: undefined, // Would be populated from session if available
        },
      });

      // Map to DTO
      const sessionDto = new VideoConsultationSessionDto();
      sessionDto.id = session.id;
      sessionDto.appointmentId = session.appointmentId;
      sessionDto.roomId = session.roomId;
      sessionDto.roomName = session.roomName;
      sessionDto.meetingUrl = session.meetingUrl;
      sessionDto.status = session.status;
      sessionDto.startTime = session.startTime;
      sessionDto.endTime = session.endTime;
      sessionDto.participants = session.participants;
      sessionDto.recordingEnabled = session.recordingEnabled;
      sessionDto.screenSharingEnabled = session.screenSharingEnabled;
      sessionDto.chatEnabled = session.chatEnabled;
      sessionDto.waitingRoomEnabled = session.waitingRoomEnabled;

      return sessionDto;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end consultation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoController.endConsultation',
        {
          appointmentId: body.appointmentId,
          userId: body.userId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const session = await this.videoService.getConsultationSession(appointmentId);

      if (!session) {
        throw new NotFoundException('Video consultation session not found');
      }

      // Map to DTO
      const sessionDto = new VideoConsultationSessionDto();
      sessionDto.id = session.id;
      sessionDto.appointmentId = session.appointmentId;
      sessionDto.roomId = session.roomId;
      sessionDto.roomName = session.roomName;
      sessionDto.meetingUrl = session.meetingUrl;
      sessionDto.status = session.status;
      sessionDto.startTime = session.startTime;
      sessionDto.endTime = session.endTime;
      sessionDto.participants = session.participants;
      sessionDto.recordingEnabled = session.recordingEnabled;
      sessionDto.screenSharingEnabled = session.screenSharingEnabled;
      sessionDto.chatEnabled = session.chatEnabled;
      sessionDto.waitingRoomEnabled = session.waitingRoomEnabled;

      return sessionDto;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get consultation status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoController.getConsultationStatus',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to report technical issue: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoController.reportTechnicalIssue',
        {
          appointmentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
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
    type: VideoCallResponseDto,
  })
  async getVideoCallHistory(
    @Query() query: VideoCallHistoryQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoCallResponseDto> {
    try {
      const userId = query.userId || (req.user?.sub as string);
      const clinicId = query.clinicId || req.clinicContext?.clinicId;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      const history = await this.videoService.getVideoCallHistory(userId, clinicId);

      // Map to DTO
      const responseDto = new VideoCallResponseDto();
      responseDto.userId = history.data.userId;
      responseDto.clinicId = history.data.clinicId;
      responseDto.calls = history.data.calls;
      responseDto.total = history.data.total;
      responseDto.retrievedAt = history.data.retrievedAt;

      return responseDto;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get video call history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoController.getVideoCallHistory',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
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

