import { nowIso, IST_TIMEZONE } from '@utils/date-time.util';
import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  HttpStatus,
  HttpCode,
  HttpException,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
  BadRequestException,
  ForbiddenException,
  Inject,
  Optional,
  forwardRef,
  Res,
  ServiceUnavailableException,
  UseInterceptors,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentResponseRedactionInterceptor } from './core/appointment-response-redaction.interceptor';
import {
  assertAppointmentResultOk,
  assertUnknownAppointmentResultOk,
} from './core/appointment-result-http.util';
// HealthService removed - unused in controller
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
  ApiHeader,
  ApiConsumes,
  ApiProduces,
  ApiExtraModels,
} from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { Role, AppointmentStatus, AppointmentType } from '@core/types/enums.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ClinicRoute } from '@core/decorators/clinic-route.decorator';
import { HealthcareErrorsService, HealthcareError } from '@core/errors';
import { logLevelForError } from '@core/errors/error-severity.util';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import {
  Cache,
  PatientCache,
  InvalidatePatientCache,
  InvalidateAppointmentCache,
  InvalidateAppointmentCacheByTags,
  Public,
} from '@core/decorators';
import { startOfIstDay } from '../../libs/utils/clock.util';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
  AppointmentListResponseDto,
  DoctorAvailabilityResponseDto,
  AppointmentFilterDto,
  CompleteAppointmentDto,
  BulkCompleteAppointmentDto,
  ScheduleFollowUpDto,
  AppointmentChainResponseDto,
  FollowUpPlanResponseDto,
  CreateRecurringSeriesDto,
  UpdateRecurringSeriesDto,
  RecurringSeriesResponseDto,
  UpdateFollowUpPlanDto,
  UpdateAppointmentStatusDto,
  ReassignAppointmentDoctorDto,
  AppointmentReassignmentCandidatesResponseDto,
  UpdateAssistantDoctorCoverageDto,
  AssistantDoctorCoverageResponseDto,
  ProcessCheckInDto,
  ProposeVideoSlotsDto,
  ConfirmVideoSlotDto,
  ConfirmVideoFinalSlotDto,
  RejectVideoProposalDto,
  AppointmentServiceCatalogResponseDto,
  MarkNoShowDto,
  AppointmentDailySummaryDto,
} from '@dtos/appointment.dto';
import {
  ScanLocationQRDto,
  ScanLocationQRResponseDto,
  LocationQRCodeResponseDto,
  ForceCheckInDto,
  CreateCheckInLocationRequestDto,
  UpdateCheckInLocationRequestDto,
} from '@dtos/appointment.dto';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { VideoService } from '@services/video/video.service';
import { CheckInService } from './plugins/checkin/check-in.service';
import { AppointmentQueueService } from '@infrastructure/queue';
import {
  CheckInLocationService,
  type CheckInAppointmentSummary,
  type ProcessedCheckIn,
} from './plugins/therapy/check-in-location.service';
import { RegenerateLocationQrDto } from '@services/clinic-ops/dto/clinic-ops.dto';
import { CheckInLogService } from '@services/clinic-ops/services/check-in-log.service';
import { computeCheckInWindow } from '@utils/in-person-flow.util';
import { CHECK_IN_EVENT_NAMES, buildCheckInEventPayload } from './core/check-in-events.util';
import { InPersonCheckInService } from './in-person/in-person-check-in.service';
import type { InPersonCheckInResult } from './in-person/in-person.types';
import { InPersonDeskService } from './in-person/in-person-desk.service';
import {
  buildAppointmentDetailCacheKey,
  buildAppointmentListCacheKey,
  buildClinicScopedCacheKey,
  buildMyUpcomingCacheKey,
  buildUserUpcomingCacheKey,
} from './appointment-list-cache-key';
import { AppointmentAnalyticsService } from './plugins/analytics/appointment-analytics.service';
import { QrService, LocationQrService } from '@utils/QR';
import { FastifyReply } from 'fastify';

// Use centralized types
import type {
  AppointmentFilters,
  ServiceResponse,
  CheckInLocation,
  CheckedInAppointmentsResponse,
} from '@core/types/appointment.types';
import type { AppointmentWithRelations } from '@core/types/database.types';
import { isBillingBlindRole, stripBillingFields } from '@core/interceptors/billing-redaction.util';
import { unverifiedRoleClaim } from '@core/interceptors/public-role-claim.util';

type CheckInServiceInput = Parameters<CheckInLocationService['processCheckIn']>[0];

/**
 * Cache entries a check-in changes: the appointment detail and the patient's lists. Tags only
 * (no keyspace SCAN per check-in): those reads are all registered in these tag sets.
 */
const CHECK_IN_CACHE_TAGS = [
  'appointments',
  'appointment_data',
  'appointment_details',
  'upcoming_appointments',
  'my_appointments',
  'check_in',
];

/**
 * Largest page the list endpoints serve. Staff dashboards ask for a whole day/week at once
 * (limit=200..500); the previous silent clamp to 100 dropped rows without telling the caller.
 */
export const APPOINTMENT_LIST_MAX_LIMIT = 500;
/** Rows returned when the caller sends no `limit` (unchanged historical default). */
const APPOINTMENT_LIST_DEFAULT_LIMIT = 20;

/** Clamps a requested page size into [1, APPOINTMENT_LIST_MAX_LIMIT]; `undefined` keeps the default. */
export function resolveAppointmentPageSize(limit: unknown): number {
  if (limit === undefined || limit === null || limit === '') return APPOINTMENT_LIST_DEFAULT_LIMIT;
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return APPOINTMENT_LIST_DEFAULT_LIMIT;
  return Math.min(APPOINTMENT_LIST_MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

/** Validates an optional `type` query value against the AppointmentType enum (case-insensitive). */
export function parseAppointmentTypeFilter(type: unknown): AppointmentType | undefined {
  if (type === undefined || type === null || type === '') return undefined;
  if (typeof type !== 'string') {
    throw new BadRequestException(
      `type must be one of ${Object.values(AppointmentType).join(', ')}`
    );
  }
  const normalized = type.trim().toUpperCase();
  const match = Object.values(AppointmentType).find(value => String(value) === normalized);
  if (!match) {
    throw new BadRequestException(
      `type must be one of ${Object.values(AppointmentType).join(', ')}`
    );
  }
  return match;
}

@ApiTags('appointments')
@Controller('appointments')
@ApiExtraModels(
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
  AppointmentListResponseDto,
  AppointmentFilterDto,
  ScheduleFollowUpDto,
  FollowUpPlanResponseDto,
  AppointmentChainResponseDto,
  RecurringSeriesResponseDto,
  AppointmentServiceCatalogResponseDto,
  AppointmentReassignmentCandidatesResponseDto,
  AssistantDoctorCoverageResponseDto,
  UpdateAssistantDoctorCoverageDto,
  ConfirmVideoSlotDto,
  ConfirmVideoFinalSlotDto,
  RejectVideoProposalDto,
  ScanLocationQRDto,
  ScanLocationQRResponseDto,
  LocationQRCodeResponseDto
)
@ApiBearerAuth()
@ApiSecurity('session-id')
@ApiHeader({
  name: 'X-Clinic-ID',
  description: 'Clinic identifier',
  required: true,
})
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
// No credential (password hash ...) ever leaves an appointment route; reception gets no clinical keys.
@UseInterceptors(AppointmentResponseRedactionInterceptor)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  })
)
export class AppointmentsController {
  constructor(
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentService: AppointmentsService,
    @Inject(forwardRef(() => HealthcareErrorsService))
    private readonly errors: HealthcareErrorsService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => VideoService))
    private readonly videoService: VideoService,
    @Inject(forwardRef(() => CheckInService))
    private readonly checkInService: CheckInService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly appointmentQueueService: AppointmentQueueService,
    @Inject(forwardRef(() => CheckInLocationService))
    private readonly checkInLocationService: CheckInLocationService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    @Inject(forwardRef(() => QrService))
    private readonly qrService: QrService,
    @Inject(forwardRef(() => LocationQrService))
    private readonly locationQrService: LocationQrService,
    @Inject(forwardRef(() => AppointmentAnalyticsService))
    private readonly analyticsService: AppointmentAnalyticsService,
    // Optional: the check-in log must never be a reason a scan cannot run.
    @Optional() private readonly checkInLog?: CheckInLogService,
    // V2: the one shared in-person check-in (QR + reception one-click). Optional for old harnesses.
    @Optional()
    @Inject(forwardRef(() => InPersonCheckInService))
    private readonly inPersonCheckIn?: InPersonCheckInService,
    // Undo a mistaken no-show (PATCH status back to CONFIRMED / SCHEDULED). Optional for harnesses.
    @Optional()
    @Inject(forwardRef(() => InPersonDeskService))
    private readonly inPersonDesk?: InPersonDeskService
  ) {}

  private parseStatusFilter(status?: string): {
    status?: AppointmentStatus;
    statusList?: AppointmentStatus[];
  } {
    if (!status) return {};

    const statuses = status
      .split(',')
      .map(value => value.trim().toUpperCase())
      .filter((value): value is AppointmentStatus =>
        Object.values(AppointmentStatus).includes(value as AppointmentStatus)
      );

    if (statuses.length === 0) return {};
    if (statuses.length === 1) return { status: statuses[0] as AppointmentStatus };
    return { statusList: statuses };
  }

  private async emitCheckInEvents(params: {
    appointmentId: string;
    clinicId: string;
    patientId?: string;
    doctorId?: string;
    locationId?: string;
    checkedInBy: string;
    checkInMethod: string;
    source: string;
    notes?: string;
    overrideReason?: string;
  }): Promise<void> {
    // One payload shape for every check-in path (see core/check-in-events.util).
    const payload = buildCheckInEventPayload(params);
    for (const name of CHECK_IN_EVENT_NAMES) {
      await this.eventService.emit(name, payload);
    }
  }

  /**
   * The arrival step shared by POST :id/force-check-in and POST :id/check-in, run on an
   * appointment the caller was already authorized for (`getAppointmentForCheckIn`). Everything
   * goes through `CheckInLocationService.processCheckIn`: atomic SCHEDULED -> CONFIRMED + CheckIn
   * row + an entry in the doctor's live queue, idempotent, and a queue failure is a 503.
   *
   * The location is always the appointment's own. A PATIENT never names one; staff may name one
   * only for an appointment that has none (`strictLocation` also rejects a different one).
   * Only a patient proves presence (within 200 m); staff coordinates are neither required nor read.
   * Events are emitted when this call changed something: a new arrival, or a repair of a queue
   * entry that an earlier, failed attempt never created.
   */
  private async performInPersonCheckIn(params: {
    appointment: CheckInAppointmentSummary;
    clinicId: string;
    userId: string;
    userRole: string;
    requestedLocationId?: string | undefined;
    strictLocation: boolean;
    coordinates?: unknown;
    deviceInfo?: Record<string, unknown> | undefined;
    checkInMethod: string;
    source: string;
    notes?: string | undefined;
    overrideReason?: string | undefined;
    context: string;
  }): Promise<ProcessedCheckIn> {
    const { appointment, clinicId, userId, userRole, context } = params;
    const isPatientCaller = userRole === String(Role.PATIENT);

    if (
      params.strictLocation &&
      !isPatientCaller &&
      params.requestedLocationId &&
      appointment.locationId &&
      params.requestedLocationId !== appointment.locationId
    ) {
      throw this.errors.validationError(
        'locationId',
        'The location does not match the appointment location',
        context
      );
    }
    const locationId =
      appointment.locationId || (isPatientCaller ? undefined : params.requestedLocationId);
    if (!locationId) {
      throw this.errors.validationError(
        'locationId',
        'This appointment has no clinic location to check in at',
        context
      );
    }

    const checkInData: CheckInServiceInput = {
      appointmentId: appointment.id,
      locationId,
      patientId: appointment.patientId || userId,
    };
    // The value is passed on as sent: the service parses it and answers a missing, malformed or
    // out-of-range position with the same single 403 as one that is too far away.
    if (isPatientCaller) {
      checkInData.coordinates = params.coordinates as { lat: number; lng: number };
    }
    if (params.deviceInfo) {
      checkInData.deviceInfo = params.deviceInfo;
    }

    const checkIn = await this.checkInLocationService.processCheckIn(checkInData, clinicId, {
      actor: { userId, role: userRole },
      presence: isPatientCaller ? 'required' : 'skip',
    });

    if (!checkIn.alreadyCheckedIn || checkIn.queueRepaired) {
      await this.emitCheckInEvents({
        appointmentId: appointment.id,
        clinicId,
        patientId: appointment.patientId || userId,
        checkedInBy: userId,
        checkInMethod: params.checkInMethod,
        source: params.source,
        locationId,
        ...(appointment.doctorId ? { doctorId: appointment.doctorId } : {}),
        ...(params.notes ? { notes: params.notes } : {}),
        ...(params.overrideReason ? { overrideReason: params.overrideReason } : {}),
      });
    }

    return checkIn;
  }

  /** Best effort: the queue position is informational and never fails a check-in. */
  private async lookupQueuePosition(
    appointmentId: string,
    clinicId: string,
    context: string
  ): Promise<{ position: number; totalInQueue: number; estimatedWaitTime: number } | null> {
    try {
      const queueResponse = await this.appointmentQueueService.getPatientQueuePosition(
        appointmentId,
        clinicId,
        'clinic' // Live queue domain used by AppointmentQueueService.checkIn
      );

      if (queueResponse && typeof queueResponse === 'object' && 'position' in queueResponse) {
        const response = queueResponse as {
          position?: number;
          totalInQueue?: number;
          estimatedWaitTime?: number;
        };
        return {
          position: response.position || 0,
          totalInQueue: response.totalInQueue || 0,
          estimatedWaitTime: response.estimatedWaitTime || 0,
        };
      }
    } catch (queueError) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to get queue position after check-in',
        context,
        {
          appointmentId,
          error: queueError instanceof Error ? queueError.message : String(queueError),
        }
      );
    }
    return null;
  }

  /**
   * Manually trigger no-show cancellation check
   * Useful for testing or on-demand checks
   */
  @Post('noshow/check')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD, Role.RECEPTIONIST)
  @RequireResourcePermission('appointments', 'update')
  @ApiOperation({
    summary: 'Trigger manual no-show check',
    description:
      'Manually trigger the background no-show cancellation process for missed appointments.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'No-show check executed successfully',
  })
  async triggerNoShowCheck(
    @Request() req: ClinicAuthenticatedRequest,
    @Body()
    settings?: {
      checkDaysBefore?: number;
      checkStatuses?: string[];
      sendPatientNotifications?: boolean;
      clinicId?: string;
    }
  ): Promise<{
    totalChecked: number;
    cancelled: number;
    failed: number;
    details: Array<{
      appointmentId: string;
      patientId: string;
      doctorId: string;
      appointmentDate: Date;
      reason: string;
    }>;
  }> {
    const clinicId = req?.clinicContext?.clinicId;

    const result = await this.appointmentService.processNoShowCancellations({
      ...settings,
      ...(clinicId ? { clinicId } : {}),
    });

    return result;
  }

  @Post()
  @RateLimitAPI()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    Role.PATIENT,
    Role.RECEPTIONIST,
    Role.DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'create')
  @InvalidateAppointmentCache({
    patterns: [
      'appointments:*',
      'patient:*:appointments',
      'doctor:*:appointments',
      'clinic:*:appointments',
    ],
    tags: ['appointments', 'appointment_data'],
  })
  @ApiOperation({
    summary: 'Create a new appointment',
    description:
      'Create a new appointment with the specified details. Patients can create their own appointments, while staff can create appointments for patients. Requires valid clinic context and appropriate permissions.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: () => CreateAppointmentDto,
    description: 'Appointment creation data',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Appointment created successfully',
    type: () => AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid appointment data or validation errors',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions or invalid clinic context',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Doctor not available at requested time',
  })
  async createAppointment(
    @Body() appointmentData: CreateAppointmentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Creating appointment for user ${userId} in clinic ${clinicId}`,
        'AppointmentsController',
        { userId, clinicId }
      );

      // A refused booking is an HTTP error (400 / 409), never a 201 with success: false.
      const result = assertAppointmentResultOk(
        await this.appointmentService.createAppointment(
          appointmentData,
          userId,
          clinicId,
          req.user?.role || Role.PATIENT
        )
      );

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Appointment created successfully: ${result.success ? 'Success' : 'Failed'}`,
        'AppointmentsController',
        {
          appointmentId: result.data && 'id' in result.data ? String(result.data['id']) : undefined,
          success: result.success,
        }
      );
      return {
        success: result.success,
        ...(result.data && {
          data: result.data as unknown as AppointmentResponseDto,
        }),
        message: result.message,
        ...(result.error && { error: result.error }),
      };
    } catch (_error) {
      const errorUserId = req.user?.sub || '';
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        // A 409 "slot is being booked" / 400 refusal is expected traffic: WARN, not ERROR.
        logLevelForError(_error),
        `Failed to create appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsController',
        {
          userId: errorUserId,
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );

      if (_error instanceof BadRequestException) {
        throw _error;
      }

      if (_error instanceof Error && _error.message.includes('not available')) {
        throw new BadRequestException(_error.message);
      }

      throw _error;
    }
  }

  @Get('services/catalog')
  @Public()
  @ApiOperation({
    summary: 'Get backend-owned appointment service catalog',
    description:
      'Returns appointment and treatment metadata used by frontend booking, queue, and role dashboards. ' +
      'Every catalog entry is returned; `bookable` marks the services a patient can pick in the booking ' +
      'dialog for the clinic in X-Clinic-ID (clinic setting appointmentSettings.bookableTreatmentTypes, ' +
      'default GENERAL_CONSULTATION, FOLLOW_UP, SPECIAL_CASE, GERIATRIC_CARE).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment service catalog retrieved successfully',
    type: () => AppointmentServiceCatalogResponseDto,
  })
  async getAppointmentServiceCatalog(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentServiceCatalogResponseDto>> {
    const services = await this.appointmentService.getAppointmentServiceCatalogForClinic(
      req?.clinicContext?.clinicId
    );

    const response = {
      success: true,
      data: { services },
      message: 'Appointment service catalog retrieved successfully',
    };
    // Public route: request.user is never set, so the global billing-redaction interceptor cannot
    // see a DOCTOR / ASSISTANT_DOCTOR here. Strip the fees for those roles from the token claim
    // (patients keep the video fee they need to book).
    return isBillingBlindRole(unverifiedRoleClaim(req)) ? stripBillingFields(response) : response;
  }

  @Get('assistant-coverage')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ClinicRoute()
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 30, duration: 60 })
  @ApiOperation({
    summary: 'Get assistant doctor coverage configuration',
    description:
      'Returns clinic-level assistant-doctor coverage assignments using the normalized relational model.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Assistant doctor coverage fetched successfully',
    type: () => AssistantDoctorCoverageResponseDto,
  })
  async getAssistantDoctorCoverage(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AssistantDoctorCoverageResponseDto>> {
    const clinicId = req.clinicContext?.clinicId || '';
    const entries = await this.appointmentService.getClinicAssistantDoctorCoverage(clinicId);

    return {
      success: true,
      data: { entries },
      message: 'Assistant doctor coverage fetched successfully',
    };
  }

  @Put('assistant-coverage')
  @Roles(Role.CLINIC_ADMIN)
  @ClinicRoute()
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Persist assistant doctor coverage configuration',
    description:
      'Stores clinic-level assistant-doctor coverage assignments in the normalized relational model.',
  })
  @ApiBody({ type: () => UpdateAssistantDoctorCoverageDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Assistant doctor coverage saved successfully',
    type: () => AssistantDoctorCoverageResponseDto,
  })
  async updateAssistantDoctorCoverage(
    @Body(ValidationPipe) dto: UpdateAssistantDoctorCoverageDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AssistantDoctorCoverageResponseDto>> {
    const clinicId = req.clinicContext?.clinicId || '';
    await this.appointmentService.syncClinicAssistantDoctorCoverage(clinicId, dto.entries);
    const entries = await this.appointmentService.getClinicAssistantDoctorCoverage(clinicId);

    return {
      success: true,
      data: { entries },
      message: 'Assistant doctor coverage saved successfully',
    };
  }

  @Post('video/propose')
  @RateLimitAPI()
  @HttpCode(HttpStatus.CREATED)
  // V2: reception never books video visits; patients book them in the app.
  @Roles(Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'create')
  @InvalidateAppointmentCache({
    patterns: [
      'appointments:*',
      'patient:*:appointments',
      'doctor:*:appointments',
      'clinic:*:appointments',
    ],
    tags: ['appointments', 'appointment_data'],
  })
  @ApiOperation({
    summary: 'Propose video appointment with time slots',
    description:
      'Patient proposes 3-4 time slots for a video appointment. Doctor will select one to confirm.',
  })
  @ApiBody({ type: () => ProposeVideoSlotsDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Video appointment proposed successfully',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid slots or validation error' })
  async proposeVideoAppointment(
    @Body() dto: ProposeVideoSlotsDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub;
    if (!clinicId || !userId) {
      throw new BadRequestException('Clinic context and user ID are required');
    }
    const result = await this.appointmentService.proposeVideoAppointment(
      { ...dto, clinicId },
      userId,
      clinicId
    );
    return {
      success: result.success,
      data: result.data as unknown as AppointmentResponseDto,
      message: result.message || 'Video appointment proposed successfully',
    };
  }

  @Post(':id/video/confirm-slot')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @InvalidateAppointmentCache({
    patterns: ['appointments:*', 'appointment:*'],
    tags: ['appointments', 'appointment_data'],
  })
  @InvalidatePatientCache({
    patterns: ['appointments:detail:*', 'appointments:my:*', 'appointments:upcoming:*'],
    tags: ['appointments', 'appointment_details', 'patient_appointments', 'upcoming_appointments'],
  })
  @ApiOperation({
    summary: 'Confirm video appointment slot',
    description:
      "Doctor selects one of the patient's proposed time slots to confirm the appointment.",
  })
  @ApiParam({ name: 'id', description: 'Appointment ID' })
  @ApiBody({ type: () => ConfirmVideoSlotDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Slot confirmed successfully' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid slot index or appointment state',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Appointment not found' })
  async confirmVideoSlot(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() dto: ConfirmVideoSlotDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub;
    if (!clinicId || !userId) {
      throw new BadRequestException('Clinic context and user ID are required');
    }
    const result = await this.appointmentService.confirmVideoSlot(
      appointmentId,
      dto,
      userId,
      clinicId
    );
    return {
      success: result.success,
      data: result.data as unknown as AppointmentResponseDto,
      message: result.message ?? 'Video appointment proposal rejected successfully',
    };
  }

  @Post(':id/video/confirm-final-slot')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @InvalidateAppointmentCache({
    patterns: ['appointments:*', 'appointment:*'],
    tags: ['appointments', 'appointment_data'],
  })
  @InvalidatePatientCache({
    patterns: ['appointments:detail:*', 'appointments:my:*', 'appointments:upcoming:*'],
    tags: ['appointments', 'appointment_details', 'patient_appointments', 'upcoming_appointments'],
  })
  @ApiOperation({
    summary: 'Confirm the final video slot',
    description:
      "Doctor can either confirm one of the patient's proposed slots or set a custom final slot and finalize the appointment.",
  })
  @ApiParam({ name: 'id', description: 'Appointment ID' })
  @ApiBody({ type: () => ConfirmVideoFinalSlotDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Final video slot confirmed successfully' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid slot, appointment state, or time selection',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Appointment not found' })
  async confirmFinalVideoSlot(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) dto: ConfirmVideoFinalSlotDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub;
    if (!clinicId || !userId) {
      throw new BadRequestException('Clinic context and user ID are required');
    }

    const result = await this.appointmentService.confirmFinalVideoSlot(
      appointmentId,
      dto,
      userId,
      clinicId
    );

    return {
      success: result.success,
      data: result.data as unknown as AppointmentResponseDto,
      message: result.message ?? 'Final video slot confirmed successfully',
    };
  }

  @Post(':id/video/reject')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'delete')
  @InvalidateAppointmentCache({
    patterns: ['appointments:*', 'appointment:*'],
    tags: ['appointments', 'appointment_data'],
  })
  @ApiOperation({
    summary: 'Reject video appointment proposal',
    description:
      'Doctor rejects the proposed video slots. The appointment is cancelled and refunds are triggered automatically.',
  })
  @ApiParam({ name: 'id', description: 'Appointment ID' })
  @ApiBody({ type: () => RejectVideoProposalDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Video appointment proposal rejected and refund triggered',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request or missing clinic/user context',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Appointment not found' })
  async rejectVideoProposal(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() dto: RejectVideoProposalDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub;
    if (!clinicId || !userId) {
      throw new BadRequestException('Clinic context and user ID are required');
    }

    const result = await this.videoService.rejectVideoAppointment(
      appointmentId,
      dto.reason,
      userId,
      clinicId
    );

    return {
      success: result.success,
      data: result.data as unknown as AppointmentResponseDto,
      message: result.message ?? 'Video appointment proposal rejected successfully',
    };
  }

  @Get('my-appointments')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  // This was the one appointment-list route in this controller with no
  // caching at all (contrast with the @PatientCache/@Cache-decorated list
  // endpoints elsewhere in this file) - every hit went straight to the DB,
  // even though it's the single most-called endpoint from the patient
  // dashboard/appointments page. clinicId is intentionally left out of the
  // key template: it's resolved via ClinicGuard into clinicContext rather
  // than a route/query param, so the interceptor can't read it here -
  // {userId} plus the handler-name suffix (added automatically) already
  // scope the key correctly per patient.
  // The key is built from the authenticated caller and the resolved clinic only (see
  // appointment-list-cache-key.ts). The interceptor's keyTemplate substitution lets a `?userId=`
  // query value win over the JWT, which let one patient read or poison another patient's list.
  @PatientCache({
    customKeyGenerator: context => buildAppointmentListCacheKey(context, 'my'),
    ttl: 300,
    tags: ['appointments', 'my_appointments'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get current user appointments',
    description:
      'Get appointments for the currently authenticated patient. Only returns appointments for the authenticated user.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filter by appointment date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Filter appointments from this date (inclusive, YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Filter appointments up to this date (inclusive, YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Number of items per page (max ${APPOINTMENT_LIST_MAX_LIMIT})`,
    type: Number,
  })
  @ApiQuery({ name: 'doctorId', required: false, description: 'Only visits with this doctor' })
  @ApiQuery({ name: 'locationId', required: false, description: 'Only visits at this location' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: AppointmentType,
    description: 'Only visits of this type (IN_PERSON, VIDEO_CALL, ...)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return user appointments',
    type: () => AppointmentListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only patients can access this endpoint',
  })
  async getMyAppointments(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('doctorId') doctorId?: string,
    @Query('locationId') locationId?: string,
    @Query('type') type?: string
  ): Promise<ServiceResponse<AppointmentListResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const queryClinicId = (req.query as { clinicId?: string } | undefined)?.clinicId;
      const userId = req.user?.sub;
      const role = req.user?.role || Role.PATIENT;
      // ClinicGuard resolves CL0002-style public clinic codes to the canonical clinic UUID.
      // Prefer that validated UUID so frontend filter params cannot force a code-based DB query.
      const resolvedClinicId = clinicId || queryClinicId;

      if (!userId) {
        throw new BadRequestException('User ID not found');
      }

      if (!resolvedClinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      const typeFilter = parseAppointmentTypeFilter(type);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting appointments for user ${userId} in clinic ${resolvedClinicId}`,
        'AppointmentsController',
        { userId, clinicId: resolvedClinicId }
      );

      const filters: AppointmentFilters & {
        statusList?: AppointmentStatus[];
        type?: AppointmentType;
      } = {
        userId,
        clinicId: resolvedClinicId,
        ...this.parseStatusFilter(status),
        ...(date && { date }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        // The patient's own list is already pinned to the caller; these only narrow it further.
        ...(doctorId?.trim() && { doctorId: doctorId.trim() }),
        ...(locationId?.trim() && { locationId: locationId.trim() }),
        ...(typeFilter && { type: typeFilter }),
        page: Math.max(1, page),
        limit: resolveAppointmentPageSize(limit),
      };

      // Pass pagination through: without it the service always returned page 1 / 20 rows.
      // A request that sends no `limit` keeps the 20 rows it has always received.
      const hasExplicitLimit = (req.query as { limit?: unknown } | undefined)?.limit !== undefined;
      const pageNumber = Number.isFinite(Number(filters.page))
        ? Math.max(1, Math.floor(Number(filters.page)))
        : 1;
      const pageSize = hasExplicitLimit
        ? resolveAppointmentPageSize(filters.limit)
        : resolveAppointmentPageSize(undefined);

      const result = await this.appointmentService.getAppointments(
        filters as AppointmentFilterDto,
        userId || '',
        resolvedClinicId,
        role,
        pageNumber,
        pageSize
      );

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved ${(result.data as unknown as AppointmentResponseDto[])?.length || 0} appointments for user ${userId}`,
        'AppointmentsController',
        { userId, count: (result.data as unknown as AppointmentResponseDto[])?.length || 0 }
      );
      return result as unknown as ServiceResponse<AppointmentListResponseDto>;
    } catch (_error) {
      const errorUserId = req.user?.sub || '';
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get my appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsController',
        {
          userId: errorUserId,
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF,
    Role.PATIENT
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  // Caller + clinic come from the JWT / ClinicGuard, never from query parameters, and the
  // query-supplied patient filter is only part of the key for staff (see appointment-list-cache-key.ts).
  @Cache({
    customKeyGenerator: context => buildAppointmentListCacheKey(context, 'list'),
    ttl: 300,
    tags: ['appointments', 'list'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get all appointments',
    description:
      'Get all appointments with optional filtering. Only clinic staff can access this endpoint. Supports pagination and various filters.',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Filter by patient user ID',
  })
  @ApiQuery({
    name: 'doctorId',
    required: false,
    description: 'Filter by doctor ID',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filter by appointment date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Only appointments on or after this date (YYYY-MM-DD or ISO, IST day)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Only appointments on or before this date (YYYY-MM-DD or ISO, IST day)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Alias of dateFrom (web/mobile dashboards send startDate/endDate)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Alias of dateTo',
  })
  @ApiQuery({
    name: 'patientId',
    required: false,
    description: 'Filter by patient profile ID (Patient.id). Ignored for PATIENT callers.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: AppointmentType,
    description: 'Filter by appointment type (IN_PERSON, VIDEO_CALL, ...)',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by location ID',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Number of items per page (default 20, max ${APPOINTMENT_LIST_MAX_LIMIT}; larger values are clamped)`,
    type: Number,
  })
  @ApiQuery({
    name: 'isFollowUp',
    required: false,
    description: 'Only follow-up appointments ("true") or only non-follow-up ones ("false")',
    type: Boolean,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return all appointments',
    type: () => AppointmentListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only clinic staff can access this endpoint',
  })
  async getAppointments(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('locationId') locationId?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('patientId') patientId?: string,
    @Query('type') type?: string,
    @Query('isFollowUp') isFollowUp?: string
  ): Promise<ServiceResponse<AppointmentListResponseDto>> {
    const context = 'AppointmentsController.getAppointments';
    // startDate/endDate are the names the dashboards send; dateFrom/dateTo stay supported.
    const rangeStart = dateFrom || startDate;
    const rangeEnd = dateTo || endDate;
    for (const [name, value] of [
      [dateFrom ? 'dateFrom' : 'startDate', rangeStart],
      [dateTo ? 'dateTo' : 'endDate', rangeEnd],
    ] as const) {
      if (value && Number.isNaN(Date.parse(value))) {
        throw new BadRequestException(`${name} must be a valid date (YYYY-MM-DD)`);
      }
    }
    const typeFilter = parseAppointmentTypeFilter(type);
    const isFollowUpFilter =
      isFollowUp === 'true' ? true : isFollowUp === 'false' ? false : undefined;

    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;
      const role = req.user?.role || Role.PATIENT;

      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      // A receptionist works at ONE location, taken from the staff assignment on the server (never
      // from the query / header): the list is always that location's appointments.
      const receptionistLocationId =
        String(role) === String(Role.RECEPTIONIST) && currentUserId
          ? await this.appointmentService.resolveReceptionistLocation(currentUserId, clinicId)
          : undefined;

      // Patients can only access their own appointments
      if (req.user?.role === Role.PATIENT) {
        // Override userId to current user's ID to prevent accessing other users' appointments
        userId = currentUserId;
        // A patient cannot point the list at another patient's profile either.
        patientId = undefined;
      }

      const requestSummary = {
        clinicId,
        userId: userId || undefined,
        doctorId: doctorId || undefined,
        patientId: patientId || undefined,
        type: typeFilter,
        status: status || undefined,
        date: date || undefined,
        startDate: rangeStart || undefined,
        endDate: rangeEnd || undefined,
        locationId: locationId || undefined,
        page: Math.max(1, page),
        limit: resolveAppointmentPageSize(limit),
        isFollowUp: isFollowUpFilter,
      };

      // Log the operation with proper structure
      void this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        'Retrieving appointments list',
        context,
        {
          userId: currentUserId,
          clinicId,
          filters: { userId, doctorId, status, date, locationId, page, limit },
          requestSummary,
          operation: 'getAppointments',
        }
      );

      const effectiveLocationId = receptionistLocationId ?? locationId;

      const filters: AppointmentFilters & {
        statusList?: AppointmentStatus[];
        startDate?: string;
        endDate?: string;
        patientId?: string;
        type?: AppointmentType;
      } = {
        ...(userId && { userId }),
        ...(doctorId && { doctorId }),
        ...(patientId?.trim() && { patientId: patientId.trim() }),
        ...(typeFilter && { type: typeFilter }),
        ...this.parseStatusFilter(status),
        ...(date && { date }),
        // Range filter (ignored by the core query when an exact `date` is given).
        ...(!date && rangeStart && { startDate: rangeStart }),
        ...(!date && rangeEnd && { endDate: rangeEnd }),
        ...(effectiveLocationId && { locationId: effectiveLocationId }),
        ...(isFollowUpFilter !== undefined && { isFollowUp: isFollowUpFilter }),
        clinicId,
        page: Math.max(1, page),
        limit: resolveAppointmentPageSize(limit),
      };

      // Pass pagination through: without it the service always returned page 1 / 20 rows.
      // A request that sends no `limit` keeps the 20 rows it has always received.
      const hasExplicitLimit = (req.query as { limit?: unknown } | undefined)?.limit !== undefined;
      const pageNumber = Number.isFinite(Number(filters.page))
        ? Math.max(1, Math.floor(Number(filters.page)))
        : 1;
      const pageSize = hasExplicitLimit
        ? resolveAppointmentPageSize(filters.limit)
        : resolveAppointmentPageSize(undefined);

      const result = await this.appointmentService.getAppointments(
        filters as AppointmentFilterDto,
        currentUserId || '',
        clinicId,
        role,
        pageNumber,
        pageSize
      );

      // Log successful operation
      void this.loggingService.log(
        LogType.RESPONSE,
        LogLevel.INFO,
        `Retrieved ${(result.data as unknown as AppointmentResponseDto[])?.length || 0} appointments successfully`,
        context,
        {
          userId: currentUserId,
          clinicId,
          appointmentCount: (result.data as unknown as AppointmentResponseDto[])?.length || 0,
          responseSummary: {
            appointmentCount: (result.data as unknown as AppointmentResponseDto[])?.length || 0,
            hasPagination: !!(
              result.data &&
              typeof result.data === 'object' &&
              'pagination' in result.data
            ),
          },
          operation: 'getAppointments',
        }
      );

      // Transform result.data to AppointmentListResponseDto format
      // getAppointments returns { appointments: AppointmentWithRelations[], pagination: {...} }
      // Use type-safe transformation without relying on error-prone type assertions
      type AppointmentListData = {
        appointments: AppointmentResponseDto[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
          hasNext: boolean;
          hasPrev: boolean;
        };
      };
      let transformedData: AppointmentListData | undefined;

      if (result.data) {
        const data = result.data;
        if (data && typeof data === 'object' && 'appointments' in data && 'pagination' in data) {
          const appointments = data['appointments'];
          const pagination = data['pagination'];
          if (Array.isArray(appointments) && pagination && typeof pagination === 'object') {
            const paginationObj = pagination as Record<string, unknown>;
            transformedData = {
              appointments: appointments as AppointmentResponseDto[],
              pagination: {
                page: (paginationObj['page'] as number) || 1,
                limit: (paginationObj['limit'] as number) || 20,
                total: (paginationObj['total'] as number) || 0,
                totalPages: (paginationObj['totalPages'] as number) || 0,
                hasNext: (paginationObj['hasNext'] as boolean) || false,
                hasPrev: (paginationObj['hasPrev'] as boolean) || false,
              },
            };
          }
        }

        // Fallback: create structure from array if data is just an array
        if (!transformedData && Array.isArray(data)) {
          transformedData = {
            appointments: data as AppointmentResponseDto[],
            pagination: {
              page: 1,
              limit: data.length,
              total: data.length,
              totalPages: 1,
              hasNext: false,
              hasPrev: false,
            },
          };
        }
      }

      const response: ServiceResponse<AppointmentListData> = {
        success: result.success,
        message: result.message,
      };

      if (transformedData) {
        response.data = transformedData;
      }

      if (result.error) {
        response.error = result.error;
      }

      // Type assertion is safe here because we've validated the structure matches AppointmentListResponseDto
      return response as ServiceResponse<AppointmentListResponseDto>;
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, context);
        throw _error;
      }
      // 403 RECEPTION_WRONG_LOCATION (and other HTTP answers) reach the client as they are.
      if (_error instanceof HttpException) {
        throw _error;
      }

      // Log the error with proper structure
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to retrieve appointments: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        context,
        {
          userId: req.user?.sub,
          clinicId: req.clinicContext?.clinicId,
          filters: { userId, doctorId, status, date, locationId, page, limit },
          _error: _error instanceof Error ? _error.stack : String(_error),
          operation: 'getAppointments',
        }
      );

      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  /**
   * Get current user's upcoming appointments
   * GET /appointments/upcoming
   */
  @Get('upcoming')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @PatientCache({
    // Caller + clinic from the JWT / ClinicGuard; a `?userId=` query value must not pick the key.
    customKeyGenerator: context => buildMyUpcomingCacheKey(context),
    ttl: 600,
    tags: ['appointments', 'upcoming_appointments'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get current user upcoming appointments',
    description:
      'Get upcoming appointments for the currently authenticated user. Patients can only access their own upcoming appointments.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return current user upcoming appointments',
    type: () => [AppointmentResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot access upcoming appointments',
  })
  async getMyUpcomingAppointments(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AppointmentResponseDto[]> {
    try {
      const currentUserId = req.user?.sub;
      const clinicId = req.clinicContext?.clinicId;

      if (!currentUserId) {
        throw new BadRequestException('User ID is required');
      }

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting upcoming appointments for current user ${currentUserId}`,
        'AppointmentsController',
        { userId: currentUserId }
      );

      const response = (await this.appointmentService.getUserUpcomingAppointments(
        currentUserId,
        clinicId,
        req.user?.role || Role.PATIENT
      )) as { data?: { appointments?: AppointmentResponseDto[] } | AppointmentResponseDto[] };

      let result: AppointmentResponseDto[] = [];
      if (Array.isArray(response.data)) {
        result = response.data;
      } else if (response.data && 'appointments' in response.data) {
        result = response.data.appointments || [];
      } else if (Array.isArray(response)) {
        result = response as unknown as AppointmentResponseDto[];
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved ${result.length || 0} upcoming appointments for user ${currentUserId}`,
        'AppointmentsController',
        { userId: currentUserId, count: result.length || 0 }
      );
      return result;
    } catch (_error) {
      const errorUserId = req.user?.sub || '';
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to retrieve upcoming appointments: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsController',
        {
          userId: errorUserId,
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : String(_error),
        }
      );
      throw _error;
    }
  }

  @Get('doctor/:doctorId/availability')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({
    summary: 'Get doctor availability',
    description:
      "Check a doctor's availability for a specific date. Returns available time slots and working hours.",
  })
  @ApiParam({
    name: 'doctorId',
    description: 'ID of the doctor',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'date',
    description: 'Date to check availability for (YYYY-MM-DD)',
    required: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return doctor availability',
    type: () => DoctorAvailabilityResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date format or missing date parameter',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Doctor not found',
  })
  async getDoctorAvailability(
    @Param('doctorId') doctorIdParam: string,
    @Query('date') date: string,
    @Query('locationId') locationId: string | undefined,
    @Query('type') appointmentType: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DoctorAvailabilityResponseDto> {
    try {
      // Validate doctorId before ParseUUIDPipe
      if (!doctorIdParam || doctorIdParam === 'null' || doctorIdParam === 'undefined') {
        throw new BadRequestException('Doctor ID is required and must be a valid UUID');
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(doctorIdParam)) {
        throw new BadRequestException('Doctor ID must be a valid UUID format');
      }

      const doctorId = doctorIdParam;

      // Resolve clinicId from multiple sources:
      // 1. req.clinicContext set by ClinicGuard (authenticated + validated)
      // 2. X-Clinic-ID header directly (for @Public() endpoint where guard skips full validation)
      const clinicId =
        req.clinicContext?.clinicId ||
        (req.headers['x-clinic-id'] as string) ||
        (req.headers['clinic-id'] as string);

      if (!clinicId) {
        throw new BadRequestException(
          'Clinic ID is required. Please provide via X-Clinic-ID header.'
        );
      }

      if (!date) {
        throw new BadRequestException('Date parameter is required');
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        throw new BadRequestException('Date must be in YYYY-MM-DD format');
      }

      const requestedDate = startOfIstDay(date);
      const todayIST = startOfIstDay(new Date());

      if (!requestedDate || !todayIST) {
        throw new BadRequestException('Invalid date provided');
      }

      if (requestedDate.getTime() < todayIST.getTime()) {
        throw new BadRequestException('Cannot check availability for past dates');
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Checking availability for doctor ${doctorId} on ${date}`,
        'AppointmentsController',
        { doctorId, date }
      );

      const result = await this.appointmentService.getDoctorAvailability(
        doctorId,
        date,
        clinicId,
        req.user?.sub || '',
        locationId,
        req.user?.role || Role.PATIENT,
        appointmentType
      );

      // Extract data from result (service returns { success: true, data: availabilityData })
      const resultData =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data?: unknown }).data
          : result;

      // Type guard function to validate DoctorAvailabilityResponseDto structure
      const isValidAvailabilityResult = (
        value: unknown
      ): value is {
        availableSlots: string[];
        bookedSlots: string[];
        workingHours: { start: string; end: string };
        message?: string;
      } => {
        if (typeof value !== 'object' || value === null) {
          return false;
        }
        const obj = value as Record<string, unknown>;
        return (
          'availableSlots' in obj &&
          Array.isArray(obj['availableSlots']) &&
          'bookedSlots' in obj &&
          Array.isArray(obj['bookedSlots']) &&
          'workingHours' in obj &&
          typeof obj['workingHours'] === 'object'
        );
      };

      if (!resultData || !isValidAvailabilityResult(resultData)) {
        throw new BadRequestException('Invalid availability response');
      }

      // Create properly typed result object with all required fields
      // After type guard validation, we know resultData has the required structure
      const validatedData = resultData as {
        availableSlots: string[];
        bookedSlots: string[];
        workingHours: { start: string; end: string };
        message?: string;
      };

      // Construct the response DTO with all required fields
      const normalizeSlot = (slot: string): string => {
        const trimmed = slot.trim();
        const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
        if (!match) {
          return trimmed;
        }
        return `${(match[1] || '').padStart(2, '0')}:${match[2] || ''}`;
      };
      const bookedArray = Array.from(new Set(validatedData.bookedSlots.map(normalizeSlot)));
      const bookedSet = new Set(bookedArray);
      const slotsArray = Array.from(
        new Set(
          validatedData.availableSlots.map(normalizeSlot).filter(slot => !bookedSet.has(slot))
        )
      );
      const workingHoursObj = validatedData.workingHours;

      const availabilityResult: DoctorAvailabilityResponseDto = {
        doctorId,
        date,
        available: slotsArray.length > 0,
        availableSlots: slotsArray,
        bookedSlots: bookedArray,
        workingHours: workingHoursObj,
        message: validatedData.message || 'Availability retrieved',
      };

      const slotsCount = slotsArray.length;

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved availability for doctor ${doctorId}: ${slotsCount} slots available`,
        'AppointmentsController',
        { doctorId, slotsCount }
      );
      return availabilityResult;
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor availability: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsController',
        {
          doctorId: doctorIdParam, // Use param instead of scoped variable
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  @Get('user/:userId/upcoming')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF
  )
  @RequireResourcePermission('appointments', 'read')
  @PatientCache({
    // Names the requested user AND the caller: the patient-only-their-own check lives in the
    // handler and is skipped on a cache hit, so callers must never share an entry.
    customKeyGenerator: context => buildUserUpcomingCacheKey(context),
    ttl: 600,
    tags: ['appointments', 'upcoming_appointments'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get user upcoming appointments',
    description:
      'Get upcoming appointments for a specific user. Patients can only access their own upcoming appointments.',
  })
  @ApiParam({
    name: 'userId',
    description: 'ID of the user',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return user upcoming appointments',
    type: () => [AppointmentResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Cannot access other user's appointments",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  async getUserUpcomingAppointments(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AppointmentResponseDto[]> {
    try {
      const currentUserId = req.user?.sub;
      const clinicId = req.clinicContext?.clinicId;

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      // Patients can only access their own upcoming appointments
      if (req.user?.role === Role.PATIENT && currentUserId !== userId) {
        throw new ForbiddenException('Patients can only access their own appointments');
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting upcoming appointments for user ${userId} (requested by ${currentUserId})`,
        'AppointmentsController',
        { userId, currentUserId }
      );

      const response = (await this.appointmentService.getUserUpcomingAppointments(
        userId,
        clinicId,
        req.user?.role || Role.PATIENT
      )) as { data?: { appointments?: AppointmentResponseDto[] } | AppointmentResponseDto[] };

      let result: AppointmentResponseDto[] = [];
      if (Array.isArray(response.data)) {
        result = response.data;
      } else if (response.data && 'appointments' in response.data) {
        result = response.data.appointments || [];
      } else if (Array.isArray(response)) {
        result = response as unknown as AppointmentResponseDto[];
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved ${result.length || 0} upcoming appointments for user ${userId}`,
        'AppointmentsController',
        { userId, count: result.length || 0 }
      );
      return result;
    } catch (_error) {
      const errorUserId = userId || '';
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get user appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsController',
        {
          userId: errorUserId,
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.SUPER_ADMIN,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', { requireOwnership: true })
  @PatientCache({
    // Per caller and clinic: ownership / clinic checks in the handler are skipped on a hit.
    customKeyGenerator: context => buildAppointmentDetailCacheKey(context),
    ttl: 1800,
    tags: ['appointments', 'appointment_details'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get an appointment by ID',
    description:
      'Get detailed information about a specific appointment. Patients can only access their own appointments.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return the appointment',
    type: () => AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot access this appointment',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  async getAppointmentById(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AppointmentResponseDto> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting appointment ${id} for user ${currentUserId} in clinic ${clinicId}`,
        'AppointmentsController',
        { appointmentId: id, currentUserId, clinicId }
      );

      const result = (await this.appointmentService.getAppointmentById(
        id,
        clinicId
      )) as AppointmentResponseDto;

      // Additional security check for patients
      if (req.user?.role === Role.PATIENT && currentUserId) {
        const patient = (await this.appointmentService.getPatientByUserId(currentUserId)) as {
          id: string;
        } | null;
        if (result.patientId !== patient?.id && result.patientId !== currentUserId) {
          throw new ForbiddenException('Patients can only access their own appointments');
        }
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved appointment ${id} successfully`,
        'AppointmentsController',
        { appointmentId: id }
      );
      return result;
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment ${id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsController',
        {
          appointmentId: id,
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.RECEPTIONIST,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @InvalidateAppointmentCache({
    patterns: ['appointments:detail:{id}', 'appointments:*', 'patient:*:appointments'],
    tags: ['appointments', 'appointment_data'],
  })
  @InvalidatePatientCache({
    patterns: [
      'appointments:detail:{id}',
      'appointments:my:*',
      'appointments:upcoming:*',
      'appointments:list:*',
    ],
    tags: [
      'appointments',
      'appointment_details',
      'patient_appointments',
      'upcoming_appointments',
      'clinic_appointments',
    ],
  })
  @ApiOperation({
    summary: 'Update an appointment',
    description:
      "Update an existing appointment's non-structural details. A patient can only edit the notes of their own appointment; clinic staff can also change the priority and treatment type, and a clinician can save a consultation draft in metadata.consultationDraft. The date, time, duration, location, doctor, clinic, patient, type and payment state are never changed here (use reschedule / reassign), and the status of an appointment is never completed, started or confirmed here (use the complete, start-consultation and check-in flows).",
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: () => UpdateAppointmentDto,
    description: 'Appointment update data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment updated successfully',
    type: () => AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid update data, a field that cannot be changed through this endpoint, or a status change that must go through its own flow',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Cannot update this appointment: not yours, a patient changing a status, or expiring a consultation that is in progress',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  async updateAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateData: UpdateAppointmentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Updating appointment ${id} by user ${currentUserId} in clinic ${clinicId}`,
        'AppointmentsController',
        { appointmentId: id, currentUserId, clinicId }
      );

      // Additional security check for patients
      if (req.user?.role === Role.PATIENT && currentUserId) {
        const patient = (await this.appointmentService.getPatientByUserId(currentUserId)) as {
          id: string;
        } | null;
        const appointment = (await this.appointmentService.getAppointmentById(id, clinicId)) as {
          patientId?: string;
          patient?: { id: string };
        };
        const appointmentPatientId = appointment.patientId || appointment.patient?.id;
        if (appointmentPatientId !== patient?.id) {
          throw new ForbiddenException('Patients can only update their own appointments');
        }
      }

      // Product rule (same as PATCH /:id/status and DELETE /:id): a DOCTOR does not cancel
      // appointments. The generic update accepts a status, so it needs the rule too.
      if (
        req.user?.role === Role.DOCTOR &&
        String(updateData?.status ?? '').toUpperCase() === 'CANCELLED'
      ) {
        throw this.errors.insufficientPermissions(
          'Doctors cannot cancel appointments. Ask the reception desk or clinic admin.'
        );
      }

      // A refusal (invalid transition, conflict, not found) is its HTTP error (409 / 404 / 400),
      // not a 200 with success: false that a client would show as saved.
      const result = assertAppointmentResultOk(
        await this.appointmentService.updateAppointment(
          id,
          updateData,
          currentUserId || '',
          clinicId,
          req.user?.role || Role.PATIENT
        )
      );

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Appointment ${id} updated successfully`,
        'AppointmentsController',
        { appointmentId: id }
      );
      return {
        success: result.success,
        ...(result.data && {
          data: result.data as unknown as AppointmentResponseDto,
        }),
        message: result.message,
        ...(result.error && { error: result.error }),
      };
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update appointment ${id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsController',
        {
          appointmentId: id,
          clinicId: errorClinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * PATCH alias of PUT /appointments/:id. Web and mobile `updateAppointment` send PATCH; the body,
   * field policy, ownership rule and cache invalidation are exactly those of the PUT handler.
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.RECEPTIONIST,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @InvalidateAppointmentCache({
    patterns: ['appointments:detail:{id}', 'appointments:*', 'patient:*:appointments'],
    tags: ['appointments', 'appointment_data'],
  })
  @InvalidatePatientCache({
    patterns: [
      'appointments:detail:{id}',
      'appointments:my:*',
      'appointments:upcoming:*',
      'appointments:list:*',
    ],
    tags: [
      'appointments',
      'appointment_details',
      'patient_appointments',
      'upcoming_appointments',
      'clinic_appointments',
    ],
  })
  @ApiOperation({
    summary: 'Update an appointment (PATCH alias of PUT /appointments/:id)',
    description: 'Same body, field policy and permissions as PUT /appointments/:id.',
  })
  @ApiParam({ name: 'id', description: 'ID of the appointment', type: 'string', format: 'uuid' })
  @ApiBody({ type: () => UpdateAppointmentDto, description: 'Appointment update data' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment updated successfully',
    type: () => AppointmentResponseDto,
  })
  async patchAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateData: UpdateAppointmentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    return this.updateAppointment(id, updateData, req);
  }

  /**
   * @deprecated Use PATCH /appointments/:id/status with status=CANCELLED instead
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  // Product rule: a DOCTOR does not cancel appointments (reception / clinic admin / the patient do).
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @InvalidateAppointmentCache({
    patterns: ['appointments:detail:{id}', 'appointments:*', 'patient:*:appointments'],
    tags: ['appointments', 'appointment_data'],
  })
  @InvalidatePatientCache({
    patterns: [
      'appointments:detail:{id}',
      'appointments:my:*',
      'appointments:upcoming:*',
      'appointments:list:*',
      'appointments:availability:*',
    ],
    tags: [
      'appointments',
      'appointment_details',
      'patient_appointments',
      'upcoming_appointments',
      'clinic_appointments',
      'doctor_availability',
    ],
  })
  @ApiOperation({
    summary: 'Cancel an appointment',
    description:
      'Cancel an existing appointment. Patients can only cancel their own appointments. Only pending, scheduled, or rescheduled appointments can be cancelled. Confirmed appointments cannot be cancelled.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment cancelled successfully',
    type: () => AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot cancel completed appointment',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot cancel this appointment',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  async cancelAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const context = 'AppointmentsController.cancelAppointment';

    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      // Log the operation with proper structure
      void this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        'Cancelling appointment',
        context,
        {
          appointmentId: id,
          userId: currentUserId,
          clinicId,
          operation: 'cancelAppointment',
        }
      );

      // Additional security check for patients
      if (req.user?.role === Role.PATIENT && currentUserId) {
        const patient = (await this.appointmentService.getPatientByUserId(currentUserId)) as {
          id: string;
        } | null;
        const appointment = (await this.appointmentService.getAppointmentById(id, clinicId)) as {
          patientId?: string;
          patient?: { id: string };
        };
        const appointmentPatientId = appointment.patientId || appointment.patient?.id;
        if (appointmentPatientId !== patient?.id) {
          throw this.errors.insufficientPermissions(
            'Patients can only cancel their own appointments'
          );
        }
      }

      // A refused cancellation (wrong status, video booking ...) is a 409 / 404, never a 200.
      const result = assertAppointmentResultOk(
        await this.appointmentService.cancelAppointment(
          id,
          'Cancelled by user',
          currentUserId || '',
          clinicId,
          req.user?.role || Role.PATIENT
        )
      );

      // Log successful operation
      void this.loggingService.log(
        LogType.RESPONSE,
        LogLevel.INFO,
        'Appointment cancelled successfully',
        context,
        {
          appointmentId: id,
          userId: currentUserId,
          clinicId,
          operation: 'cancelAppointment',
        }
      );

      return {
        success: result.success,
        ...(result.data && {
          data: result.data as unknown as AppointmentResponseDto,
        }),
        message: result.message,
        ...(result.error && { error: result.error }),
      };
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, context);
        throw _error;
      }
      // A refusal (404 / 409) is the answer, not an internal failure.
      if (_error instanceof HttpException) {
        throw _error;
      }

      // Log the error with proper structure
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel appointment: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        context,
        {
          appointmentId: id,
          userId: req.user?.sub,
          clinicId: req.clinicContext?.clinicId,
          _error: _error instanceof Error ? _error.stack : String(_error),
          operation: 'cancelAppointment',
        }
      );

      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  // VIDEO APPOINTMENT RESCHEDULING
  // =============================================

  @Patch(':id/reschedule')
  @RateLimitAPI({ points: 5, duration: 60 })
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @InvalidateAppointmentCache({
    patterns: ['appointments:*', 'appointment:*'],
    tags: ['appointments', 'appointment_data'],
  })
  @ApiOperation({
    summary: 'Reschedule an appointment',
    description:
      'Reschedule an appointment to a new date/time. Video appointments can only be rescheduled while CONFIRMED, and before the 5-hour appointment window expires. In-person appointments can be rescheduled in any state except completed, cancelled, no-show, expired or in progress; a checked-in visit is taken out of the queue and goes back to scheduled. Maximum 2 reschedules per appointment.',
  })
  @ApiParam({ name: 'id', description: 'Appointment ID (UUID)', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      description:
        'Supports both {newDate,newTime} and legacy {date,time}. Also accepts newAppointmentDate (ISO) for backward compatibility.',
      properties: {
        newDate: { type: 'string', format: 'date', example: '2025-03-15' },
        newTime: { type: 'string', example: '14:00' },
        date: { type: 'string', format: 'date', example: '2025-03-15' },
        time: { type: 'string', example: '14:00' },
        newAppointmentDate: {
          type: 'string',
          format: 'date-time',
          example: '2025-03-15T08:30:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Appointment rescheduled successfully' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Reschedule policy violation or slot unavailable',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient permissions' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Appointment not found' })
  async rescheduleAppointment(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body()
    payload: {
      newDate?: string;
      newTime?: string;
      date?: string;
      time?: string;
      newAppointmentDate?: string;
      reason?: string;
    },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub;
    let newDate = payload.newDate || payload.date;
    let newTime = payload.newTime || payload.time;

    if ((!newDate || !newTime) && payload.newAppointmentDate) {
      const parsed = new Date(payload.newAppointmentDate);
      if (!Number.isNaN(parsed.getTime())) {
        newDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: IST_TIMEZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(parsed);
        newTime = new Intl.DateTimeFormat('en-GB', {
          timeZone: IST_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(parsed);
      }
    }

    if (!clinicId || !userId) {
      throw new BadRequestException('Clinic context and user ID are required');
    }
    if (!newDate || !newTime) {
      throw new BadRequestException('newDate and newTime are required');
    }

    try {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `User ${userId} requesting reschedule of appointment ${appointmentId} to ${newDate} ${newTime}`,
        'AppointmentsController.rescheduleAppointment',
        { appointmentId, newDate, newTime, userId, clinicId }
      );

      const result = await this.appointmentService.rescheduleAppointment(
        appointmentId,
        newDate,
        newTime,
        userId,
        clinicId,
        req.user?.role,
        payload.reason
      );

      return {
        success: result.success,
        data: result.data as unknown as AppointmentResponseDto,
        message: result.message,
      };
    } catch (error) {
      // A refused request (slot taken, visit not movable) is the caller's to fix, not a fault.
      const refusedByRule = error instanceof HttpException && error.getStatus() < 500;
      void this.loggingService.log(
        refusedByRule ? LogType.APPOINTMENT : LogType.ERROR,
        refusedByRule ? LogLevel.WARN : LogLevel.ERROR,
        `Failed to reschedule appointment ${appointmentId} to ${newDate} ${newTime}: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentsController.rescheduleAppointment',
        { appointmentId, newDate, newTime, clinicId }
      );
      if (error instanceof HealthcareError || error instanceof HttpException) throw error;
      throw this.errors.internalServerError('AppointmentsController.rescheduleAppointment');
    }
  }

  // =============================================
  // APPOINTMENT LIFECYCLE ENDPOINTS
  // =============================================

  /**
   * Update appointment status (Consolidated Endpoint)
   * PATCH /appointments/:id/status
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  // Allow all roles that can update appointments; specific RBAC/State checks are in service
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Update appointment status',
    description:
      'Consolidated endpoint to update appointment status (Check-in, Start, Complete, Cancel, etc.) via state machine. Clinic staff drive the lifecycle; a patient (or any non-staff role) can only request CANCELLED, under the existing cancellation rules. Starting a consultation is for clinic staff and doctors, completing is for the appointment doctor and, for video visits, the clinic admin.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'The caller may not request this status (a patient asking for anything but CANCELLED, a non-doctor completing a video visit, expiring a consultation in progress)',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found in this clinic',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    type: UpdateAppointmentStatusDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Status updated successfully',
  })
  @InvalidateAppointmentCache()
  async updateAppointmentStatus(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) updateDto: UpdateAppointmentStatusDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<unknown>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.updateAppointmentStatus';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      // Additional security check for patients: RbacGuard's requireOwnership
      // is never consulted here because the PATIENT role's blanket
      // appointments:update permission already satisfies the primary
      // permission check (ownership is only a fallback for a denied
      // permission, not an additional restriction) — mirrors the same
      // manual check already applied in cancelAppointment() above.
      if (req.user?.role === Role.PATIENT && userId) {
        const patient = (await this.appointmentService.getPatientByUserId(userId)) as {
          id: string;
        } | null;
        const appointment = (await this.appointmentService.getAppointmentById(
          appointmentId,
          clinicId
        )) as {
          patientId?: string;
          patient?: { id: string };
        };
        const appointmentPatientId = appointment.patientId || appointment.patient?.id;
        if (appointmentPatientId !== patient?.id) {
          throw this.errors.insufficientPermissions(
            'Patients can only update their own appointments'
          );
        }
      }

      // Product rule: a DOCTOR does not cancel appointments (reception / clinic admin / the patient do).
      if (
        req.user?.role === Role.DOCTOR &&
        String(updateDto.status).toUpperCase() === 'CANCELLED'
      ) {
        throw this.errors.insufficientPermissions(
          'Doctors cannot cancel appointments. Ask the reception desk or clinic admin.'
        );
      }

      // NO_SHOW -> CONFIRMED / SCHEDULED is the "undo no-show" of the desk: one implementation
      // (InPersonDeskService) that also puts a checked-in patient back into the live queue.
      const undone = await this.inPersonDesk?.undoNoShowIfApplicable(
        appointmentId,
        String(updateDto.status),
        clinicId,
        { userId: String(req.user?.sub ?? userId), role: String(req.user?.role ?? '') }
      );
      if (undone) {
        return { success: true, data: undone, message: 'No-show undone' };
      }

      // A refusal from the state machine (e.g. CANCELLATION_NOT_ALLOWED for a checked-in visit)
      // is its HTTP error (409 with the core message), never "updated to X" with success: true.
      const result = assertUnknownAppointmentResultOk(
        await this.appointmentService.updateStatus(
          appointmentId,
          updateDto,
          userId,
          clinicId,
          req.user?.role || 'USER'
        )
      );

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Appointment status updated to ${updateDto.status}`,
        context,
        {
          appointmentId,
          newStatus: updateDto.status,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result,
        message: `Appointment status updated to ${updateDto.status}`,
      };
    } catch (error) {
      // A business refusal (4xx, e.g. 409 consultation in progress) is expected traffic: WARN.
      const refused =
        (error instanceof HttpException && error.getStatus() < 500) ||
        (error instanceof HealthcareError && error.getStatus() < 500);
      void this.loggingService.log(
        LogType.ERROR,
        refused ? LogLevel.WARN : LogLevel.ERROR,
        `Failed to update status: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          targetStatus: updateDto.status,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError || error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * POST /appointments/:id/mark-no-show: thin alias of PATCH :id/status { status: NO_SHOW }.
   * Same state machine, role gate and cache invalidation; the body carries the optional reason.
   * No refund is ever issued (product rule).
   */
  @Post(':id/mark-no-show')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.NURSE
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Mark an appointment as a no-show',
    description:
      'Alias of PATCH /appointments/:id/status with status=NO_SHOW. Allowed from CONFIRMED (and the other states the state machine permits); never refunds.',
  })
  @ApiParam({ name: 'id', description: 'ID of the appointment', type: 'string' })
  @ApiBody({ type: MarkNoShowDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Appointment marked as NO_SHOW' })
  @InvalidateAppointmentCache()
  async markNoShow(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) body: MarkNoShowDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<unknown>> {
    const statusDto = new UpdateAppointmentStatusDto();
    statusDto.status = AppointmentStatus.NO_SHOW;
    if (body?.reason) statusDto.reason = body.reason;
    if (body?.notes) statusDto.notes = body.notes;
    return this.updateAppointmentStatus(appointmentId, statusDto, req);
  }

  @Get(':id/reassignment-candidates')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 40, duration: 60 })
  @ApiOperation({
    summary: 'Get eligible servicing doctor candidates for an appointment',
    description:
      'Returns doctor and assistant-doctor candidates filtered by clinic assignment, location, service eligibility, and assistant coverage configuration.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'Reassignment candidates resolved successfully',
    type: AppointmentReassignmentCandidatesResponseDto,
  })
  async getAppointmentReassignmentCandidates(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentReassignmentCandidatesResponseDto>> {
    const clinicId = req.clinicContext?.clinicId || '';
    const candidates = await this.appointmentService.getAppointmentReassignmentCandidates(
      appointmentId,
      clinicId
    );

    return {
      success: true,
      data: {
        candidates,
      },
      message: 'Appointment reassignment candidates fetched successfully',
    };
  }

  @Post(':id/reassign-doctor')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.RECEPTIONIST,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Reassign an appointment to another servicing doctor',
    description:
      'Preserves the original booked doctor in metadata and updates the active servicing doctor for queue and consultation flow.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    type: ReassignAppointmentDoctorDto,
  })
  @InvalidateAppointmentCache()
  async reassignAppointmentDoctor(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) reassignDto: ReassignAppointmentDoctorDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<unknown>> {
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    const result = await this.appointmentService.reassignDoctor(
      appointmentId,
      reassignDto.doctorId,
      userId,
      clinicId,
      req.user?.role || 'USER',
      reassignDto.reason
    );

    return {
      success: true,
      data: result,
      message: 'Appointment reassigned successfully',
    };
  }

  /**
   * Complete an appointment
   * @deprecated Use PATCH /:id/status instead
   * POST /appointments/:id/complete
   */
  /**
   * @deprecated Use PATCH /appointments/:id/status with status=COMPLETED instead
   */

  /**
   * Bulk complete selected appointments
   * POST /appointments/complete/bulk
   */
  @Post('complete/bulk')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.THERAPIST, Role.COUNSELOR, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Bulk complete selected appointments',
    description: 'Marks multiple selected appointments as completed by IDs',
  })
  @ApiBody({
    type: BulkCompleteAppointmentDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Selected appointments completed successfully',
  })
  @InvalidateAppointmentCache()
  async bulkCompleteSelectedAppointments(
    @Body(ValidationPipe) bulkDto: BulkCompleteAppointmentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ completed: number; failed: number; refused: string[] }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.bulkCompleteSelectedAppointments';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      // A doctor always acts as themselves: the body's doctorId is ignored and the Doctor
      // entity is resolved from the authenticated user. Admin roles may name a doctor.
      const isDoctorRole = req.user?.role === 'DOCTOR' || req.user?.role === 'ASSISTANT_DOCTOR';
      const doctorId = isDoctorRole
        ? ((await this.appointmentService.resolveDoctorEntityId(userId, clinicId)) ?? undefined)
        : bulkDto.doctorId;
      const { doctorId: _ignoredDoctorId, ...bulkDtoWithoutDoctor } = bulkDto;
      const effectiveBulkDto: BulkCompleteAppointmentDto = {
        ...bulkDtoWithoutDoctor,
        ...(doctorId && { doctorId }),
      };

      const result = (await this.appointmentService.bulkCompleteSelectedAppointments(
        {
          clinicId,
          ...(doctorId && { doctorId }),
        },
        effectiveBulkDto,
        userId,
        clinicId,
        req.user?.role || 'USER'
      )) as {
        success: boolean;
        data?: { completed: number; failed: number; refused: string[] };
      };

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Bulk complete selected appointments via API',
        context,
        {
          clinicId,
          doctorId: doctorId ?? userId,
          completed: result.data?.completed,
          failed: result.data?.failed,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result.data ?? { completed: 0, failed: 0, refused: [] },
        message: `Bulk completion finished: completed=${result.data?.completed}, failed=${result.data?.failed}`,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to bulk complete selected appointments: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError || error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.THERAPIST, Role.COUNSELOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Complete appointment',
    description: 'Marks an appointment as completed and optionally creates a follow-up plan',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    type: CompleteAppointmentDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment completed successfully',
    type: () => AppointmentResponseDto,
  })
  @InvalidateAppointmentCache()
  async completeAppointment(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) completeDto: CompleteAppointmentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.completeAppointment';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.completeAppointment(
        appointmentId,
        completeDto,
        userId,
        clinicId,
        req.user?.role || 'USER'
      )) as { success: boolean; data: AppointmentWithRelations };

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Appointment completed via API',
        context,
        {
          appointmentId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result.data as unknown as AppointmentResponseDto,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to complete appointment: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Check in patient for appointment
   * @deprecated Use PATCH /:id/status instead
   * POST /appointments/:id/check-in
   */
  /**
   * @deprecated Use PATCH /appointments/:id/status with status=CONFIRMED instead
   */
  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  // V2: reception one-click check-in (allotted location only). The assistant / doctor never check in.
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Check in patient',
    description: 'Processes patient check-in for an appointment',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    type: ProcessCheckInDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Check-in processed successfully (also when the arrival was already recorded)',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'The arrival was recorded but the doctor queue could not be updated. Retry the same request: it re-adds the queue entry and is otherwise idempotent',
  })
  @InvalidateAppointmentCacheByTags(CHECK_IN_CACHE_TAGS)
  async checkInAppointment(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) checkInDto: ProcessCheckInDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.checkInAppointment';
    const userId = req.user?.sub || req.user?.id || '';
    const userRole = String(req.user?.role ?? '').toUpperCase();
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }
      if (!userId) {
        throw this.errors.authenticationError('User not authenticated', context);
      }

      // V2: the shared in-person check-in (same service as the patient QR scan), which also writes
      // the MANUAL attempt to the check-in log. The legacy answer shape stays { success, data.message }.
      if (this.inPersonCheckIn) {
        await this.inPersonCheckIn.checkInManually(appointmentId, clinicId, {
          userId,
          role: userRole,
        });
        return { success: true, data: { message: 'Check-in processed successfully' } };
      }
      const appointment = await this.checkInLocationService.getAppointmentForCheckIn(
        appointmentId,
        clinicId,
        { userId, role: userRole }
      );
      await this.performInPersonCheckIn({
        appointment,
        clinicId,
        userId,
        userRole,
        requestedLocationId: checkInDto.locationId,
        // The legacy endpoint always used the appointment's own location and ignored this field.
        strictLocation: false,
        checkInMethod: checkInDto.checkInMethod || 'manual',
        source: 'AppointmentsController.checkInAppointment',
        notes: checkInDto.notes,
        context,
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Appointment check-in processed via API',
        context,
        {
          appointmentId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: { message: 'Check-in processed successfully' },
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * @deprecated Use PATCH /appointments/:id/status with status=CONFIRMED (with override) instead
   *
   * Override check-in for an IN-PERSON appointment. It runs through the very same
   * CheckInLocationService.processCheckIn as scan-qr and the manual code, so the result is
   * identical: SCHEDULED -> CONFIRMED, CheckIn row, and an entry in the appointment's doctor queue.
   *
   * - PATIENT: must own the appointment (or an owned dependent's) AND be within 200 meters of the
   *   appointment's own clinic location (coordinates in the body). Every presence failure returns
   *   the same 403 message / code (OUTSIDE_CLINIC_RADIUS).
   * - RECEPTIONIST / DOCTOR / ASSISTANT_DOCTOR / NURSE: no coordinates. A receptionist assigned to
   *   a clinic location can only check in appointments at that location.
   * - The location is always the appointment's own; a client-supplied locationId is never used to
   *   pick it (staff may repeat it, but a different one is rejected).
   */
  @Post(':id/force-check-in')
  @HttpCode(HttpStatus.OK)
  // V2: no check-in by the assistant doctor.
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.CLINIC_LOCATION_HEAD)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Override check-in for an in-person appointment',
    description:
      'Checks an in-person appointment in outside the QR flow and puts it in the doctor queue. Patients must own the appointment and send coordinates within 200 meters of the clinic location; reception and clinical staff need no coordinates. Video appointments are rejected.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    type: ForceCheckInDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Check-in processed successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Video appointment, the appointment can no longer be checked in, it is not on today (IST), or (patients) it is outside the 20 min before .. 45 min after window',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'The arrival was recorded but the doctor queue could not be updated. Retry the same request: it re-adds the queue entry and is otherwise idempotent',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Not the appointment owner, a receptionist assigned to another location, or (patients) not within 200 meters of the clinic (code OUTSIDE_CLINIC_RADIUS)',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @InvalidateAppointmentCacheByTags(CHECK_IN_CACHE_TAGS)
  async forceCheckInAppointment(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() forceCheckInDto: ForceCheckInDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string; overrideReason: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.forceCheckInAppointment';
    const userId = req.user?.sub || req.user?.id || '';
    const userRole = String(req.user?.role ?? '').toUpperCase();
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      if (!userId) {
        throw this.errors.authenticationError('User not authenticated', context);
      }

      const overrideReason = (forceCheckInDto.reason ?? '').trim();
      if (overrideReason.length === 0) {
        throw this.errors.validationError(
          'reason',
          'Override reason is required for audit logging',
          context
        );
      }

      // Fresh, clinic-scoped read (another clinic's appointment is a plain 404), then the caller's
      // access in the service's order: a patient must own it (403 for ANY appointment type, so a
      // non-owner learns nothing about it), then video is refused (400), then the receptionist's
      // location. An arrival that is already recorded is NOT short-circuited here: the service
      // answers it idempotently and re-adds a missing queue entry (a 503 retry repairs itself).
      const appointment = await this.checkInLocationService.getAppointmentForCheckIn(
        appointmentId,
        clinicId,
        { userId, role: userRole }
      );

      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.WARN,
        'Staff override: Forced check-in outside time window',
        context,
        {
          appointmentId,
          userId,
          userRole,
          clinicId,
          locationId: appointment.locationId,
          overrideReason,
          currentTime: nowIso(),
        }
      );

      const checkIn = await this.performInPersonCheckIn({
        appointment,
        clinicId,
        userId,
        userRole,
        requestedLocationId: forceCheckInDto.locationId,
        strictLocation: true,
        coordinates: forceCheckInDto.coordinates,
        deviceInfo: forceCheckInDto.deviceInfo,
        checkInMethod: 'manual',
        source: 'AppointmentsController.forceCheckInAppointment',
        notes: overrideReason,
        overrideReason,
        context,
      });

      // Log successful forced check-in
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Staff override check-in completed successfully',
        context,
        {
          appointmentId,
          checkInId: checkIn.id,
          alreadyCheckedIn: checkIn.alreadyCheckedIn === true,
          userId,
          userRole,
          clinicId,
          overrideReason,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: {
          message: 'Forced check-in processed successfully',
          overrideReason,
        },
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to force check-in: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  // =============================================
  // QR CODE CHECK-IN ENDPOINTS
  // =============================================

  /** @deprecated V2: use POST /in-person/check-in. QR scanning is for patients only. */
  @Post('check-in/scan-qr')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @InvalidateAppointmentCacheByTags(CHECK_IN_CACHE_TAGS)
  @ApiOperation({
    summary: 'Scan location QR code and check in (deprecated: use POST /in-person/check-in)',
    deprecated: true,
    description:
      'Deprecated thin delegate of POST /in-person/check-in (same InPersonCheckInService: QR validation, 20 min before .. 45 min after window, plan check, token, check-in log). Answers the legacy { success, data, message } shape.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: () => ScanLocationQRDto,
    description: 'QR code scan data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Check-in successful',
    type: ScanLocationQRResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No appointment found for this location',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid QR code, wrong location, or arrival already confirmed',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'The arrival was recorded but the doctor queue could not be updated. Retry the same request: it re-adds the queue entry and is otherwise idempotent',
  })
  async scanLocationQRAndCheckIn(
    @Body() scanDto: ScanLocationQRDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<ScanLocationQRResponseDto['data']>> {
    const context = 'AppointmentsController.scanLocationQRAndCheckIn';
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub || req.user?.id;
    if (!clinicId) {
      throw this.errors.validationError('clinicId', 'Clinic context is required', context);
    }
    if (!userId) {
      throw this.errors.authenticationError('User not authenticated', context);
    }
    if (!this.inPersonCheckIn) {
      // Optional injection (forwardRef): the module always provides it, but a partially wired
      // instance must answer a retryable 503, not an opaque 500.
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'CHECK_IN_UNAVAILABLE',
        message:
          'QR check-in is temporarily unavailable. Please try again in a moment or check in at the reception desk.',
      });
    }

    // Thin delegate: the same InPersonCheckInService path as POST /in-person/check-in (QR
    // validation, 20 min before .. 45 min after window, plan check via processCheckIn, events,
    // check-in log, token). Only the legacy response shape is mapped here.
    const result = await this.inPersonCheckIn.checkIn(
      {
        qrCode: scanDto.qrCode,
        ...(scanDto.appointmentId ? { appointmentId: scanDto.appointmentId } : {}),
        ...(scanDto.coordinates !== undefined
          ? { coordinates: scanDto.coordinates as unknown as { lat: number; lng: number } }
          : {}),
        ...(scanDto.deviceInfo !== undefined
          ? { deviceInfo: scanDto.deviceInfo as Record<string, unknown> }
          : {}),
      },
      clinicId,
      { userId, role: String(req.user?.role ?? '').toUpperCase() }
    );
    return this.toLegacyScanResponse(result, clinicId, context);
  }

  /** InPersonCheckInResult -> the `{ success, data, message }` shape scan-qr callers expect. */
  private async toLegacyScanResponse(
    result: InPersonCheckInResult,
    clinicId: string,
    context: string
  ): Promise<ServiceResponse<ScanLocationQRResponseDto['data']>> {
    if (result.result === 'SELECT_APPOINTMENT') {
      return {
        success: false,
        data: {
          requiresSelection: true,
          eligibleAppointments: result.candidates.map(visit => ({
            id: visit.appointmentId,
            date: visit.date,
            time: visit.time,
            startTime:
              computeCheckInWindow({
                date: visit.date,
                time: visit.time,
              })?.startsAt.toISOString() ?? null,
            doctor: { id: visit.doctorId, name: visit.doctorName },
            type: 'IN_PERSON',
            status: visit.appointmentStatus,
          })),
          message: 'Multiple appointments found. Please specify appointmentId to check in.',
        } as unknown as ScanLocationQRResponseDto['data'],
      };
    }

    const { visit, alreadyCheckedIn } = result;
    const queuePosition = await this.lookupQueuePosition(visit.appointmentId, clinicId, context);
    return {
      success: true,
      data: {
        appointmentId: visit.appointmentId,
        locationId: visit.locationId ?? '',
        locationName: visit.locationName ?? '',
        checkedInAt: visit.checkedInAt ?? nowIso(),
        queuePosition: queuePosition?.position || visit.position || 0,
        totalInQueue: queuePosition?.totalInQueue || 0,
        estimatedWaitTime: queuePosition?.estimatedWaitTime || visit.etaMinutes || 0,
        doctorId: visit.doctorId,
        doctorName: visit.doctorName,
        token: visit.token,
        alreadyCheckedIn,
      } as ScanLocationQRResponseDto['data'],
      message: alreadyCheckedIn
        ? 'Appointment already confirmed and in queue'
        : 'Checked in successfully',
    };
  }

  // =============================================
  // CHECK-IN LOCATION MANAGEMENT ENDPOINTS
  // =============================================

  @Get('check-in/locations')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.SUPER_ADMIN
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @ApiOperation({
    summary: 'List all check-in locations for clinic',
    description:
      'Retrieves all check-in locations for the current clinic. Optionally filter by active status.',
  })
  @ApiQuery({
    name: 'isActive',
    description: 'Filter by active status',
    type: Boolean,
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of check-in locations',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async getCheckInLocations(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('isActive') isActive?: string
  ): Promise<ServiceResponse<CheckInLocation[]>> {
    const context = 'AppointmentsController.getCheckInLocations';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const isActiveFilter = isActive === 'true' ? true : isActive === 'false' ? false : undefined;
      const locations = await this.checkInLocationService.getClinicLocations(
        clinicId,
        isActiveFilter
      );

      void this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        'Retrieved check-in locations',
        context,
        {
          clinicId,
          count: locations.length,
          isActive: isActiveFilter,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: locations,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get check-in locations: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get('check-in/history')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.SUPER_ADMIN
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @ApiOperation({
    summary: 'Get clinic check-in history',
    description: 'Returns clinic-wide checked-in appointments with timestamp and source.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Check-in history retrieved successfully',
  })
  async getCheckInHistory(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<CheckedInAppointmentsResponse>> {
    const context = 'AppointmentsController.getCheckInHistory';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const history = await this.checkInService.getCheckedInAppointments(clinicId);

      void this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        'Retrieved check-in history',
        context,
        {
          clinicId,
          count: history.total,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: history,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get check-in history: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Post('check-in/locations')
  @RateLimitAPI()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'create')
  @InvalidateAppointmentCache({
    patterns: ['appointments:location:*', 'checkin-locations:*'],
    tags: ['appointments', 'check_in_locations'],
  })
  @ApiOperation({
    summary: 'Create new check-in location',
    description: 'Creates a new check-in location with QR code generation for the current clinic.',
  })
  @ApiBody({
    description: 'Check-in location data',
    schema: {
      type: 'object',
      required: ['locationName', 'coordinates', 'radius'],
      properties: {
        locationName: { type: 'string', example: 'Main Reception' },
        coordinates: {
          type: 'object',
          properties: {
            lat: { type: 'number', example: 40.7128 },
            lng: { type: 'number', example: -74.006 },
          },
        },
        radius: { type: 'number', example: 50, description: 'Geofencing radius in meters' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Check-in location created successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async createCheckInLocation(
    @Body() createDto: CreateCheckInLocationRequestDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<CheckInLocation>> {
    const context = 'AppointmentsController.createCheckInLocation';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const location = await this.checkInLocationService.createCheckInLocation({
        clinicId,
        locationName: createDto.locationName,
        coordinates: createDto.coordinates,
        radius: createDto.radius,
        ...(typeof createDto.locationId === 'string' && createDto.locationId
          ? { locationId: createDto.locationId }
          : {}),
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in location created',
        context,
        {
          locationId: location.id,
          clinicId,
          locationName: createDto.locationName,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: location,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create check-in location: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError || error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Put('check-in/locations/:locationId')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @InvalidateAppointmentCache({
    patterns: ['appointments:location:*', 'checkin-locations:*', 'checkin-location:*'],
    tags: ['appointments', 'check_in_locations'],
  })
  @ApiOperation({
    summary: 'Update check-in location',
    description: 'Updates an existing check-in location. Only provided fields will be updated.',
  })
  @ApiParam({
    name: 'locationId',
    description: 'UUID of the check-in location',
    type: String,
  })
  @ApiBody({
    description: 'Check-in location update data',
    schema: {
      type: 'object',
      properties: {
        locationName: { type: 'string', example: 'Main Reception' },
        coordinates: {
          type: 'object',
          properties: {
            lat: { type: 'number', example: 40.7128 },
            lng: { type: 'number', example: -74.006 },
          },
        },
        radius: { type: 'number', example: 50 },
        isActive: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Check-in location updated successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Check-in location not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async updateCheckInLocation(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() updateDto: UpdateCheckInLocationRequestDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<CheckInLocation>> {
    const context = 'AppointmentsController.updateCheckInLocation';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      // The clinic is checked inside the service BEFORE anything is written.
      const location = await this.checkInLocationService.updateCheckInLocation(
        locationId,
        updateDto,
        clinicId
      );

      // Verify location belongs to clinic
      if (location.clinicId !== clinicId) {
        throw this.errors.insufficientPermissions(context);
      }

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in location updated',
        context,
        {
          locationId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: location,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update check-in location: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          locationId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError || error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Delete('check-in/locations/:locationId')
  @RateLimitAPI()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'delete')
  @InvalidateAppointmentCache({
    patterns: ['appointments:location:*', 'checkin-locations:*', 'checkin-location:*'],
    tags: ['appointments', 'check_in_locations'],
  })
  @ApiOperation({
    summary: 'Delete check-in location',
    description: 'Deletes a check-in location. This action cannot be undone.',
  })
  @ApiParam({
    name: 'locationId',
    description: 'UUID of the check-in location',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Check-in location deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Check-in location not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async deleteCheckInLocation(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<void> {
    const context = 'AppointmentsController.deleteCheckInLocation';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      // Verify location belongs to clinic before deletion
      const location = await this.checkInLocationService.getLocationById(locationId, clinicId);
      if (location.clinicId !== clinicId) {
        throw this.errors.insufficientPermissions(context);
      }

      await this.checkInLocationService.deleteCheckInLocation(locationId, clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in location deleted',
        context,
        {
          locationId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete check-in location: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          locationId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError || error instanceof HttpException) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get('locations/:locationId/qr-code')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    keyTemplate: 'appointments:location:{locationId}:qr-code',
    ttl: 3600,
    tags: ['appointments', 'qr_codes', 'locations'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Generate QR code for check-in location',
    description:
      'Generates a static QR code image for a check-in location. The QR code can be displayed at the location for patients to scan and check in.',
  })
  @ApiParam({
    name: 'locationId',
    description: 'UUID of the check-in location',
    type: String,
  })
  @ApiQuery({
    name: 'format',
    description: 'QR code format',
    enum: ['png', 'svg', 'base64'],
    enumName: 'QrCodeFormat',
    required: false,
  })
  @ApiQuery({
    name: 'size',
    description: 'QR code size in pixels',
    type: Number,
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'QR code generated successfully',
    type: LocationQRCodeResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Location not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async generateLocationQRCode(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Query('format') format: 'png' | 'svg' | 'base64' = 'base64',
    @Query('size') _size: number = 300,
    @Request() req: ClinicAuthenticatedRequest,
    @Res() res: FastifyReply
  ): Promise<void> {
    const context = 'AppointmentsController.generateLocationQRCode';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;

      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      // Get location details
      const locations = await this.checkInLocationService.getClinicLocations(clinicId, true);
      const location = locations.find(loc => loc.id === locationId);

      if (!location) {
        throw this.errors.notFoundError('Location', context, { locationId });
      }

      // Generate QR code data string using LocationQrService
      const qrCodeDataString = this.locationQrService.generateLocationQR(
        location.id,
        clinicId,
        location.qrVersion ?? 1
      );

      // Generate QR code image using QrService
      const qrCodeDataUrl = await this.qrService.generateQR(qrCodeDataString);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location QR code generated successfully',
        context,
        {
          locationId,
          clinicId,
          format,
          responseTime: Date.now() - startTime,
        }
      );

      // Return based on format
      if (format === 'png' || format === 'svg') {
        // Extract base64 data and return as image
        const base64Data = qrCodeDataUrl.split(',')[1];
        if (!base64Data) {
          throw this.errors.validationError('qrCode', 'Invalid QR code data URL format', context);
        }
        const imageBuffer = Buffer.from(base64Data, 'base64');

        res.type(`image/${format === 'png' ? 'png' : 'svg+xml'}`);
        res.send(imageBuffer);
      } else {
        // Return JSON with base64 data
        res.send({
          qrCode: qrCodeDataUrl,
          locationId: location.id,
          locationName: location.locationName,
          qrCodeString: qrCodeDataString, // Use generated QR data string instead of stored QR code
        });
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate location QR code: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          locationId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Post('locations/:locationId/qr-code/regenerate')
  @RateLimitAPI({ points: 5, duration: 60 })
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @ApiOperation({
    summary: 'Regenerate the clinic poster QR of a location',
    description:
      'Rotates the signed poster QR: the previously printed poster stops checking patients in (the scan answers that the QR was replaced) and the new QR is returned for printing.',
  })
  @ApiParam({ name: 'locationId', description: 'UUID of the check-in location', type: String })
  async regenerateLocationQRCode(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() body: RegenerateLocationQrDto | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{
    locationId: string;
    locationName: string;
    qrVersion: number;
    qrCode: string;
    qrCodeString: string;
    rotatedAt: string;
  }> {
    const context = 'AppointmentsController.regenerateLocationQRCode';
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw this.errors.validationError('clinicId', 'Clinic context is required', context);
    }
    const rotated = await this.checkInLocationService.rotateQr(locationId, clinicId, {
      userId: req.user?.sub ?? 'unknown',
      role: String(req.user?.role ?? 'unknown'),
      ...(body?.reason ? { reason: body.reason } : {}),
    });
    const qrVersion = rotated.qrVersion ?? 1;
    const qrCodeString = this.locationQrService.generateLocationQR(rotated.id, clinicId, qrVersion);
    const qrCode = await this.qrService.generateQR(qrCodeString);
    return {
      locationId: rotated.id,
      locationName: rotated.locationName,
      qrVersion,
      qrCode,
      qrCodeString,
      rotatedAt: (rotated.qrRotatedAt ?? new Date()).toISOString(),
    };
  }

  // =============================================
  // FOLLOW-UP APPOINTMENT ENDPOINTS
  // =============================================

  /**
   * Create a follow-up plan for an appointment
   * POST /appointments/:id/follow-up
   */
  @Post(':id/follow-up')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Create a follow-up plan for an appointment',
    description:
      'Creates a follow-up plan that can later be converted to an actual appointment. Used when completing an appointment to schedule future care.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    description: 'Follow-up plan details',
    schema: {
      type: 'object',
      required: ['followUpType', 'daysAfter', 'instructions'],
      properties: {
        followUpType: {
          type: 'string',
          enum: ['routine', 'urgent', 'specialist', 'therapy', 'surgery'],
          description: 'Type of follow-up',
        },
        daysAfter: {
          type: 'number',
          description: 'Number of days after the appointment to schedule follow-up',
          minimum: 1,
        },
        instructions: {
          type: 'string',
          description: 'Instructions for the follow-up',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Priority of the follow-up',
          default: 'normal',
        },
        medications: {
          type: 'array',
          items: { type: 'string' },
          description: 'Medications to be reviewed',
        },
        tests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tests to be performed',
        },
        restrictions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrictions or precautions',
        },
        notes: {
          type: 'string',
          description: 'Additional notes',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Follow-up plan created successfully',
    type: FollowUpPlanResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  @InvalidateAppointmentCache()
  async createFollowUpPlan(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe)
    createDto: {
      followUpType: string;
      daysAfter: number;
      instructions: string;
      priority?: string;
      medications?: string[];
      tests?: string[];
      restrictions?: string[];
      notes?: string;
    },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<FollowUpPlanResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.createFollowUpPlan';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      // Get appointment to extract patientId and doctorId
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;

      if (!appointment) {
        throw this.errors.appointmentNotFound(appointmentId, context);
      }

      const result = (await this.appointmentService.createFollowUpPlan(
        appointmentId,
        appointment.patient?.id || '',
        appointment.doctor?.id || '',
        clinicId,
        createDto.followUpType,
        createDto.daysAfter,
        createDto.instructions,
        createDto.priority || 'normal',
        createDto.medications,
        createDto.tests,
        createDto.restrictions,
        createDto.notes,
        userId // Pass authenticated user ID for permission check
      )) as { success: boolean; followUpId: string; scheduledFor: Date; message: string };

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan created via API',
        context,
        {
          appointmentId,
          followUpId: result.followUpId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: {
          id: result.followUpId,
          appointmentId,
          patientId: appointment.patient?.id || '',
          doctorId: appointment.doctor?.id || '',
          clinicId,
          followUpType: createDto.followUpType as
            'routine' | 'urgent' | 'specialist' | 'therapy' | 'surgery',
          scheduledFor: result.scheduledFor,
          status: 'scheduled',
          priority: (createDto.priority || 'normal') as 'low' | 'normal' | 'high' | 'urgent',
          instructions: createDto.instructions,
          medications: createDto.medications || [],
          tests: createDto.tests || [],
          restrictions: createDto.restrictions || [],
          notes: createDto.notes || '',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as FollowUpPlanResponseDto,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up plan: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Get the full appointment chain (original + all follow-ups)
   * GET /appointments/:id/chain
   */
  @Get(':id/chain')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Get appointment chain',
    description: 'Retrieves the original appointment and all its follow-up appointments',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the original appointment',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment chain retrieved successfully',
    type: () => AppointmentChainResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @PatientCache()
  async getAppointmentChain(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentChainResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.getAppointmentChain';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.getAppointmentChain(
        appointmentId,
        clinicId,
        userId
      )) as { original: AppointmentWithRelations; followUps: AppointmentWithRelations[] };

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Appointment chain retrieved via API',
        context,
        {
          appointmentId,
          userId,
          clinicId,
          followUpCount: result.followUps.length,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: {
          original: result.original as unknown as AppointmentResponseDto,
          followUps: result.followUps.map(apt => apt as unknown as AppointmentResponseDto),
        } as AppointmentChainResponseDto,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment chain: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Get all follow-up plans for a patient
   * GET /patients/:patientId/follow-up-plans
   */
  @Get('patients/:patientId/follow-up-plans')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Get patient follow-up plans',
    description: 'Retrieves all follow-up plans for a specific patient',
  })
  @ApiParam({
    name: 'patientId',
    description: 'ID of the patient',
    type: 'string',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by follow-up plan status',
    enum: ['scheduled', 'completed', 'cancelled', 'overdue'],
    enumName: 'FollowUpPlanStatus',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Follow-up plans retrieved successfully',
    type: () => [FollowUpPlanResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @PatientCache({})
  async getPatientFollowUpPlans(
    @Request() req: ClinicAuthenticatedRequest,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('status') status?: string
  ): Promise<ServiceResponse<FollowUpPlanResponseDto[]>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.getPatientFollowUpPlans';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.getPatientFollowUpPlans(
        patientId,
        clinicId,
        status
      )) as { followUps: FollowUpPlanResponseDto[] };

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient follow-up plans retrieved via API',
        context,
        {
          patientId,
          clinicId,
          status,
          count: result.followUps.length,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result.followUps,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient follow-up plans: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          patientId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Schedule an appointment from a follow-up plan
   * POST /follow-up-plans/:id/schedule
   */
  @Post('follow-up-plans/:id/schedule')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'create', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Schedule appointment from follow-up plan',
    description: 'Converts a follow-up plan into an actual scheduled appointment',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the follow-up plan',
    type: 'string',
  })
  @ApiBody({
    description: 'Appointment scheduling details',
    type: () => ScheduleFollowUpDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Appointment scheduled successfully',
    type: () => AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Follow-up plan not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @InvalidateAppointmentCache()
  @InvalidatePatientCache()
  async scheduleFollowUpFromPlan(
    @Param('id', ParseUUIDPipe) followUpPlanId: string,
    @Body(ValidationPipe) scheduleDto: ScheduleFollowUpDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.scheduleFollowUpFromPlan';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.scheduleFollowUpFromPlan(
        followUpPlanId,
        {
          appointmentDate: scheduleDto.appointmentDate,
          doctorId: scheduleDto.doctorId,
          locationId: scheduleDto.locationId,
        },
        userId,
        clinicId
      )) as { success: boolean; data: AppointmentWithRelations };

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up appointment scheduled via API',
        context,
        {
          followUpPlanId,
          appointmentId: result.data.id,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result.data as unknown as AppointmentResponseDto,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to schedule follow-up from plan: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          followUpPlanId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Get all follow-up appointments for an appointment
   * GET /appointments/:id/follow-ups
   */
  @Get(':id/follow-ups')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Get appointment follow-ups',
    description: 'Retrieves all follow-up appointments for a specific appointment',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Follow-up appointments retrieved successfully',
    type: () => [AppointmentResponseDto],
  })
  @PatientCache()
  async getAppointmentFollowUps(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<AppointmentResponseDto[]>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.getAppointmentFollowUps';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.getAppointmentFollowUps(
        appointmentId,
        clinicId,
        userId
      )) as { followUps: AppointmentWithRelations[]; count: number };

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Appointment follow-ups retrieved via API',
        context,
        {
          appointmentId,
          userId,
          clinicId,
          count: result.count,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result.followUps.map(apt => apt as unknown as AppointmentResponseDto),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment follow-ups: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          appointmentId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Update a follow-up plan
   * PUT /follow-up-plans/:id
   */
  @Put('follow-up-plans/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Update follow-up plan',
    description: 'Updates an existing follow-up plan',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the follow-up plan',
    type: 'string',
  })
  @ApiBody({
    type: () => UpdateFollowUpPlanDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Follow-up plan updated successfully',
    type: () => FollowUpPlanResponseDto,
  })
  @InvalidateAppointmentCache()
  async updateFollowUpPlan(
    @Param('id', ParseUUIDPipe) followUpPlanId: string,
    @Body(ValidationPipe) updateDto: UpdateFollowUpPlanDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<FollowUpPlanResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.updateFollowUpPlan';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.updateFollowUpPlan(
        followUpPlanId,
        updateDto,
        userId,
        clinicId
      )) as FollowUpPlanResponseDto;

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan updated via API',
        context,
        {
          followUpPlanId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update follow-up plan: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          followUpPlanId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Cancel a follow-up plan
   * DELETE /follow-up-plans/:id
   */
  @Delete('follow-up-plans/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Cancel follow-up plan',
    description: 'Cancels an existing follow-up plan',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the follow-up plan',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Follow-up plan cancelled successfully',
  })
  @InvalidateAppointmentCache()
  async cancelFollowUpPlan(
    @Param('id', ParseUUIDPipe) followUpPlanId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.cancelFollowUpPlan';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      await this.appointmentService.cancelFollowUpPlan(followUpPlanId, userId, clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan cancelled via API',
        context,
        {
          followUpPlanId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: { message: 'Follow-up plan cancelled successfully' },
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel follow-up plan: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          followUpPlanId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  // =============================================
  // RECURRING APPOINTMENT ENDPOINTS
  // =============================================

  /**
   * Create a recurring appointment series
   * POST /appointments/recurring
   */
  @Post('recurring')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'create', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 5, duration: 60 })
  @ApiOperation({
    summary: 'Create recurring appointment series',
    description: 'Creates a series of recurring appointments from a template',
  })
  @ApiBody({
    type: () => CreateRecurringSeriesDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Recurring series created successfully',
    type: () => RecurringSeriesResponseDto,
  })
  @InvalidateAppointmentCache()
  async createRecurringSeries(
    @Body(ValidationPipe) createDto: CreateRecurringSeriesDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<RecurringSeriesResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.createRecurringSeries';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.createRecurringSeries(
        createDto.templateId,
        createDto.patientId,
        clinicId,
        createDto.startDate,
        createDto.endDate,
        userId
      )) as RecurringSeriesResponseDto;

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring series created via API',
        context,
        {
          templateId: createDto.templateId,
          patientId: createDto.patientId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create recurring series: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          templateId: createDto.templateId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Get recurring appointment series details
   * GET /appointments/series/:id
   */
  @Get('series/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Get recurring series',
    description: 'Retrieves details of a recurring appointment series',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the recurring series',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Series details retrieved successfully',
    type: () => RecurringSeriesResponseDto,
  })
  @PatientCache()
  async getRecurringSeries(
    @Param('id', ParseUUIDPipe) seriesId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<RecurringSeriesResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.getRecurringSeries';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      const result = (await this.appointmentService.getRecurringSeries(
        seriesId,
        clinicId,
        userId
      )) as RecurringSeriesResponseDto;

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Recurring series retrieved via API',
        context,
        {
          seriesId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get recurring series: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          seriesId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Update recurring appointment series
   * PUT /appointments/series/:id
   */
  @Put('series/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Update recurring series',
    description: 'Updates a recurring appointment series',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the recurring series',
    type: 'string',
  })
  @ApiBody({
    type: () => UpdateRecurringSeriesDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Series updated successfully',
    type: () => RecurringSeriesResponseDto,
  })
  @InvalidateAppointmentCache()
  async updateRecurringSeries(
    @Param('id', ParseUUIDPipe) seriesId: string,
    @Body(ValidationPipe) updateDto: UpdateRecurringSeriesDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<RecurringSeriesResponseDto>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.updateRecurringSeries';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      await this.appointmentService.updateRecurringSeries(seriesId, updateDto, userId, clinicId);

      // Get updated series
      const result = (await this.appointmentService.getRecurringSeries(
        seriesId,
        clinicId,
        userId
      )) as RecurringSeriesResponseDto;

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring series updated via API',
        context,
        {
          seriesId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update recurring series: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          seriesId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Cancel recurring appointment series
   * DELETE /appointments/series/:id
   */
  @Delete('series/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Cancel recurring series',
    description: 'Cancels a recurring appointment series and all future appointments',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the recurring series',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Series cancelled successfully',
  })
  @InvalidateAppointmentCache()
  async cancelRecurringSeries(
    @Param('id', ParseUUIDPipe) seriesId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.cancelRecurringSeries';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      await this.appointmentService.cancelRecurringSeries(seriesId, userId, clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring series cancelled via API',
        context,
        {
          seriesId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: { message: 'Recurring series cancelled successfully' },
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel recurring series: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          seriesId,
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get('test/context')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.PATIENT
  )
  @ApiOperation({
    summary: 'Test appointment context',
    description: 'Test endpoint to debug appointment context and permissions',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the current appointment context and user info.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized',
  })
  testAppointmentContext(@Request() req: ClinicAuthenticatedRequest) {
    const clinicContext = req.clinicContext;
    const user = req.user;

    return {
      message: 'Appointment context test',
      timestamp: nowIso(),
      user: {
        id: user?.sub,
        sub: user?.sub,
        role: user?.role,
        email: user?.['email'],
      },
      clinicContext: {
        identifier: clinicContext?.identifier,
        clinicId: clinicContext?.clinicId,
        subdomain: clinicContext?.subdomain,
        appName: clinicContext?.appName,
        isValid: clinicContext?.isValid,
      },
      headers: {
        'x-clinic-id': req.headers['x-clinic-id'],
        'x-clinic-identifier': req.headers['x-clinic-identifier'],
        authorization: req.headers.authorization ? 'Bearer ***' : 'none',
      },
    };
  }

  // =============================================
  // ANALYTICS ENDPOINTS
  // =============================================

  @Get('analytics/wait-times')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    // Clinic + every filter (the old template had neither the clinic nor doctorId).
    customKeyGenerator: context =>
      buildClinicScopedCacheKey(context, 'appointments:analytics:wait-times', [
        'from',
        'to',
        'locationId',
        'doctorId',
      ]),
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['appointments', 'analytics', 'wait_times'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get wait time analytics',
    description:
      'Retrieves analytics on patient wait times including averages, percentiles, and breakdowns by location, doctor, and hour. Cached for performance.',
  })
  @ApiQuery({
    name: 'from',
    description: 'Start date (ISO format)',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'to',
    description: 'End date (ISO format)',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'locationId',
    description: 'Optional location ID filter',
    type: String,
    required: false,
  })
  @ApiQuery({
    name: 'doctorId',
    description: 'Optional doctor ID filter',
    type: String,
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Wait time analytics retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async getWaitTimeAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('locationId') locationId?: string,
    @Query('doctorId') doctorId?: string
  ): Promise<ServiceResponse<unknown>> {
    const context = 'AppointmentsController.getWaitTimeAnalytics';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const dateRange = {
        from: new Date(from),
        to: new Date(to),
      };

      if (isNaN(dateRange.from.getTime()) || isNaN(dateRange.to.getTime())) {
        throw this.errors.validationError('dateRange', 'Invalid date range', context);
      }

      const result = await this.analyticsService.getWaitTimeAnalytics(
        clinicId,
        dateRange,
        locationId,
        doctorId
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Wait time analytics retrieved',
        context,
        {
          clinicId,
          locationId,
          doctorId,
          dateRange,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: result.success,
        data: result.data,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get wait time analytics: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get('analytics/check-in-patterns')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    customKeyGenerator: context =>
      buildClinicScopedCacheKey(context, 'appointments:analytics:check-in-patterns', [
        'from',
        'to',
        'locationId',
      ]),
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['appointments', 'analytics', 'check_in_patterns'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get check-in pattern analytics',
    description:
      'Retrieves analytics on check-in patterns including timing distribution, peak hours, and location breakdowns. Cached for performance.',
  })
  @ApiQuery({
    name: 'from',
    description: 'Start date (ISO format)',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'to',
    description: 'End date (ISO format)',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'locationId',
    description: 'Optional location ID filter',
    type: String,
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Check-in pattern analytics retrieved successfully',
  })
  async getCheckInPatternAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('locationId') locationId?: string
  ): Promise<ServiceResponse<unknown>> {
    const context = 'AppointmentsController.getCheckInPatternAnalytics';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const dateRange = {
        from: new Date(from),
        to: new Date(to),
      };

      if (isNaN(dateRange.from.getTime()) || isNaN(dateRange.to.getTime())) {
        throw this.errors.validationError('dateRange', 'Invalid date range', context);
      }

      const result = await this.analyticsService.getCheckInPatternAnalytics(
        clinicId,
        dateRange,
        locationId
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Check-in pattern analytics retrieved',
        context,
        {
          clinicId,
          locationId,
          dateRange,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: result.success,
        data: result.data,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get check-in pattern analytics: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get('analytics/no-show-correlation')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    customKeyGenerator: context =>
      buildClinicScopedCacheKey(context, 'appointments:analytics:no-show-correlation', [
        'from',
        'to',
        'locationId',
      ]),
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['appointments', 'analytics', 'no_show_correlation'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get no-show correlation analytics',
    description:
      'Analyzes correlation between check-in status and no-show rates to identify patterns. Cached for performance.',
  })
  @ApiQuery({
    name: 'from',
    description: 'Start date (ISO format)',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'to',
    description: 'End date (ISO format)',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'locationId',
    description: 'Optional location ID filter',
    type: String,
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'No-show correlation analytics retrieved successfully',
  })
  async getNoShowCorrelationAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('locationId') locationId?: string
  ): Promise<ServiceResponse<unknown>> {
    const context = 'AppointmentsController.getNoShowCorrelationAnalytics';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const dateRange = {
        from: new Date(from),
        to: new Date(to),
      };

      if (isNaN(dateRange.from.getTime()) || isNaN(dateRange.to.getTime())) {
        throw this.errors.validationError('dateRange', 'Invalid date range', context);
      }

      const result = await this.analyticsService.getNoShowCorrelationAnalytics(
        clinicId,
        dateRange,
        locationId
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'No-show correlation analytics retrieved',
        context,
        {
          clinicId,
          locationId,
          dateRange,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: result.success,
        data: result.data,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get no-show correlation analytics: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          clinicId: req.clinicContext?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get(':id/qr')
  @Roles(Role.PATIENT, Role.RECEPTIONIST)
  @ClinicRoute()
  @ApiOperation({ summary: 'Generate appointment QR code' })
  @ApiResponse({ status: 200, description: 'QR code generated successfully' })
  @ApiResponse({ status: 403, description: 'Cannot access this appointment' })
  async generateQR(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new BadRequestException('Clinic context is required');
    }
    // Same clinic + patient-ownership rule as GET /appointments/:id.
    const appointment = (await this.appointmentService.getAppointmentById(
      appointmentId,
      clinicId
    )) as { patientId: string };
    const currentUserId = req.user?.sub;
    if (req.user?.role === Role.PATIENT && currentUserId) {
      const patient = (await this.appointmentService.getPatientByUserId(currentUserId)) as {
        id: string;
      } | null;
      if (appointment.patientId !== patient?.id && appointment.patientId !== currentUserId) {
        throw new ForbiddenException('Patients can only access their own appointments');
      }
    }
    const qrCode = await this.qrService.generateAppointmentQR(appointmentId);
    return {
      success: true,
      data: { qrCode },
    };
  }

  @Post('verify-qr')
  @Roles(Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Verify appointment QR code' })
  @ApiBody({ schema: { type: 'object', properties: { qrToken: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'QR code verified successfully' })
  async verifyQR(@Body() body: { qrToken: string }, @Request() _req: ClinicAuthenticatedRequest) {
    const appointmentId = await Promise.resolve(this.qrService.verifyAppointmentQR(body.qrToken));
    return {
      success: true,
      data: { appointmentId, verified: true },
    };
  }

  /**
   * GET /appointments/summary/daily: a doctor's day (or date range) at a glance.
   * DOCTOR / ASSISTANT_DOCTOR are pinned to their own Doctor row; CLINIC_ADMIN, CLINIC_LOCATION_HEAD
   * and SUPER_ADMIN may pass ?doctorId= (Doctor.id or the doctor's User id) or get the clinic total.
   */
  @Get('summary/daily')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.SUPER_ADMIN
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @RateLimitAPI({ points: 30, duration: 60 })
  @ApiOperation({
    summary: 'Daily appointment summary for a doctor or the clinic',
    description:
      'Counts, revenue and average consultation length for the IST day range [startDate, endDate] (default: today). Doctors always get their own numbers.',
  })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD (IST), default today' })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'YYYY-MM-DD (IST), default startDate',
  })
  @ApiQuery({
    name: 'doctorId',
    required: false,
    description: 'Doctor.id or doctor User id (admins only; ignored for doctors)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: () => AppointmentDailySummaryDto })
  async getDailySummary(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('doctorId') doctorId?: string
  ): Promise<ServiceResponse<AppointmentDailySummaryDto>> {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub || req.user?.id;
    if (!clinicId) throw new BadRequestException('Clinic context is required');
    if (!userId) throw new BadRequestException('User context is required');
    for (const [name, value] of [
      ['startDate', startDate],
      ['endDate', endDate],
    ] as const) {
      if (value && Number.isNaN(Date.parse(value))) {
        throw new BadRequestException(`${name} must be a valid date (YYYY-MM-DD)`);
      }
    }

    const data = await this.appointmentService.getDailySummary({
      clinicId,
      actorUserId: userId,
      role: req.user?.role || 'USER',
      ...(startDate?.trim() ? { startDate: startDate.trim() } : {}),
      ...(endDate?.trim() ? { endDate: endDate.trim() } : {}),
      ...(doctorId?.trim() ? { doctorId: doctorId.trim() } : {}),
    });

    return { success: true, data, message: 'Daily appointment summary retrieved successfully' };
  }

  /**
   * Manually send today's full-day doctor summary for the caller's clinic, e.g. when the
   * scheduled morning summary was missed (worker down). Timing of the scheduled summaries is the
   * clinic setting appointmentSettings.doctorSummary.
   */
  @Post('summary/trigger')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @RateLimitAPI({ points: 5, duration: 60 })
  @ApiOperation({
    summary: 'Trigger doctor daily summary manually',
    description:
      "Enqueues today's full-day WhatsApp summary for each doctor of the caller's clinic (super admin without a clinic: every active clinic; doctors with no confirmed bookings get none). Use it when the scheduled morning summary was missed; the worker must be running to send them.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Doctor summary jobs enqueued',
  })
  async triggerDoctorDailySummary(@Request() req: ClinicAuthenticatedRequest): Promise<{
    success: true;
    data: {
      todayKey: string;
      enqueuedCount: number;
      skipCount: number;
      totalDoctors: number;
    };
    message: string;
  }> {
    // Clinic admins: their own clinic. Super admins: the clinic in context, or every clinic.
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId && req.user?.role !== Role.SUPER_ADMIN) {
      throw new BadRequestException('Clinic context is required');
    }
    const result = await this.appointmentService.triggerDoctorDailySummary({
      ...(clinicId ? { clinicId } : {}),
      triggeredBy: 'manual',
    });
    return {
      success: true,
      data: result,
      message: `Enqueued ${result.enqueuedCount} doctor summary job(s), skipped ${result.skipCount} existing`,
    };
  }
}
