import { nowIso } from '@utils/date-time.util';
/**
 * Video Controller
 * @class VideoController
 * @description REST API endpoints for video consultation services
 * Canonical runtime video API for consultation lifecycle and provider abstraction.
 * Appointment routes may wrap these endpoints temporarily for backward compatibility.
 * Microservice-ready design
 */

// 1. External imports (NestJS, npm packages)
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  HttpCode,
  HttpStatus,
  Request,
  ParseUUIDPipe,
  Put,
  ValidationPipe,
  HttpException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
// Terminus removed - using only LoggingService (per .ai-rules/ coding standards)

// 2. Internal imports - Infrastructure layer
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';

// 3. Internal imports - Core layer
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { ClinicRoute } from '@core/decorators/clinic-route.decorator';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';

import { Cache } from '@core/decorators';
import { HealthcareErrorsService, HealthcareError } from '@core/errors';
import { EventCategory, EventPriority, LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import type {
  VideoTokenResponse,
  VideoConsultationSession,
  VideoConsultationAccessState,
  VideoProviderType,
  VideoProviderSettingResponse,
} from '@core/types/video.types';

// 4. Internal imports - Configuration
import { ValidationPipeConfig } from '@config/validation-pipe.config';

// 5. Internal imports - Services
import { VideoChatService } from './services/video-chat.service';
import { VideoWaitingRoomService } from './services/video-waiting-room.service';
import { VideoMedicalNotesService } from './services/video-medical-notes.service';
import { VideoAnnotationService } from './services/video-annotation.service';
import { VideoTranscriptionService } from './services/video-transcription.service';
import { VideoQualityService } from './services/video-quality.service';
import { VideoVirtualBackgroundService } from './services/video-virtual-background.service';

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
  VideoMessageType,
  VideoNoteType,
  VideoAnnotationType,
  WaitingRoomStatus,
  SuccessResponseDto,
  StartRecordingDto,
  StopRecordingDto,
  ManageParticipantDto,
  RecordingResponseDto,
  RecordingListResponseDto,
  ParticipantListResponseDto,
  SessionAnalyticsResponseDto,
  // New feature DTOs
  SendChatMessageDto,
  ChatMessageResponseDto,
  UpdateTypingIndicatorDto,
  JoinWaitingRoomDto,
  LeaveWaitingRoomDto,
  AdmitPatientDto,
  WaitingRoomEntryResponseDto,
  CreateMedicalNoteDto,
  UpdateMedicalNoteDto,
  MedicalNoteResponseDto,
  SaveNoteToEHRDto,
  CreateAnnotationDto,
  AnnotationResponseDto,
  DeleteAnnotationDto,
  CreateTranscriptionDto,
  TranscriptionResponseDto,
  SaveTranscriptToEHRDto,
  UpdateQualityMetricsDto,
  QualityMetricsResponseDto,
  VirtualBackgroundSettingsDto,
  BackgroundPresetResponseDto,
  RateVideoConsultationDto,
} from '@dtos';

// 6. Local imports (same directory)
import { VideoService } from './video.service';
import {
  VIDEO_CLINICAL_STAFF_ROLES,
  VIDEO_MODERATOR_ROLES,
  toVideoCallerRole,
  type VideoCallerContext,
  type VideoCallerRole,
} from './video-access.helpers';
// NOTE: Health indicators removed - video health is now available via /health endpoint (HealthController)
// This consolidates all health checks into a single endpoint for better maintainability

@Controller('video')
@ApiTags('video')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
@UsePipes(new ValidationPipe(ValidationPipeConfig.getOptions()))
@ApiBearerAuth()
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly chatService: VideoChatService,
    private readonly waitingRoomService: VideoWaitingRoomService,
    private readonly medicalNotesService: VideoMedicalNotesService,
    private readonly annotationService: VideoAnnotationService,
    private readonly transcriptionService: VideoTranscriptionService,
    private readonly qualityService: VideoQualityService,
    private readonly virtualBackgroundService: VideoVirtualBackgroundService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly errors: HealthcareErrorsService
    // NOTE: Health indicators removed - video health is now available via /health endpoint (HealthController)
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

  private getAuthenticatedVideoUser(req: ClinicAuthenticatedRequest): {
    userId: string;
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin';
  } {
    const userId = req.user?.id || req.user?.sub;

    if (!userId) {
      throw this.errors.validationError(
        'userId',
        'Authenticated user ID is required',
        'VideoController.getAuthenticatedVideoUser'
      );
    }

    const userRole = toVideoCallerRole(req.user?.role);
    if (!userRole) {
      throw this.errors.insufficientPermissions('VideoController.getAuthenticatedVideoUser');
    }
    return { userId, userRole };
  }

  /**
   * Clinic and platform role of the requester, taken from the request the guards validated.
   * The service uses it to enforce clinic isolation and to tell staff roles apart.
   */
  private getVideoCallerContext(req: ClinicAuthenticatedRequest): VideoCallerContext {
    return {
      clinicId: req.clinicContext?.clinicId ?? req.user?.clinicId,
      rawRole: req.user?.role,
    };
  }

  /**
   * Per-appointment authorisation for every endpoint addressed by an appointment id or a
   * consultation id. RBAC `video:*` is not enough (every PATIENT holds it), so each of those
   * endpoints calls this BEFORE it reads or writes anything: other clinic -> 404, not a
   * participant (or clinic staff) -> 403.
   *
   * Call it outside the endpoint's try/catch so the 403/404 reaches the client instead of being
   * folded into a 500 by the generic error mapping.
   *
   * @returns the authenticated user, used to override any identity the client put in a body
   */
  private async authorizeConsultationRequest(
    appointmentOrConsultationId: string,
    req: ClinicAuthenticatedRequest
  ): Promise<{ userId: string; userRole: VideoCallerRole }> {
    const { userId, userRole } = this.getAuthenticatedVideoUser(req);
    await this.videoService.authorizeConsultationAccess(
      appointmentOrConsultationId,
      userId,
      userRole,
      this.getVideoCallerContext(req)
    );
    return { userId, userRole };
  }

  /**
   * Same as authorizeConsultationRequest for endpoints addressed by a child record id (a note or
   * an annotation): `lookupConsultationId` resolves the consultation the record belongs to
   * (throwing a 404 when the record does not exist), then the caller is authorised against it.
   */
  private async authorizeByLookup(
    lookupConsultationId: () => Promise<string>,
    context: string,
    req: ClinicAuthenticatedRequest
  ): Promise<{ userId: string; userRole: VideoCallerRole }> {
    let consultationId: string;
    try {
      consultationId = await lookupConsultationId();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError(context);
    }
    return await this.authorizeConsultationRequest(consultationId, req);
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
    const dto = new VideoTokenResponseDto();
    dto.token = token;
    dto.roomName = roomName;
    dto.roomId = roomId;
    dto.meetingUrl = meetingUrl;
    if (roomPassword !== undefined) {
      dto.roomPassword = roomPassword;
    }
    if (meetingPassword !== undefined) {
      dto.meetingPassword = meetingPassword;
    }
    if (encryptionKey !== undefined) {
      dto.encryptionKey = encryptionKey;
    }
    if (expiresAt !== undefined) {
      dto.expiresAt = expiresAt;
    }
    return dto;
  }

  private createVideoConsultationSessionDto(
    id: string,
    appointmentId: string,
    roomId: string,
    roomName: string,
    meetingUrl: string,
    status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'COMPLETED' | 'CANCELLED',
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
    waitingRoomEnabled: boolean,
    patientName?: string,
    doctorName?: string,
    accessState?: VideoConsultationAccessState
  ): VideoConsultationSessionDto {
    const dtoData: {
      id: string;
      appointmentId: string;
      roomId: string;
      roomName: string;
      meetingUrl: string;
      patientName?: string;
      doctorName?: string;
      status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'COMPLETED' | 'CANCELLED';
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
      canJoin?: boolean;
      paymentRequired?: boolean;
      paymentCompleted?: boolean;
      joinBlockedReason?: string | null;
      joinWindowStart?: Date | null;
      joinWindowEnd?: Date | null;
      scheduledStartTime?: Date | null;
      scheduledEndTime?: Date | null;
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
    if (patientName !== undefined) {
      dtoData.patientName = patientName;
    }
    if (doctorName !== undefined) {
      dtoData.doctorName = doctorName;
    }
    if (accessState) {
      dtoData.canJoin = accessState.canJoin;
      dtoData.paymentRequired = accessState.paymentRequired;
      dtoData.paymentCompleted = accessState.paymentCompleted;
      dtoData.joinBlockedReason = accessState.joinBlockedReason;
      dtoData.joinWindowStart = accessState.joinWindowStart;
      dtoData.joinWindowEnd = accessState.joinWindowEnd;
      dtoData.scheduledStartTime = accessState.scheduledStartTime;
      dtoData.scheduledEndTime = accessState.scheduledEndTime;
    }
    const VideoConsultationSessionDtoClass: typeof VideoConsultationSessionDto =
      VideoConsultationSessionDto;
    // Note: a fresh class instance has no own properties for `!:`-declared fields, so it
    // must not be checked for 'id' before assignment (that check always failed and made
    // POST /video/consultation/start return 500).
    const dtoInstanceRawUnknown: unknown = new VideoConsultationSessionDtoClass();
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
      (!['string', 'undefined'].includes(
        typeof (dtoInstanceUnknown as { meetingUrl?: unknown }).meetingUrl
      ) &&
        (dtoInstanceUnknown as { meetingUrl?: unknown }).meetingUrl !== null)
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
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN
  )
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoTokenResponseDto> {
    try {
      const authenticatedUser = this.getAuthenticatedVideoUser(req);
      const tokenResponseResult: unknown = await this.videoService.generateMeetingToken(
        body.appointmentId,
        authenticatedUser.userId,
        authenticatedUser.userRole,
        {
          displayName: body.userInfo.displayName,
          email: body.userInfo.email || '',
          ...(body.userInfo.avatar && { avatar: body.userInfo.avatar }),
        },
        this.getVideoCallerContext(req)
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
        timestamp: nowIso(),
        source: 'VideoController',
        version: '1.0.0',
        payload: {
          appointmentId: body.appointmentId,
          userId: authenticatedUser.userId,
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
      if (error instanceof HttpException) {
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
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.NURSE,
    Role.RECEPTIONIST
  )
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const authenticatedUser = this.getAuthenticatedVideoUser(req);
      const sessionResult: unknown = await this.videoService.startConsultation(
        body.appointmentId,
        authenticatedUser.userId,
        authenticatedUser.userRole,
        this.getVideoCallerContext(req)
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
        sessionWaitingRoomEnabled,
        session.patientName,
        session.doctorName
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
      if (error instanceof HttpException) {
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
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN
  )
  @ClinicRoute()
  @RequireResourcePermission('video', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'End video consultation',
    description:
      "End (complete) a video consultation. Only the appointment's own doctor or a CLINIC_ADMIN of its clinic can; a patient calling this is recorded as leaving the call (200, the visit stays open); everyone else gets 403. The visit must have started (409 'This consultation has not started' otherwise). userId and userRole in the body are ignored: identity comes from the token.",
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
    status: HttpStatus.FORBIDDEN,
    description: 'Only the treating doctor or a clinic admin can end this consultation',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The consultation has not started, or the appointment is no longer open',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Consultation session not found',
  })
  async endConsultation(
    @Body() body: EndVideoConsultationDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const authenticatedUser = this.getAuthenticatedVideoUser(req);
      const sessionResult: unknown = await this.videoService.endConsultation(
        body.appointmentId,
        authenticatedUser.userId,
        authenticatedUser.userRole,
        body.meetingNotes,
        this.getVideoCallerContext(req)
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
        sessionWaitingRoomEnabled,
        session.patientName,
        session.doctorName
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
      if (error instanceof HttpException) {
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
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN
  )
  @ClinicRoute()
  @RequireResourcePermission('video', 'read', { requireOwnership: true })
  @Cache({
    // Per user: a cache hit skips the handler, and with it the participant check, so the entry
    // must never be shared between two callers who are not both authorised for the appointment.
    keyTemplate: 'video:consultation:status:{appointmentId}:{userId}',
    ttl: 60, // 1 minute (status changes frequently during active sessions)
    tags: ['video', 'consultation', 'appointment:{appointmentId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get video consultation status',
    description: 'Get the current status of a video consultation session. Cached for performance.',
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    // Participant / same-clinic check first: the response carries the meeting link, room name
    // and both parties' names.
    await this.authorizeConsultationRequest(appointmentId, req);
    try {
      const accessContext: { userId?: string; userRole?: string } = {};
      const resolvedUserId = req.user?.id || req.user?.sub;
      if (resolvedUserId) {
        accessContext.userId = resolvedUserId;
      }
      if (req.user?.role) {
        accessContext.userRole = req.user.role;
      }
      const accessState = await this.videoService.getConsultationAccessState(
        appointmentId,
        accessContext
      );
      const sessionResult: unknown = await this.videoService.getConsultationSession(
        appointmentId,
        accessContext
      );
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
        throw this.errors.externalServiceInvalidResponse(
          'Video consultation session returned an invalid response. Please refresh and try again.',
          'VideoController.getConsultationStatus',
          {
            appointmentId,
            phase: 'validate-session',
          }
        );
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
        sessionWaitingRoomEnabled,
        session.patientName,
        session.doctorName,
        accessState
      );
      if (
        typeof sessionDtoResult !== 'object' ||
        sessionDtoResult === null ||
        !('id' in sessionDtoResult) ||
        typeof (sessionDtoResult as { id: unknown }).id !== 'string'
      ) {
        throw this.errors.externalServiceInvalidResponse(
          'Video consultation session could not be formatted correctly. Please refresh and try again.',
          'VideoController.getConsultationStatus',
          {
            appointmentId,
            phase: 'build-dto',
          }
        );
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
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // NotFoundException originates from ensureAppointmentJoinable (via the appointment
      // fallback path) re-throw it directly so the HTTP filter maps it to 404,
      // preserving the differentiated message the frontend decoder relies on.
      if (error instanceof NotFoundException) {
        throw error;
      }
      // The raw message and error name (Prisma text, provider response, ...) go to the log only:
      // the exception metadata below is sent to the client by the http-exception filter.
      const actualErrorMessage =
        error instanceof Error
          ? error.message
          : 'Video consultation status could not be retrieved. Please try again later.';
      const healthcareError = this.errors.externalServiceInvalidResponse(
        'Video consultation status could not be retrieved. Please try again later.',
        context,
        {
          appointmentId,
          phase: 'catch-all',
        }
      );
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `[ERROR] ${context} failed: ${actualErrorMessage}`,
        context,
        {
          appointmentId,
          error: actualErrorMessage,
          originalErrorName: error instanceof Error ? error.name : typeof error,
        }
      );
      await this.eventService.emitEnterprise('video.consultation.status.failed', {
        eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        eventType: 'video.consultation.status.failed',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: context,
        version: '1.0.0',
        metadata: {
          appointmentId,
          phase: 'catch-all',
        },
      });
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  /**
   * Post-call consultation summary
   */
  @Get('consultation/:appointmentId/summary')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('video', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Get video consultation summary',
    description:
      'Appointment info, doctor/patient names, actual duration and the consultation notes. Patients can only view their own consultations.',
  })
  @ApiParam({
    name: 'appointmentId',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consultation summary retrieved successfully',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Appointment not found' })
  async getConsultationSummary(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const context = 'VideoController.getConsultationSummary';
    try {
      // Same participant rules as join/start/end: the patient (or booker / dependent owner), the
      // appointment's doctor, clinic staff of the same clinic. Another clinic answers 404.
      const { userId, userRole } = this.getAuthenticatedVideoUser(req);
      const summary = await this.videoService.getConsultationSummary(
        appointmentId,
        userId,
        userRole,
        this.getVideoCallerContext(req)
      );
      let notes: unknown[] = [];
      if (summary.consultationId) {
        try {
          notes = await this.medicalNotesService.getNotes(summary.consultationId);
        } catch {
          notes = [];
        }
      }
      return { ...summary, notes };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  /**
   * Rate a video consultation (patient only)
   */
  @Post('consultation/:appointmentId/rate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('video', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'Rate video consultation',
    description: 'Patient submits a 1-5 star rating (and optional comment) for their consultation.',
  })
  @ApiParam({
    name: 'appointmentId',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: RateVideoConsultationDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Rating saved' })
  async rateConsultation(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() body: RateVideoConsultationDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const context = 'VideoController.rateConsultation';
    try {
      const userId = req.user?.id || req.user?.sub;
      if (!userId) {
        throw this.errors.validationError('userId', 'Authenticated user ID is required', context);
      }
      return await this.videoService.rateConsultation(
        appointmentId,
        userId,
        body.rating,
        body.comment,
        req.clinicContext?.clinicId ?? req.user?.clinicId
      );
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      if (error instanceof HttpException) {
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
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
    const { userId } = await this.authorizeConsultationRequest(appointmentId, req);
    try {
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
        timestamp: nowIso(),
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
      if (error instanceof HttpException) {
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
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.CLINIC_ADMIN
  )
  @ClinicRoute()
  @RequireResourcePermission('video', 'read')
  @Cache({
    keyTemplate: 'video:history:{userId}:{clinicId}',
    ttl: 900, // 15 minutes
    tags: ['video', 'history', 'user:{userId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get video call history',
    description: 'Get video call history for a user. Cached for performance.',
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
      const userId = req.user?.id || req.user?.sub || '';
      const clinicId = req.clinicContext?.clinicId || query.clinicId;

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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
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
    // The sharer is always the authenticated user; a userId in the body is never trusted.
    const { userId } = await this.authorizeConsultationRequest(appointmentId, req);
    try {
      // Resolve the consultation room identifier for media sharing
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
        timestamp: nowIso(),
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
      if (error instanceof HttpException) {
        throw error;
      }
      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  // NOTE: Video health check is available via /health endpoint (HealthController)
  // This consolidates all health checks into a single endpoint for better maintainability
  // Use GET /health to check video service health along with all other services

  // ============================================================================
  // ============================================================================

  @Post('recording/start')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...VIDEO_MODERATOR_ROLES)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Start recording',
    description: 'Start recording for a video consultation session.',
  })
  @ApiBody({ type: StartRecordingDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Recording started successfully',
    type: RecordingResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request or provider unavailable',
  })
  async startRecording(
    @Body() dto: StartRecordingDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RecordingResponseDto> {
    await this.authorizeConsultationRequest(dto.appointmentId, req);
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
        await this.videoService.startSessionRecording(dto.appointmentId, recordingOptions);

      const response: RecordingResponseDto = {
        recordingId: result.recordingId,
        url: '',
        duration: 0,
        size: 0,
        status: result.status as 'starting' | 'started' | 'stopped' | 'ready' | 'failed',
        createdAt: nowIso(),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.startRecording');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.startRecording');
    }
  }

  @Post('recording/stop')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_MODERATOR_ROLES)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Stop recording',
    description: 'Stop an active recording.',
  })
  @ApiBody({ type: StopRecordingDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recording stopped successfully',
    type: RecordingResponseDto,
  })
  async stopRecording(
    @Body() dto: StopRecordingDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RecordingResponseDto> {
    await this.authorizeConsultationRequest(dto.appointmentId, req);
    try {
      const result: { recordingId: string; url?: string; duration: number } =
        await this.videoService.stopSessionRecording(dto.appointmentId, dto.recordingId);

      const response: RecordingResponseDto = {
        recordingId: result.recordingId,
        url: result.url || '',
        duration: result.duration,
        size: 0,
        status: 'stopped',
        createdAt: nowIso(),
      };

      return response;
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.stopRecording');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.stopRecording');
    }
  }

  @Get('recording/:appointmentId')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_MODERATOR_ROLES)
  @RequireResourcePermission('video', 'read')
  @Cache({
    // Per user: a cache hit skips the participant check (see getConsultationStatus).
    keyTemplate: 'video:recording:{appointmentId}:{userId}',
    ttl: 300, // 5 minutes (recordings may be added)
    tags: ['video', 'recording', 'appointment:{appointmentId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get recordings for a session',
    description: 'Get all recordings for a video consultation session. Cached for performance.',
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RecordingListResponseDto> {
    await this.authorizeConsultationRequest(appointmentId, req);
    try {
      type RecordingReturnType = Awaited<
        ReturnType<typeof this.videoService.getSessionRecordings>
      >[number];
      const recordings = await this.videoService.getSessionRecordings(appointmentId);

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
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getRecordings');
    }
  }

  // ============================================================================
  // ============================================================================

  @Post('participant/manage')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_MODERATOR_ROLES)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Manage participant',
    description: 'Kick, mute, unmute, or force unpublish a participant.',
  })
  @ApiBody({ type: ManageParticipantDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Participant action completed successfully',
    type: SuccessResponseDto,
  })
  async manageParticipant(
    @Body() dto: ManageParticipantDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    await this.authorizeConsultationRequest(dto.appointmentId, req);
    try {
      await this.videoService.manageSessionParticipant(
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.manageParticipant');
    }
  }

  @Get('participants/:appointmentId')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'read')
  @Cache({
    // Per user: a cache hit skips the participant check (see getConsultationStatus).
    keyTemplate: 'video:participants:{appointmentId}:{userId}',
    ttl: 30, // 30 seconds (participants change frequently during active sessions)
    tags: ['video', 'participants', 'appointment:{appointmentId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get participants',
    description: 'Get all participants in a video consultation session. Cached for performance.',
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ParticipantListResponseDto> {
    await this.authorizeConsultationRequest(appointmentId, req);
    try {
      type ParticipantReturnType = Awaited<
        ReturnType<typeof this.videoService.getSessionParticipants>
      >[number];
      const participants = await this.videoService.getSessionParticipants(appointmentId);

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
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getParticipants');
    }
  }

  // ============================================================================
  // ============================================================================

  @Get('analytics/:appointmentId')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'read')
  @Cache({
    // Per user: a cache hit skips the participant check (see getConsultationStatus).
    keyTemplate: 'video:analytics:{appointmentId}:{userId}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['video', 'analytics', 'appointment:{appointmentId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get session analytics',
    description: 'Get detailed analytics for a video consultation session. Cached for performance.',
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
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SessionAnalyticsResponseDto> {
    await this.authorizeConsultationRequest(appointmentId, req);
    try {
      const analytics = await this.videoService.getSessionAnalytics(appointmentId);

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
              ReturnType<typeof this.videoService.getSessionAnalytics>
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getSessionAnalytics');
    }
  }

  // ============================================================================
  // CHAT/MESSAGING ENDPOINTS
  // ============================================================================

  @Post('chat/send')
  @HttpCode(HttpStatus.CREATED)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Send chat message',
    description: 'Send a real-time chat message during video consultation',
  })
  @ApiResponse({ status: 201, type: ChatMessageResponseDto })
  async sendChatMessage(
    @Body() dto: SendChatMessageDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ChatMessageResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      // The sender is the authenticated user, whatever userId the body claims.
      const message = await this.chatService.sendMessage({ ...dto, userId: caller.userId });
      return {
        id: message.id,
        consultationId: message.consultationId,
        userId: message.userId,
        message: message.message,
        messageType: message.messageType as VideoMessageType,
        ...(message.fileUrl && { fileUrl: message.fileUrl }),
        ...(message.fileName && { fileName: message.fileName }),
        ...(message.fileSize !== undefined && { fileSize: message.fileSize }),
        ...(message.fileType && { fileType: message.fileType }),
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        ...(message.replyToId && { replyToId: message.replyToId }),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        ...(message.user && { user: message.user }),
      };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.sendChatMessage');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.sendChatMessage');
    }
  }

  @Get('chat/:consultationId/history')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get chat message history',
    description: 'Get chat message history for a video consultation',
  })
  @ApiParam({ name: 'consultationId', type: String })
  async getChatHistory(
    @Param('consultationId') consultationId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('before') before?: string
  ) {
    await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.chatService.getMessageHistory(
        consultationId,
        limit ? Number.parseInt(limit, 10) : 50,
        before
      );
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getChatHistory');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getChatHistory');
    }
  }

  @Post('chat/typing')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Update typing indicator',
    description: 'Update typing indicator for chat',
  })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async updateTypingIndicator(
    @Body() dto: UpdateTypingIndicatorDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      this.chatService.updateTypingIndicator(dto.consultationId, caller.userId, dto.isTyping);
      return new SuccessResponseDto('Typing indicator updated');
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.updateTypingIndicator');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.updateTypingIndicator');
    }
  }

  // ============================================================================
  // WAITING ROOM ENDPOINTS
  // ============================================================================

  @Post('waiting-room/join')
  @HttpCode(HttpStatus.CREATED)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Join waiting room',
    description: 'Join the waiting room for a video consultation',
  })
  @ApiResponse({ status: 201, type: WaitingRoomEntryResponseDto })
  async joinWaitingRoom(
    @Body() dto: JoinWaitingRoomDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<WaitingRoomEntryResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      // Only the authenticated user may take a place in the queue.
      const entry = await this.waitingRoomService.joinWaitingRoom({
        ...dto,
        userId: caller.userId,
      });
      return {
        id: entry.id,
        consultationId: entry.consultationId,
        userId: entry.userId,
        status: entry.status as WaitingRoomStatus,
        position: entry.position,
        ...(entry.estimatedWaitTime !== undefined && {
          estimatedWaitTime: entry.estimatedWaitTime,
        }),
        ...(entry.admittedAt && { admittedAt: entry.admittedAt }),
        ...(entry.notifiedAt && { notifiedAt: entry.notifiedAt }),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(entry.user && { user: entry.user }),
      };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.joinWaitingRoom');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.joinWaitingRoom');
    }
  }

  @Post('waiting-room/leave')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Leave waiting room',
    description: 'Leave the waiting room for a video consultation',
  })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async leaveWaitingRoom(
    @Body() dto: LeaveWaitingRoomDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    const authenticatedUser = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      await this.waitingRoomService.leaveWaitingRoom(dto.consultationId, authenticatedUser.userId);
      return new SuccessResponseDto('Left waiting room successfully');
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.leaveWaitingRoom');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.leaveWaitingRoom');
    }
  }

  @Post('waiting-room/admit')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Admit patient from waiting room',
    description: 'Doctor admits a patient from the waiting room',
  })
  @ApiResponse({ status: 200, type: WaitingRoomEntryResponseDto })
  async admitPatient(
    @Body() dto: AdmitPatientDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<WaitingRoomEntryResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      // The admitting doctor is the authenticated user, never a doctorId taken from the body.
      const entry = await this.waitingRoomService.admitPatient({ ...dto, doctorId: caller.userId });
      return {
        id: entry.id,
        consultationId: entry.consultationId,
        userId: entry.userId,
        status: entry.status as WaitingRoomStatus,
        position: entry.position,
        ...(entry.estimatedWaitTime !== undefined && {
          estimatedWaitTime: entry.estimatedWaitTime,
        }),
        ...(entry.admittedAt && { admittedAt: entry.admittedAt }),
        ...(entry.notifiedAt && { notifiedAt: entry.notifiedAt }),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(entry.user && { user: entry.user }),
      };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.admitPatient');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.admitPatient');
    }
  }

  @Get('waiting-room/:consultationId/queue')
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get waiting room queue',
    description: 'Get the current waiting room queue for a consultation',
  })
  async getWaitingRoomQueue(
    @Param('consultationId') consultationId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.waitingRoomService.getWaitingRoomQueue(consultationId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getWaitingRoomQueue');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getWaitingRoomQueue');
    }
  }

  // ============================================================================
  // MEDICAL NOTES ENDPOINTS
  // ============================================================================

  @Post('notes')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Create medical note',
    description: 'Create a medical note during video consultation',
  })
  @ApiResponse({ status: 201, type: MedicalNoteResponseDto })
  async createMedicalNote(
    @Body() dto: CreateMedicalNoteDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<MedicalNoteResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      const note = await this.medicalNotesService.createNote({ ...dto, userId: caller.userId });
      return {
        id: note.id,
        consultationId: note.consultationId,
        userId: note.userId,
        noteType: note.noteType as VideoNoteType,
        ...(note.title && { title: note.title }),
        content: note.content,
        ...(note.prescription && { prescription: note.prescription }),
        ...(note.symptoms && { symptoms: note.symptoms }),
        ...(note.treatmentPlan && { treatmentPlan: note.treatmentPlan }),
        isAutoSaved: note.isAutoSaved,
        savedToEHR: note.savedToEHR,
        ...(note.ehrRecordId && { ehrRecordId: note.ehrRecordId }),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.createMedicalNote');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.createMedicalNote');
    }
  }

  @Patch('notes/:noteId')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Update medical note',
    description: 'Update a medical note during video consultation',
  })
  @ApiResponse({ status: 200, type: MedicalNoteResponseDto })
  async updateMedicalNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: Omit<UpdateMedicalNoteDto, 'noteId'>,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<MedicalNoteResponseDto> {
    const caller = await this.authorizeByLookup(
      () => this.medicalNotesService.getNoteConsultationId(noteId),
      'VideoController.updateMedicalNote',
      req
    );
    try {
      const note = await this.medicalNotesService.updateNote({
        ...dto,
        noteId,
        userId: caller.userId,
      } as UpdateMedicalNoteDto);
      return {
        id: note.id,
        consultationId: note.consultationId,
        userId: note.userId,
        noteType: note.noteType as VideoNoteType,
        ...(note.title && { title: note.title }),
        content: note.content,
        ...(note.prescription && { prescription: note.prescription }),
        ...(note.symptoms && { symptoms: note.symptoms }),
        ...(note.treatmentPlan && { treatmentPlan: note.treatmentPlan }),
        isAutoSaved: note.isAutoSaved,
        savedToEHR: note.savedToEHR,
        ...(note.ehrRecordId && { ehrRecordId: note.ehrRecordId }),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.updateMedicalNote');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.updateMedicalNote');
    }
  }

  @Get('notes/:consultationId')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get medical notes',
    description: 'Get all medical notes for a consultation',
  })
  async getMedicalNotes(
    @Param('consultationId') consultationId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.medicalNotesService.getNotes(consultationId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getMedicalNotes');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getMedicalNotes');
    }
  }

  @Post('notes/:noteId/save-to-ehr')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Save note to EHR',
    description: 'Save a medical note to Electronic Health Records',
  })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async saveNoteToEHR(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() _dto: SaveNoteToEHRDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ ehrRecordId: string }> {
    const caller = await this.authorizeByLookup(
      () => this.medicalNotesService.getNoteConsultationId(noteId),
      'VideoController.saveNoteToEHR',
      req
    );
    try {
      return await this.medicalNotesService.saveToEHR(noteId, caller.userId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.saveNoteToEHR');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.saveNoteToEHR');
    }
  }

  // ============================================================================
  // ANNOTATION ENDPOINTS
  // ============================================================================

  @Post('annotations')
  @HttpCode(HttpStatus.CREATED)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Create annotation',
    description: 'Create a screen annotation during video consultation',
  })
  @ApiResponse({ status: 201, type: AnnotationResponseDto })
  async createAnnotation(
    @Body() dto: CreateAnnotationDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AnnotationResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      const annotation = await this.annotationService.createAnnotation({
        ...dto,
        userId: caller.userId,
      });
      return {
        id: annotation.id,
        consultationId: annotation.consultationId,
        userId: annotation.userId,
        annotationType: annotation.annotationType as VideoAnnotationType,
        data: annotation.data,
        ...(annotation.position && { position: annotation.position }),
        ...(annotation.color && { color: annotation.color }),
        ...(annotation.thickness !== undefined && { thickness: annotation.thickness }),
        isVisible: annotation.isVisible,
        createdAt: annotation.createdAt,
        updatedAt: annotation.updatedAt,
      };
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.createAnnotation');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.createAnnotation');
    }
  }

  @Get('annotations/:consultationId')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get annotations',
    description: 'Get all annotations for a consultation',
  })
  async getAnnotations(
    @Param('consultationId') consultationId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.annotationService.getAnnotations(consultationId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getAnnotations');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getAnnotations');
    }
  }

  @Delete('annotations/:annotationId')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'delete')
  @ApiOperation({
    summary: 'Delete annotation',
    description: 'Delete a screen annotation',
  })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async deleteAnnotation(
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
    @Body() _dto: DeleteAnnotationDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    const caller = await this.authorizeByLookup(
      () => this.annotationService.getAnnotationConsultationId(annotationId),
      'VideoController.deleteAnnotation',
      req
    );
    try {
      await this.annotationService.deleteAnnotation(annotationId, caller.userId);
      return new SuccessResponseDto('Annotation deleted successfully');
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.deleteAnnotation');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.deleteAnnotation');
    }
  }

  // ============================================================================
  // TRANSCRIPTION ENDPOINTS
  // ============================================================================

  @Post('transcription')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'create')
  @ApiOperation({
    summary: 'Create transcription',
    description:
      'Create a transcription segment for a video consultation. Clinical staff only: the transcript can later be saved to the EHR, so a patient must not be able to write it. The speaker is always the authenticated caller; a speakerId in the body is ignored.',
  })
  @ApiResponse({ status: 201, type: TranscriptionResponseDto })
  async createTranscription(
    @Body() dto: CreateTranscriptionDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<TranscriptionResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      // The speaker comes from the token, never from the free-text field of the body.
      return await this.transcriptionService.createTranscription({
        ...dto,
        speakerId: caller.userId,
      });
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.createTranscription');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.createTranscription');
    }
  }

  @Get('transcription/:consultationId')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get transcript',
    description: 'Get full transcript for a video consultation',
  })
  async getTranscript(
    @Param('consultationId') consultationId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.transcriptionService.getTranscript(consultationId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getTranscript');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getTranscript');
    }
  }

  @Get('transcription/:consultationId/search')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Search transcript',
    description: 'Search the transcript for specific text',
  })
  async searchTranscript(
    @Param('consultationId') consultationId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('q') query: string
  ) {
    await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.transcriptionService.searchTranscript(consultationId, query);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.searchTranscript');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.searchTranscript');
    }
  }

  @Post('transcription/:consultationId/save-to-ehr')
  @HttpCode(HttpStatus.OK)
  @Roles(...VIDEO_CLINICAL_STAFF_ROLES)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Save transcript to EHR',
    description: 'Save the full transcript to Electronic Health Records',
  })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async saveTranscriptToEHR(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() _dto: SaveTranscriptToEHRDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ ehrRecordId: string }> {
    const caller = await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.transcriptionService.saveToEHR(consultationId, caller.userId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.saveTranscriptToEHR');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.saveTranscriptToEHR');
    }
  }

  // ============================================================================
  // QUALITY MONITORING ENDPOINTS
  // ============================================================================

  @Post('quality/update')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Update quality metrics',
    description: 'Update call quality metrics (network, video, audio)',
  })
  @ApiResponse({ status: 200, type: QualityMetricsResponseDto })
  async updateQualityMetrics(
    @Body() dto: UpdateQualityMetricsDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<QualityMetricsResponseDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      return await this.qualityService.updateQualityMetrics({ ...dto, userId: caller.userId });
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.updateQualityMetrics');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.updateQualityMetrics');
    }
  }

  @Get('quality/:consultationId/:userId')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get quality metrics',
    description: 'Get quality metrics for a participant',
  })
  async getQualityMetrics(
    @Param('consultationId') consultationId: string,
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const caller = await this.authorizeConsultationRequest(consultationId, req);
    if (caller.userRole === 'patient' && userId !== caller.userId) {
      // Staff may read any participant's call quality; a patient only their own.
      throw new ForbiddenException('You can only view your own call quality.');
    }
    try {
      return await this.qualityService.getQualityMetrics(consultationId, userId);
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getQualityMetrics');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getQualityMetrics');
    }
  }

  // ============================================================================
  // VIRTUAL BACKGROUND ENDPOINTS
  // ============================================================================

  @Post('virtual-background')
  @HttpCode(HttpStatus.OK)
  @RequireResourcePermission('video', 'update')
  @ApiOperation({
    summary: 'Update virtual background',
    description: 'Update virtual background settings (blur, custom image, etc.)',
  })
  @ApiResponse({ status: 200, type: VirtualBackgroundSettingsDto })
  async updateVirtualBackground(
    @Body() dto: VirtualBackgroundSettingsDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VirtualBackgroundSettingsDto> {
    const caller = await this.authorizeConsultationRequest(dto.consultationId, req);
    try {
      return await this.virtualBackgroundService.updateBackgroundSettings({
        ...dto,
        userId: caller.userId,
      });
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.updateVirtualBackground');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.updateVirtualBackground');
    }
  }

  @Get('virtual-background/:consultationId')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get virtual background settings',
    description: 'Get the current virtual background settings for the authenticated user',
  })
  @ApiResponse({ status: 200, type: VirtualBackgroundSettingsDto })
  async getVirtualBackground(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VirtualBackgroundSettingsDto | null> {
    const authenticatedUser = await this.authorizeConsultationRequest(consultationId, req);
    try {
      return await this.virtualBackgroundService.getBackgroundSettings(
        consultationId,
        authenticatedUser.userId
      );
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getVirtualBackground');
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getVirtualBackground');
    }
  }

  @Get('virtual-background/presets')
  @RequireResourcePermission('video', 'read')
  @ApiOperation({
    summary: 'Get background presets',
    description: 'Get available virtual background presets',
  })
  @ApiResponse({ status: 200, type: [BackgroundPresetResponseDto] })
  getBackgroundPresets(): BackgroundPresetResponseDto[] {
    try {
      return this.virtualBackgroundService.getBackgroundPresets();
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, 'VideoController.getBackgroundPresets');
        throw error;
      }
      throw this.errors.internalServerError('VideoController.getBackgroundPresets');
    }
  }

  // ============================================================================
  // SUPER ADMIN MONITORING & CONTROL
  // ============================================================================

  @Get('admin/sessions')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({
    summary: 'List all active video sessions (Super Admin)',
    description: 'Global monitoring of all active video consultations across all clinics.',
  })
  @ApiResponse({ status: 200, type: [VideoConsultationSessionDto] })
  async listAllActiveSessions(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSession[]> {
    // SUPER_ADMIN monitors every clinic; a CLINIC_ADMIN only sees (and, fail-closed, only with) a
    // clinic of their own: the list carries meeting links, room names and participants.
    const { clinicId, rawRole } = this.getVideoCallerContext(req);
    const isSuperAdmin = String(rawRole ?? '').toUpperCase() === String(Role.SUPER_ADMIN);
    if (!isSuperAdmin && !clinicId) {
      throw new ForbiddenException('A clinic context is required to list video sessions.');
    }
    try {
      return await this.videoService.listAllActiveSessions(isSuperAdmin ? undefined : clinicId);
    } catch (_error) {
      throw this.errors.internalServerError('VideoController.listAllActiveSessions');
    }
  }

  @Post('admin/sessions/:id/terminate')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force terminate session (Super Admin, Clinic Admin)',
    description:
      "Forcefully close a running video session for security or policy enforcement: the provider room is closed (everyone is disconnected) and the session is ended. The appointment itself is not completed. A SUPER_ADMIN may terminate any clinic's session, a CLINIC_ADMIN only their own clinic's.",
  })
  @ApiParam({ name: 'id', description: 'Appointment ID' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such session in your scope' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The video provider of this session cannot terminate it',
  })
  async terminateSession(
    @Param('id') appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SuccessResponseDto> {
    const context = 'VideoController.terminateSession';
    try {
      const { userId } = this.getAuthenticatedVideoUser(req);
      await this.videoService.terminateConsultation(
        appointmentId,
        userId,
        // SUPER_ADMIN is the only role that may act outside a clinic context; a CLINIC_ADMIN is
        // held to the clinic of the request.
        this.getVideoCallerContext(req)
      );
      return new SuccessResponseDto('Session terminated successfully');
    } catch (error) {
      if (error instanceof HealthcareError) {
        this.errors.handleError(error, context);
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.errors.internalServerError(context);
    }
  }

  @Get('admin/provider-settings')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get global video provider setting',
    description: 'Get the system-wide default video provider used when clinics do not override it.',
  })
  @ApiResponse({ status: 200 })
  async getGlobalVideoProviderSetting(): Promise<VideoProviderSettingResponse> {
    try {
      return await this.videoService.getGlobalVideoProviderSetting();
    } catch (_error) {
      throw this.errors.internalServerError('VideoController.getGlobalVideoProviderSetting');
    }
  }

  @Put('admin/provider-settings')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update global video provider setting',
    description:
      'Update the system-wide default video provider used for clinics without overrides.',
  })
  @ApiResponse({ status: 200 })
  async updateGlobalVideoProviderSetting(
    @Body('provider') provider: VideoProviderType
  ): Promise<VideoProviderSettingResponse> {
    try {
      return await this.videoService.updateGlobalVideoProviderSetting(provider);
    } catch (_error) {
      throw this.errors.internalServerError('VideoController.updateGlobalVideoProviderSetting');
    }
  }
}
