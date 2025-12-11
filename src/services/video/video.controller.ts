/**
 * Video Controller
 * @class VideoController
 * @description REST API endpoints for video consultation services
 * Standalone service that can be used by appointments and other services
 * Microservice-ready design
 */

// 1. External imports (NestJS, npm packages)
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  HttpCode,
  HttpStatus,
  Request,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

// 2. Internal imports - Infrastructure layer
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';

// 3. Internal imports - Core layer
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ClinicRoute } from '@core/decorators/clinic-route.decorator';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { HealthcareErrorsService, HealthcareError } from '@core/errors';
import { EventCategory, EventPriority } from '@core/types';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import type { VideoTokenResponse, VideoConsultationSession } from '@core/types/video.types';

// 4. Internal imports - Configuration
import { ValidationPipeConfig } from '@config/validation-pipe.config';

// 5. Internal imports - DTOs
import {
  VideoTokenResponseDto,
  VideoConsultationSessionDto,
  EndVideoConsultationDto,
  VideoCallHistoryQueryDto,
  VideoCallHistoryResponseDto,
  VideoCallResponseDto,
  GenerateVideoTokenDto,
  StartVideoConsultationDto,
  ReportTechnicalIssueDto,
  ShareMedicalImageDto,
  ShareMedicalImageResponseDto,
  SuccessResponseDto,
  StartRecordingDto,
  StopRecordingDto,
  ManageParticipantDto,
  RecordingResponseDto,
  RecordingListResponseDto,
  ParticipantListResponseDto,
  SessionAnalyticsResponseDto,
} from '@dtos';

// 6. Local imports (same directory)
import { VideoService } from './video.service';
// Central health indicators from HealthModule
import {
  DatabaseHealthIndicator,
  CacheHealthIndicator,
  CommunicationHealthIndicator,
  VideoHealthIndicator,
} from '@services/health/health-indicators';

@Controller('video')
@ApiTags('video')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
@UsePipes(new ValidationPipe(ValidationPipeConfig.getOptions()))
@ApiBearerAuth()
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly errors: HealthcareErrorsService,
    private readonly health: HealthCheckService,
    private readonly videoHealthIndicator: VideoHealthIndicator,
    private readonly communicationHealthIndicator: CommunicationHealthIndicator,
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
    private readonly cacheHealthIndicator: CacheHealthIndicator
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
      throw this.errors.internalServerError('VideoController.extractVideoTokenResponse');
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
      throw this.errors.internalServerError('VideoController.extractVideoConsultationSession');
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
    const dtoData: {
      token: string;
      roomName: string;
      roomId: string;
      meetingUrl: string;
      roomPassword?: string;
      meetingPassword?: string;
      encryptionKey?: string;
      expiresAt?: Date;
    } = {
      token,
      roomName,
      roomId,
      meetingUrl,
    };
    if (roomPassword !== undefined) {
      dtoData.roomPassword = roomPassword;
    }
    if (meetingPassword !== undefined) {
      dtoData.meetingPassword = meetingPassword;
    }
    if (encryptionKey !== undefined) {
      dtoData.encryptionKey = encryptionKey;
    }
    if (expiresAt !== undefined) {
      dtoData.expiresAt = expiresAt;
    }
    const VideoTokenResponseDtoClassRef: typeof VideoTokenResponseDto = VideoTokenResponseDto;
    const dtoInstanceRawUnknownValue: unknown = new VideoTokenResponseDtoClassRef();
    if (
      typeof dtoInstanceRawUnknownValue !== 'object' ||
      dtoInstanceRawUnknownValue === null ||
      !('token' in dtoInstanceRawUnknownValue)
    ) {
      throw this.errors.internalServerError('VideoController.createVideoTokenResponseDto');
    }
    const dtoInstanceRawValue: Record<string, unknown> = dtoInstanceRawUnknownValue as Record<
      string,
      unknown
    >;
    const dtoInstanceUnknownValue: unknown = Object.assign(dtoInstanceRawValue, dtoData);
    if (
      typeof dtoInstanceUnknownValue !== 'object' ||
      dtoInstanceUnknownValue === null ||
      !('token' in dtoInstanceUnknownValue) ||
      typeof (dtoInstanceUnknownValue as { token: unknown }).token !== 'string' ||
      !('roomName' in dtoInstanceUnknownValue) ||
      typeof (dtoInstanceUnknownValue as { roomName: unknown }).roomName !== 'string' ||
      !('roomId' in dtoInstanceUnknownValue) ||
      typeof (dtoInstanceUnknownValue as { roomId: unknown }).roomId !== 'string' ||
      !('meetingUrl' in dtoInstanceUnknownValue) ||
      typeof (dtoInstanceUnknownValue as { meetingUrl: unknown }).meetingUrl !== 'string'
    ) {
      throw this.errors.internalServerError('VideoController.createVideoTokenResponseDto');
    }
    const validatedDtoUnknownValue: unknown = dtoInstanceUnknownValue;
    const validatedDtoValue: VideoTokenResponseDto =
      validatedDtoUnknownValue as VideoTokenResponseDto;
    const returnValueResult: VideoTokenResponseDto = validatedDtoValue;
    return returnValueResult;
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
    const dtoData: {
      id: string;
      appointmentId: string;
      roomId: string;
      roomName: string;
      meetingUrl: string;
      status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
      startTime: Date | null;
      endTime: Date | null;
      participants: Array<{
        userId: string;
        role: 'HOST' | 'PARTICIPANT';
        joinedAt: Date | null;
      }>;
      recordingEnabled: boolean;
      screenSharingEnabled: boolean;
      chatEnabled: boolean;
      waitingRoomEnabled: boolean;
    } = {
      id,
      appointmentId,
      roomId,
      roomName,
      meetingUrl,
      status,
      startTime,
      endTime,
      participants,
      recordingEnabled,
      screenSharingEnabled,
      chatEnabled,
      waitingRoomEnabled,
    };
    const VideoConsultationSessionDtoClass: typeof VideoConsultationSessionDto =
      VideoConsultationSessionDto;
    const dtoInstanceRawUnknown: unknown = new VideoConsultationSessionDtoClass();
    if (
      typeof dtoInstanceRawUnknown !== 'object' ||
      dtoInstanceRawUnknown === null ||
      !('id' in dtoInstanceRawUnknown)
    ) {
      throw this.errors.internalServerError('VideoController.createVideoConsultationSessionDto');
    }
    const dtoInstanceRaw: Record<string, unknown> = dtoInstanceRawUnknown as Record<
      string,
      unknown
    >;
    const dtoInstanceUnknown: unknown = Object.assign(dtoInstanceRaw, dtoData);
    if (
      typeof dtoInstanceUnknown !== 'object' ||
      dtoInstanceUnknown === null ||
      !('id' in dtoInstanceUnknown) ||
      typeof (dtoInstanceUnknown as { id: unknown }).id !== 'string' ||
      !('appointmentId' in dtoInstanceUnknown) ||
      typeof (dtoInstanceUnknown as { appointmentId: unknown }).appointmentId !== 'string' ||
      !('roomId' in dtoInstanceUnknown) ||
      typeof (dtoInstanceUnknown as { roomId: unknown }).roomId !== 'string' ||
      !('roomName' in dtoInstanceUnknown) ||
      typeof (dtoInstanceUnknown as { roomName: unknown }).roomName !== 'string' ||
      !('meetingUrl' in dtoInstanceUnknown) ||
      typeof (dtoInstanceUnknown as { meetingUrl: unknown }).meetingUrl !== 'string'
    ) {
      throw this.errors.internalServerError('VideoController.createVideoConsultationSessionDto');
    }
    const validatedDtoUnknown: unknown = dtoInstanceUnknown;
    const validatedDto: VideoConsultationSessionDto =
      validatedDtoUnknown as VideoConsultationSessionDto;
    const returnValue: VideoConsultationSessionDto = validatedDto;
    return returnValue;
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
    type: GenerateVideoTokenDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Token generated successfully',
    type: (): typeof VideoTokenResponseDto => VideoTokenResponseDto,
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
    @Body() body: GenerateVideoTokenDto,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<VideoTokenResponseDto> {
    try {
      const tokenResponseResult: unknown = await this.videoService.generateMeetingToken(
        body.appointmentId,
        body.userId,
        body.userRole,
        {
          displayName: body.userInfo.displayName,
          email: body.userInfo.email,
          ...(body.userInfo.avatar && { avatar: body.userInfo.avatar }),
        }
      );
      if (!this.isVideoTokenResponse(tokenResponseResult)) {
        throw this.errors.internalServerError('VideoController.generateToken');
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
      const tokenDtoResult: unknown = this.createVideoTokenResponseDto(
        responseToken,
        responseRoomName,
        responseRoomId,
        responseMeetingUrl,
        responseRoomPassword,
        responseMeetingPassword,
        responseEncryptionKey,
        responseExpiresAt
      );
      if (
        typeof tokenDtoResult !== 'object' ||
        tokenDtoResult === null ||
        !('token' in tokenDtoResult) ||
        typeof (tokenDtoResult as { token: unknown }).token !== 'string'
      ) {
        throw this.errors.internalServerError('VideoController.generateToken');
      }
      const tokenDto: VideoTokenResponseDto = tokenDtoResult as VideoTokenResponseDto;

      return tokenDto;
    } catch (error) {
      const context = 'VideoController.generateToken';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
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
    type: StartVideoConsultationDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consultation started successfully',
    type: (): typeof VideoConsultationSessionDto => VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  async startConsultation(
    @Body() body: StartVideoConsultationDto,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const sessionResult: unknown = await this.videoService.startConsultation(
        body.appointmentId,
        body.userId,
        body.userRole
      );
      if (!this.isVideoConsultationSession(sessionResult)) {
        throw this.errors.internalServerError('VideoController.endConsultation');
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
      const sessionDtoResult: unknown = this.createVideoConsultationSessionDto(
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
      if (
        typeof sessionDtoResult !== 'object' ||
        sessionDtoResult === null ||
        !('id' in sessionDtoResult) ||
        typeof (sessionDtoResult as { id: unknown }).id !== 'string'
      ) {
        throw this.errors.internalServerError('VideoController.startConsultation');
      }
      const sessionDto: VideoConsultationSessionDto =
        sessionDtoResult as VideoConsultationSessionDto;

      return sessionDto;
    } catch (error) {
      const context = 'VideoController.startConsultation';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
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
    type: (): typeof VideoConsultationSessionDto => VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Consultation session not found',
  })
  async endConsultation(
    @Body() body: EndVideoConsultationDto,
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
        throw this.errors.internalServerError('VideoController.endConsultation');
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
      const sessionDtoResult: unknown = this.createVideoConsultationSessionDto(
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
      if (
        typeof sessionDtoResult !== 'object' ||
        sessionDtoResult === null ||
        !('id' in sessionDtoResult) ||
        typeof (sessionDtoResult as { id: unknown }).id !== 'string'
      ) {
        throw this.errors.internalServerError('VideoController.endConsultation');
      }
      const sessionDto: VideoConsultationSessionDto =
        sessionDtoResult as VideoConsultationSessionDto;

      return sessionDto;
    } catch (error) {
      const context = 'VideoController.endConsultation';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
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
    type: (): typeof VideoConsultationSessionDto => VideoConsultationSessionDto,
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
        throw this.errors.notFoundError(
          'Video consultation session',
          'VideoController.getConsultationStatus',
          {
            appointmentId,
          }
        );
      }
      if (!this.isVideoConsultationSession(sessionResult)) {
        throw this.errors.internalServerError('VideoController.getConsultationStatus');
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
      const sessionDtoResult: unknown = this.createVideoConsultationSessionDto(
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
      if (
        typeof sessionDtoResult !== 'object' ||
        sessionDtoResult === null ||
        !('id' in sessionDtoResult) ||
        typeof (sessionDtoResult as { id: unknown }).id !== 'string'
      ) {
        throw this.errors.internalServerError('VideoController.getConsultationStatus');
      }
      const sessionDto: VideoConsultationSessionDto =
        sessionDtoResult as VideoConsultationSessionDto;

      return sessionDto;
    } catch (error) {
      const context = 'VideoController.getConsultationStatus';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
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
    type: ReportTechnicalIssueDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Technical issue reported successfully',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request data',
  })
  async reportTechnicalIssue(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() body: ReportTechnicalIssueDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw this.errors.validationError(
          'userId',
          'User ID required',
          'VideoController.reportTechnicalIssue'
        );
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
      const context = 'VideoController.reportTechnicalIssue';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Video call history retrieved successfully',
    type: (): typeof VideoCallHistoryResponseDto => VideoCallHistoryResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters',
  })
  async getVideoCallHistory(
    @Query() query: VideoCallHistoryQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoCallHistoryResponseDto> {
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
        throw this.errors.validationError(
          'userId',
          'User ID is required',
          'VideoController.getVideoCallHistory'
        );
      }

      const historyResult: unknown = await this.videoService.getVideoCallHistory(userId, clinicId);
      if (
        typeof historyResult !== 'object' ||
        historyResult === null ||
        !('data' in historyResult)
      ) {
        throw this.errors.internalServerError('VideoController.getVideoCallHistory');
      }
      const history = historyResult as { data: unknown };
      if (!history.data) {
        throw this.errors.notFoundError(
          'Video call history',
          'VideoController.getVideoCallHistory'
        );
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
        throw this.errors.notFoundError(
          'Video call history',
          'VideoController.getVideoCallHistory'
        );
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

      const result = new VideoCallHistoryResponseDto();
      result.userId = dataUserId;
      result.calls = dataCalls as VideoCallResponseDto[];
      result.total = dataTotal;
      result.retrievedAt = dataRetrievedAt;
      if (dataClinicId !== undefined && dataClinicId !== null) {
        result.clinicId = dataClinicId;
      }

      return result;
    } catch (error) {
      const context = 'VideoController.getVideoCallHistory';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  /**
   * Share medical image during consultation
   */
  @Post('consultation/:appointmentId/share-image')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('video', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'Share medical image',
    description: 'Share a medical image during a video consultation session.',
  })
  @ApiParam({
    name: 'appointmentId',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({
    type: ShareMedicalImageDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Medical image shared successfully',
    type: ShareMedicalImageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Video call not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'User is not a participant in this call',
  })
  async shareMedicalImage(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() body: ShareMedicalImageDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ShareMedicalImageResponseDto> {
    try {
      const userId = req.user?.sub || body.userId;
      if (!userId) {
        throw this.errors.validationError(
          'userId',
          'User ID required',
          'VideoController.shareMedicalImage'
        );
      }

      // Get consultation to find callId
      const consultation = await this.videoService.getConsultationSession(appointmentId);
      if (!consultation) {
        throw this.errors.notFoundError(
          'Video consultation session',
          'VideoController.shareMedicalImage',
          {
            appointmentId,
          }
        );
      }

      const callId = consultation.roomId || appointmentId;
      const result = await this.videoService.shareMedicalImage(callId, userId, body.imageData);

      if (
        !result ||
        typeof result !== 'object' ||
        !('data' in result) ||
        typeof result.data !== 'object' ||
        result.data === null ||
        !('imageUrl' in result.data) ||
        typeof (result.data as { imageUrl: unknown }).imageUrl !== 'string'
      ) {
        throw this.errors.internalServerError('VideoController.shareMedicalImage');
      }

      const response: ShareMedicalImageResponseDto = {
        imageUrl: (result.data as { imageUrl: string }).imageUrl,
        callId,
        userId,
      };

      // Emit event
      await this.eventService.emitEnterprise('video.medical.image.shared', {
        eventId: `video-image-shared-${appointmentId}-${Date.now()}`,
        eventType: 'video.medical.image.shared',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoController',
        version: '1.0.0',
        payload: {
          appointmentId,
          callId,
          userId,
          imageUrl: response.imageUrl,
        },
      });

      return response;
    } catch (error) {
      const context = 'VideoController.shareMedicalImage';
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  /**
   * Health check endpoint using @nestjs/terminus
   */
  @Get('health')
  @HealthCheck()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Video service health check',
    description:
      'Check the health status of the video service and providers using Terminus health checks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: {
          type: 'object',
          properties: {
            video: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
                primaryProvider: { type: 'string', example: 'openvidu' },
                fallbackProvider: { type: 'string', example: 'jitsi' },
              },
            },
            communication: { type: 'object' },
            database: { type: 'object' },
            cache: { type: 'object' },
          },
        },
        error: { type: 'object' },
        details: { type: 'object' },
      },
    },
  })
  async healthCheck() {
    return await this.health.check([
      () => this.videoHealthIndicator.check('video'),
      () => this.communicationHealthIndicator.check('communication'),
      () => this.databaseHealthIndicator.check('database'),
      () => this.cacheHealthIndicator.check('cache'),
    ]);
  }

  // ============================================================================
  // OPENVIDU PRO FEATURES - RECORDING
  // ============================================================================

  @Post('recording/start')
  @HttpCode(HttpStatus.CREATED)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Start OpenVidu recording',
    description: 'Start recording for a video consultation session (OpenVidu Pro feature).',
  })
  @ApiBody({ type: StartRecordingDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Recording started successfully',
    type: RecordingResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request or provider not OpenVidu',
  })
  async startRecording(
    @Body() dto: StartRecordingDto,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<RecordingResponseDto> {
    try {
      const recordingOptions: {
        outputMode?: 'COMPOSED' | 'INDIVIDUAL';
        resolution?: string;
        frameRate?: number;
        customLayout?: string;
      } = {};
      if (dto.outputMode !== undefined) {
        recordingOptions.outputMode = dto.outputMode;
      }
      if (dto.resolution !== undefined) {
        recordingOptions.resolution = dto.resolution;
      }
      if (dto.frameRate !== undefined) {
        recordingOptions.frameRate = dto.frameRate;
      }
      if (dto.customLayout !== undefined) {
        recordingOptions.customLayout = dto.customLayout;
      }

      const result: { recordingId: string; status: string } =
        await this.videoService.startOpenViduRecording(dto.appointmentId, recordingOptions);

      const response: RecordingResponseDto = {
        recordingId: result.recordingId,
        url: '',
        duration: 0,
        size: 0,
        status: result.status as 'starting' | 'started' | 'stopped' | 'ready' | 'failed',
        createdAt: new Date().toISOString(),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.startRecording');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.startRecording');
    }
  }

  @Post('recording/stop')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Stop OpenVidu recording',
    description: 'Stop an active recording (OpenVidu Pro feature).',
  })
  @ApiBody({ type: StopRecordingDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recording stopped successfully',
    type: RecordingResponseDto,
  })
  async stopRecording(
    @Body() dto: StopRecordingDto,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<RecordingResponseDto> {
    try {
      const result: { recordingId: string; url?: string; duration: number } =
        await this.videoService.stopOpenViduRecording(dto.appointmentId, dto.recordingId);

      const response: RecordingResponseDto = {
        recordingId: result.recordingId,
        url: result.url || '',
        duration: result.duration,
        size: 0,
        status: 'stopped',
        createdAt: new Date().toISOString(),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.stopRecording');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.stopRecording');
    }
  }

  @Get('recording/:appointmentId')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get recordings for a session',
    description: 'Get all recordings for a video consultation session (OpenVidu Pro feature).',
  })
  @ApiParam({
    name: 'appointmentId',
    type: 'string',
    format: 'uuid',
    description: 'Appointment ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recordings retrieved successfully',
    type: RecordingListResponseDto,
  })
  async getRecordings(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<RecordingListResponseDto> {
    try {
      type RecordingReturnType = Awaited<
        ReturnType<typeof this.videoService.getOpenViduRecordings>
      >[number];
      const recordings = await this.videoService.getOpenViduRecordings(appointmentId);

      const response: RecordingListResponseDto = {
        count: recordings.length,
        recordings: recordings.map((rec: RecordingReturnType) => ({
          recordingId: rec.recordingId,
          url: rec.url || '',
          duration: rec.duration,
          size: rec.size,
          status: rec.status as 'starting' | 'started' | 'stopped' | 'ready' | 'failed',
          createdAt: rec.createdAt,
        })),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getRecordings');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getRecordings');
    }
  }

  // ============================================================================
  // OPENVIDU PRO FEATURES - PARTICIPANT MANAGEMENT
  // ============================================================================

  @Post('participant/manage')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Manage participant',
    description: 'Kick, mute, unmute, or force unpublish a participant (OpenVidu Pro feature).',
  })
  @ApiBody({ type: ManageParticipantDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Participant action completed successfully',
    type: SuccessResponseDto,
  })
  async manageParticipant(
    @Body() dto: ManageParticipantDto,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    try {
      await this.videoService.manageOpenViduParticipant(
        dto.appointmentId,
        dto.connectionId,
        dto.action
      );

      return new SuccessResponseDto(`Participant ${dto.action} completed successfully`);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.manageParticipant');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.manageParticipant');
    }
  }

  @Get('participants/:appointmentId')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get participants',
    description: 'Get all participants in a video consultation session (OpenVidu Pro feature).',
  })
  @ApiParam({
    name: 'appointmentId',
    type: 'string',
    format: 'uuid',
    description: 'Appointment ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Participants retrieved successfully',
    type: ParticipantListResponseDto,
  })
  async getParticipants(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<ParticipantListResponseDto> {
    try {
      type ParticipantReturnType = Awaited<
        ReturnType<typeof this.videoService.getOpenViduParticipants>
      >[number];
      const participants = await this.videoService.getOpenViduParticipants(appointmentId);

      const response: ParticipantListResponseDto = {
        count: participants.length,
        participants: participants.map((p: ParticipantReturnType) => ({
          id: p.id,
          connectionId: p.connectionId,
          role: p.role as 'PUBLISHER' | 'SUBSCRIBER' | 'MODERATOR',
          ...(p.location !== undefined && { location: p.location }),
          ...(p.platform !== undefined && { platform: p.platform }),
          streams: p.streams.map((s: ParticipantReturnType['streams'][number]) => ({
            streamId: s.streamId,
            hasAudio: s.hasAudio,
            hasVideo: s.hasVideo,
            audioActive: s.audioActive,
            videoActive: s.videoActive,
            typeOfVideo: s.typeOfVideo,
          })),
        })),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getParticipants');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getParticipants');
    }
  }

  // ============================================================================
  // OPENVIDU PRO FEATURES - ANALYTICS
  // ============================================================================

  @Get('analytics/:appointmentId')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get session analytics',
    description: 'Get detailed analytics for a video consultation session (OpenVidu Pro feature).',
  })
  @ApiParam({
    name: 'appointmentId',
    type: 'string',
    format: 'uuid',
    description: 'Appointment ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analytics retrieved successfully',
    type: SessionAnalyticsResponseDto,
  })
  async getSessionAnalytics(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<SessionAnalyticsResponseDto> {
    try {
      const analytics = await this.videoService.getOpenViduSessionAnalytics(appointmentId);

      const response: SessionAnalyticsResponseDto = {
        sessionId: analytics.sessionId,
        duration: analytics.duration,
        numberOfParticipants: analytics.numberOfParticipants,
        numberOfConnections: analytics.numberOfConnections,
        recordingCount: analytics.recordingCount,
        recordingTotalDuration: analytics.recordingTotalDuration,
        recordingTotalSize: analytics.recordingTotalSize,
        connections: analytics.connections.map(
          (
            conn: Awaited<
              ReturnType<typeof this.videoService.getOpenViduSessionAnalytics>
            >['connections'][number]
          ) => ({
            connectionId: conn.connectionId,
            duration: conn.duration,
            ...(conn.location !== undefined && { location: conn.location }),
            ...(conn.platform !== undefined && { platform: conn.platform }),
            publishers: conn.publishers,
            subscribers: conn.subscribers,
          })
        ),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getSessionAnalytics');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getSessionAnalytics');
    }
  }
}
