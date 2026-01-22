import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  Request,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
  Res,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
  ApiHeader,
  ApiConsumes,
  ApiProduces,
} from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { Role, AppointmentStatus } from '@core/types/enums.types';
import { isVideoCallAppointment } from '@core/types/appointment-guards.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ClinicRoute } from '@core/decorators/clinic-route.decorator';
import { HealthcareErrorsService, HealthcareError } from '@core/errors';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { CacheService } from '@infrastructure/cache';
import {
  Cache,
  PatientCache,
  InvalidatePatientCache,
  InvalidateAppointmentCache,
} from '@core/decorators';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
  AppointmentListResponseDto,
  DoctorAvailabilityResponseDto,
  AppointmentFilterDto,
  CompleteAppointmentDto,
  ScheduleFollowUpDto,
  AppointmentChainResponseDto,
  FollowUpPlanResponseDto,
  CreateRecurringSeriesDto,
  UpdateRecurringSeriesDto,
  RecurringSeriesResponseDto,
  UpdateFollowUpPlanDto,
  ProcessCheckInDto,
  StartConsultationDto,
} from '@dtos/appointment.dto';
import {
  VideoTokenResponseDto,
  VideoConsultationSessionDto,
  EndVideoConsultationDto,
  DataResponseDto,
  SuccessResponseDto,
} from '@dtos';
import {
  ScanLocationQRDto,
  ScanLocationQRResponseDto,
  LocationQRCodeResponseDto,
} from '@dtos/appointment.dto';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { VideoService } from '@services/video/video.service';
import { CheckInService } from './plugins/checkin/check-in.service';
import { AppointmentQueueService } from './plugins/queue/appointment-queue.service';
import { CheckInLocationService } from './plugins/therapy/check-in-location.service';
import { AppointmentAnalyticsService } from './plugins/analytics/appointment-analytics.service';
import { QrService, LocationQrService } from '@utils/QR';
import { FastifyReply } from 'fastify';

// Use centralized types
import type {
  AppointmentFilters,
  ServiceResponse,
  CheckInLocation,
} from '@core/types/appointment.types';
import type { AppointmentWithRelations } from '@core/types/database.types';

@ApiTags('appointments')
@Controller('appointments')
@ApiBearerAuth()
@ApiSecurity('session-id')
@ApiHeader({
  name: 'X-Clinic-ID',
  description: 'Clinic identifier',
  required: true,
})
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
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
    private readonly appointmentService: AppointmentsService,
    private readonly errors: HealthcareErrorsService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    private readonly videoService: VideoService,
    @Inject(forwardRef(() => CheckInService))
    private readonly checkInService: CheckInService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly appointmentQueueService: AppointmentQueueService,
    @Inject(forwardRef(() => CheckInLocationService))
    private readonly checkInLocationService: CheckInLocationService,
    @Inject(forwardRef(() => QrService))
    private readonly qrService: QrService,
    @Inject(forwardRef(() => LocationQrService))
    private readonly locationQrService: LocationQrService,
    @Inject(forwardRef(() => AppointmentAnalyticsService))
    private readonly analyticsService: AppointmentAnalyticsService
  ) {}

  @Post()
  @RateLimitAPI()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
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
    type: CreateAppointmentDto,
    description: 'Appointment creation data',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Appointment created successfully',
    type: AppointmentResponseDto,
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

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Creating appointment for user ${userId} in clinic ${clinicId}`,
        'AppointmentsController',
        { userId, clinicId }
      );

      const result = await this.appointmentService.createAppointment(
        appointmentData,
        userId,
        clinicId,
        req.user?.role || Role.PATIENT
      );

      await this.loggingService.log(
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
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

  @Get('my-appointments')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @PatientCache({
    keyTemplate: 'appointments:my:{userId}:{clinicId}',
    ttl: 300,
    tags: ['appointments', 'patient_appointments'],
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
    name: 'status',
    required: false,
    description: 'Filter by appointment status',
    enum: ['PENDING', 'SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filter by appointment date (YYYY-MM-DD)',
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
    description: 'Number of items per page',
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return user appointments',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { $ref: '#/components/schemas/AppointmentListResponseDto' },
        message: { type: 'string' },
      },
    },
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
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10
  ): Promise<ServiceResponse<AppointmentListResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID not found');
      }

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting appointments for user ${userId} in clinic ${clinicId}`,
        'AppointmentsController',
        { userId, clinicId }
      );

      const filters: AppointmentFilters = {
        userId,
        clinicId,
        ...(status && { status: status as AppointmentStatus }),
        ...(date && { date }),
        page: Math.max(1, page),
        limit: Math.min(100, Math.max(1, limit)),
      };

      const result = await this.appointmentService.getAppointments(
        filters as AppointmentFilterDto,
        userId || '',
        clinicId
      );

      await this.loggingService.log(
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
      await this.loggingService.log(
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
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    keyTemplate: 'appointments:list:{clinicId}:{filters}',
    ttl: 300,
    staleTime: 60,
    tags: ['appointments', 'clinic_appointments'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
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
    name: 'status',
    required: false,
    description: 'Filter by appointment status',
    enum: ['PENDING', 'SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filter by appointment date (YYYY-MM-DD)',
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
    description: 'Number of items per page',
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Return all appointments',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { $ref: '#/components/schemas/AppointmentListResponseDto' },
        message: { type: 'string' },
      },
    },
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
    @Query('limit') limit: number = 10
  ): Promise<ServiceResponse<AppointmentListResponseDto>> {
    const context = 'AppointmentsController.getAppointments';

    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      // Log the operation with proper structure
      await this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        'Retrieving appointments list',
        context,
        {
          userId: currentUserId,
          clinicId,
          filters: { userId, doctorId, status, date, locationId, page, limit },
          operation: 'getAppointments',
        }
      );

      const filters: AppointmentFilters = {
        ...(userId && { userId }),
        ...(doctorId && { doctorId }),
        ...(status && { status: status as AppointmentStatus }),
        ...(date && { date }),
        ...(locationId && { locationId }),
        clinicId,
        page: Math.max(1, page),
        limit: Math.min(100, Math.max(1, limit)),
      };

      const result = await this.appointmentService.getAppointments(
        filters as AppointmentFilterDto,
        currentUserId || '',
        clinicId
      );

      // Log successful operation
      await this.loggingService.log(
        LogType.RESPONSE,
        LogLevel.INFO,
        `Retrieved ${(result.data as unknown as AppointmentResponseDto[])?.length || 0} appointments successfully`,
        context,
        {
          userId: currentUserId,
          clinicId,
          appointmentCount: (result.data as unknown as AppointmentResponseDto[])?.length || 0,
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

      // Log the error with proper structure
      await this.loggingService.log(
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

  @Get('doctor/:doctorId/availability')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.RECEPTIONIST,
    Role.DOCTOR,
    Role.CLINIC_ADMIN,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF
  )
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    keyTemplate: 'appointments:availability:{doctorId}:{date}',
    ttl: 180,
    tags: ['appointments', 'doctor_availability'],
    priority: 'high',
    enableSWR: true,
    containsPHI: false,
    compress: false,
  })
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
    schema: {
      $ref: '#/components/schemas/DoctorAvailabilityResponseDto',
    },
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
      const clinicId = req.clinicContext?.clinicId;

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      if (!date) {
        throw new BadRequestException('Date parameter is required');
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        throw new BadRequestException('Date must be in YYYY-MM-DD format');
      }

      // Check if date is not in the past
      const requestedDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (requestedDate < today) {
        throw new BadRequestException('Cannot check availability for past dates');
      }

      await this.loggingService.log(
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
        req.user?.role || Role.PATIENT
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
      const slotsArray = validatedData.availableSlots;
      const bookedArray = validatedData.bookedSlots;
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

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved availability for doctor ${doctorId}: ${slotsCount} slots available`,
        'AppointmentsController',
        { doctorId, slotsCount }
      );
      return availabilityResult;
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      await this.loggingService.log(
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
    keyTemplate: 'appointments:upcoming:{userId}',
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
    type: [AppointmentResponseDto],
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

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting upcoming appointments for user ${userId} (requested by ${currentUserId})`,
        'AppointmentsController',
        { userId, currentUserId }
      );

      const result = (await this.appointmentService.getUserUpcomingAppointments(
        userId,
        clinicId,
        req.user?.role || Role.PATIENT
      )) as AppointmentResponseDto[];

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved ${result?.length || 0} upcoming appointments for user ${userId}`,
        'AppointmentsController',
        { userId, count: result?.length || 0 }
      );
      return result;
    } catch (_error) {
      const errorUserId = userId || '';
      const errorClinicId = req.clinicContext?.clinicId || '';
      await this.loggingService.log(
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
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.SUPPORT_STAFF
  )
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'appointments:detail:{id}',
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
    type: AppointmentResponseDto,
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

      await this.loggingService.log(
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
        if (result.patientId !== patient?.id) {
          throw new ForbiddenException('Patients can only access their own appointments');
        }
      }

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Retrieved appointment ${id} successfully`,
        'AppointmentsController',
        { appointmentId: id }
      );
      return result;
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      await this.loggingService.log(
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
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
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
      "Update an existing appointment's details. Patients can only update their own appointments.",
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
    type: UpdateAppointmentDto,
    description: 'Appointment update data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment updated successfully',
    type: AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid update data',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot update this appointment',
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

      await this.loggingService.log(
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

      const result = await this.appointmentService.updateAppointment(
        id,
        updateData,
        currentUserId || '',
        clinicId,
        req.user?.role || Role.PATIENT
      );

      await this.loggingService.log(
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
      await this.loggingService.log(
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

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
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
      'Cancel an existing appointment. Patients can only cancel their own appointments. Completed appointments cannot be cancelled.',
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
    type: AppointmentResponseDto,
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
      await this.loggingService.log(
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

      const result = await this.appointmentService.cancelAppointment(
        id,
        'Cancelled by user',
        currentUserId || '',
        clinicId,
        req.user?.role || Role.PATIENT
      );

      // Log successful operation
      await this.loggingService.log(
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

      // Log the error with proper structure
      await this.loggingService.log(
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

  // =============================================
  // VIDEO CONSULTATION ENDPOINTS
  // =============================================

  @Post(':id/video/create-room')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @ApiOperation({
    summary: 'Create video consultation room',
    description:
      'Create a secure Jitsi room for healthcare video consultation with HIPAA compliance.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Video consultation room created successfully',
    type: DataResponseDto,
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            roomName: { type: 'string', example: 'appointment-123-abc' },
          },
        },
        message: { type: 'string', example: 'Video consultation room created successfully' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async createVideoConsultationRoom(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DataResponseDto<{ roomName: string }>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Creating video room for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          clinicId,
          createdBy: userId,
          appointmentId,
        }
      );

      // Get appointment details
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Runtime validation at boundary - narrow to VideoCallAppointment
      if (!isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'This appointment is not a video consultation. Video rooms can only be created for VIDEO_CALL appointments.'
        );
      }

      // TypeScript now knows appointment is VideoCallAppointment

      // Create secure Jitsi room
      const roomConfig = await this.videoService.generateMeetingToken(
        appointmentId,
        appointment.patient?.id || '',
        'patient',
        {
          displayName: appointment.patient?.user?.name || 'Patient',
          email: appointment.patient?.user?.email || '',
        }
      );

      return new DataResponseDto(
        {
          roomName: roomConfig.roomName,
        },
        'Video consultation room created successfully'
      );
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      // Reduce log level for expected validation errors (non-video appointments)
      const isExpectedValidationError =
        errorMessage.includes('not a video consultation') ||
        errorMessage.includes('not a video appointment');
      await this.loggingService.log(
        LogType.ERROR,
        isExpectedValidationError ? LogLevel.WARN : LogLevel.ERROR,
        `Failed to create video room for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          clinicId: errorClinicId,
          error: errorMessage,
        }
      );
      throw _error;
    }
  }

  @Post(':id/video/join-token')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Generate video consultation join token',
    description:
      'Generate secure JWT token for joining the video consultation with role-based permissions.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Join token generated successfully',
    type: VideoTokenResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment or video room not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to join this consultation',
  })
  async generateVideoJoinToken(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoTokenResponseDto> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;
      const userRole = req.user?.role;

      if (!clinicId || !userId) {
        throw new BadRequestException('User and clinic context required');
      }

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Generating video join token for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          userId,
          userRole,
          clinicId,
          appointmentId,
        }
      );

      // Get appointment details
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Runtime validation at boundary - narrow to VideoCallAppointment
      if (!isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'This appointment is not a video consultation. Join tokens can only be generated for VIDEO_CALL appointments.'
        );
      }

      // TypeScript now knows appointment is VideoCallAppointment

      // Determine user role in consultation
      let consultationRole: 'patient' | 'doctor';
      if (userRole === Role.PATIENT) {
        if (appointment.patient?.userId !== userId) {
          throw new ForbiddenException('Patients can only join their own consultations');
        }
        consultationRole = 'patient';
      } else {
        consultationRole = 'doctor';
      }

      // Generate secure meeting token
      const meetingToken = await this.videoService.generateMeetingToken(
        appointmentId,
        userId,
        consultationRole,
        {
          displayName:
            consultationRole === 'patient'
              ? appointment.patient?.user?.name || 'Patient'
              : appointment.doctor?.user?.name || 'Doctor',
          email: (req.user && 'email' in req.user ? String(req.user['email']) : '') || '',
        }
      );

      // Map to DTO
      const tokenDto = new VideoTokenResponseDto();
      tokenDto.token = meetingToken.token;
      tokenDto.roomName = meetingToken.roomName;
      tokenDto.roomId = meetingToken.roomId;
      tokenDto.meetingUrl = meetingToken.meetingUrl;
      if (meetingToken.roomPassword) {
        tokenDto.roomPassword = meetingToken.roomPassword;
      }
      if (meetingToken.meetingPassword) {
        tokenDto.meetingPassword = meetingToken.meetingPassword;
      }
      if (meetingToken.encryptionKey) {
        tokenDto.encryptionKey = meetingToken.encryptionKey;
      }
      if (meetingToken.expiresAt) {
        tokenDto.expiresAt = meetingToken.expiresAt;
      }

      return tokenDto;
    } catch (_error) {
      const errorClinicId = req.clinicContext?.clinicId || '';
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      // Reduce log level for expected validation errors (non-video appointments)
      const isExpectedValidationError =
        errorMessage.includes('not a video consultation') ||
        errorMessage.includes('not a video appointment');
      await this.loggingService.log(
        LogType.ERROR,
        isExpectedValidationError ? LogLevel.WARN : LogLevel.ERROR,
        `Failed to generate join token for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          clinicId: errorClinicId,
          userId: req.user?.sub,
          error: errorMessage,
        }
      );
      throw _error;
    }
  }

  @Post(':id/video/start')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @ApiOperation({
    summary: 'Start video consultation',
    description: 'Start the video consultation session and track participant joining.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Video consultation started successfully',
    type: VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Appointment is not a video consultation',
  })
  async startVideoConsultation(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const userId = req.user?.sub;
      const userRole = req.user?.role;

      if (!userId) {
        throw new BadRequestException('User ID required');
      }

      const consultationRole = userRole === Role.PATIENT ? 'patient' : 'doctor';

      // Get appointment to validate type
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Runtime validation at boundary - narrow to VideoCallAppointment
      if (!isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'This appointment is not a video consultation. Video consultations can only be started for VIDEO_CALL appointments.'
        );
      }

      // TypeScript now knows appointment is VideoCallAppointment

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Starting video consultation for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          userId,
          role: consultationRole,
        }
      );

      const session = await this.videoService.startConsultation(
        appointmentId,
        userId,
        consultationRole
      );

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
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          userId: req.user?.sub,
          error: _error instanceof Error ? _error.message : 'Unknown error',
        }
      );
      throw _error;
    }
  }

  @Post(':id/video/end')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @ApiOperation({
    summary: 'End video consultation',
    description: 'End the video consultation session and save meeting notes.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({
    type: EndVideoConsultationDto,
    description: 'End consultation request with optional meeting notes',
    schema: {
      type: 'object',
      properties: {
        meetingNotes: {
          type: 'string',
          description: 'Optional meeting notes from the consultation',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Video consultation ended successfully',
    type: VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Appointment is not a video consultation',
  })
  async endVideoConsultation(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() body: { meetingNotes?: string },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const userId = req.user?.sub;
      const userRole = req.user?.role;

      if (!userId) {
        throw new BadRequestException('User ID required');
      }

      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      // Get appointment to validate type
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Runtime validation at boundary - narrow to VideoCallAppointment
      if (!isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'This appointment is not a video consultation. Video consultations can only be ended for VIDEO_CALL appointments.'
        );
      }

      // TypeScript now knows appointment is VideoCallAppointment

      const consultationRole = userRole === Role.PATIENT ? 'patient' : 'doctor';

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Ending video consultation for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          userId,
          role: consultationRole,
          hasNotes: !!body.meetingNotes,
        }
      );

      const session = await this.videoService.endConsultation(
        appointmentId,
        userId,
        consultationRole,
        body.meetingNotes
      );

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
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to end consultation for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          userId: req.user?.sub,
          error: _error instanceof Error ? _error.message : 'Unknown error',
        }
      );
      throw _error;
    }
  }

  @Get(':id/video/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Get video consultation status',
    description: 'Get the current status and details of the video consultation session.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Video consultation status retrieved successfully',
    type: VideoConsultationSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Video consultation session not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Appointment is not a video consultation',
  })
  async getVideoConsultationStatus(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VideoConsultationSessionDto> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      // Get appointment to validate type
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Runtime validation at boundary - narrow to VideoCallAppointment
      if (!isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'This appointment is not a video consultation. Video consultation status can only be retrieved for VIDEO_CALL appointments.'
        );
      }

      // TypeScript now knows appointment is VideoCallAppointment

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Getting video consultation status for appointment ${appointmentId}`,
        'AppointmentsController',
        { appointmentId }
      );

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
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      // Reduce log level for expected validation errors (non-video appointments)
      const isExpectedValidationError =
        errorMessage.includes('not a video consultation') ||
        errorMessage.includes('not a video appointment');
      await this.loggingService.log(
        LogType.ERROR,
        isExpectedValidationError ? LogLevel.WARN : LogLevel.ERROR,
        `Failed to get consultation status for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          error: errorMessage,
        }
      );
      throw _error;
    }
  }

  @Post(':id/video/report-issue')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: true,
  })
  @ApiOperation({
    summary: 'Report technical issue',
    description: 'Report a technical issue during the video consultation for support tracking.',
  })
  @ApiParam({
    name: 'id',
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
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Appointment is not a video consultation',
  })
  async reportTechnicalIssue(
    @Param('id', ParseUUIDPipe) appointmentId: string,
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

      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw new BadRequestException('Clinic context is required');
      }

      // Get appointment to validate type
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations;
      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Runtime validation at boundary - narrow to VideoCallAppointment
      if (!isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'This appointment is not a video consultation. Technical issues can only be reported for VIDEO_CALL appointments.'
        );
      }

      // TypeScript now knows appointment is VideoCallAppointment

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Technical issue reported for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          userId,
          issueType: body.issueType,
        }
      );

      await this.videoService.reportTechnicalIssue(
        appointmentId,
        userId,
        body.description,
        body.issueType
      );

      return new SuccessResponseDto('Technical issue reported successfully');
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to report technical issue for appointment ${appointmentId}`,
        'AppointmentsController',
        {
          appointmentId,
          userId: req.user?.sub,
          error: _error instanceof Error ? _error.message : 'Unknown error',
        }
      );
      throw _error;
    }
  }

  // =============================================
  // APPOINTMENT LIFECYCLE ENDPOINTS
  // =============================================

  /**
   * Complete an appointment
   * POST /appointments/:id/complete
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
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
    type: AppointmentResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Check in patient for appointment
   * POST /appointments/:id/check-in
   */
  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
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
    description: 'Check-in processed successfully',
  })
  @InvalidateAppointmentCache()
  async checkInAppointment(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) checkInDto: ProcessCheckInDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.checkInAppointment';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      await this.appointmentService.processCheckIn(
        { ...checkInDto, appointmentId },
        userId,
        clinicId,
        req.user?.role || 'USER'
      );

      await this.loggingService.log(
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
      await this.loggingService.log(
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

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Staff override: Force check-in for appointment (bypasses time window)
   * POST /appointments/:id/check-in/force
   */
  @Post(':id/check-in/force')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RECEPTIONIST, Role.DOCTOR, Role.CLINIC_ADMIN, Role.NURSE, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 10, duration: 60 })
  @ApiOperation({
    summary: 'Staff override: Force check-in',
    description:
      'Staff-only endpoint to force check-in for an appointment, bypassing time window restrictions. Requires audit logging with reason.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          description:
            'Reason for staff override (e.g., "Patient arrived late", "Technical issue")',
          example: 'Patient arrived late due to traffic',
        },
        locationId: {
          type: 'string',
          description: 'Optional location ID if different from appointment location',
        },
        coordinates: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
          },
        },
        deviceInfo: { type: 'object' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Forced check-in processed successfully',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions (staff only)',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Appointment not found',
  })
  @InvalidateAppointmentCache()
  async forceCheckInAppointment(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe)
    forceCheckInDto: {
      reason: string;
      locationId?: string;
      coordinates?: { lat: number; lng: number };
      deviceInfo?: Record<string, unknown>;
    },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string; overrideReason: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.forceCheckInAppointment';
    const userId = req.user?.sub || req.user?.id || '';
    const userRole = req.user?.role;
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      if (!userId) {
        throw this.errors.authenticationError('User not authenticated', context);
      }

      if (!forceCheckInDto.reason || forceCheckInDto.reason.trim().length === 0) {
        throw this.errors.validationError(
          'reason',
          'Override reason is required for audit logging',
          context
        );
      }

      // Get appointment to verify it exists and get location
      const appointment = (await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId
      )) as AppointmentWithRelations | null;
      if (!appointment) {
        throw this.errors.appointmentNotFound(appointmentId, context);
      }

      // Check if already checked in
      if (appointment.checkedInAt) {
        throw this.errors.checkInAlreadyCheckedIn(appointmentId, context);
      }

      // Get location (use provided locationId or appointment locationId)
      const locationId = forceCheckInDto.locationId || appointment.locationId;
      const location = await this.checkInLocationService.getLocationById(locationId);

      // Verify location belongs to clinic
      if (location.clinicId !== clinicId) {
        throw this.errors.insufficientPermissions(context);
      }

      // Log staff override action with audit trail
      await this.loggingService.log(
        LogType.AUDIT,
        LogLevel.WARN,
        'Staff override: Forced check-in outside time window',
        context,
        {
          appointmentId,
          userId,
          userRole,
          clinicId,
          locationId,
          overrideReason: forceCheckInDto.reason,
          appointmentTime: appointment.date
            ? `${appointment.date.toISOString()} ${appointment.time}`
            : 'N/A',
          currentTime: new Date().toISOString(),
        }
      );

      // Process check-in with staff override flag
      const checkInData: {
        appointmentId: string;
        locationId: string;
        patientId: string;
        coordinates?: { lat: number; lng: number };
        deviceInfo?: Record<string, unknown>;
      } = {
        appointmentId,
        locationId,
        patientId: appointment.patientId || userId,
      };

      if (forceCheckInDto.coordinates) {
        checkInData.coordinates = forceCheckInDto.coordinates;
      }
      if (forceCheckInDto.deviceInfo) {
        checkInData.deviceInfo = forceCheckInDto.deviceInfo;
      }

      const checkIn = await this.checkInLocationService.processCheckIn(checkInData);

      // Log successful forced check-in
      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Staff override check-in completed successfully',
        context,
        {
          appointmentId,
          checkInId: checkIn.id,
          userId,
          userRole,
          clinicId,
          overrideReason: forceCheckInDto.reason,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: {
          message: 'Forced check-in processed successfully',
          overrideReason: forceCheckInDto.reason,
        },
      };
    } catch (error) {
      await this.loggingService.log(
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

      throw this.errors.internalServerError(context);
    }
  }

  /**
   * Start consultation
   * POST /appointments/:id/start
   */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @RateLimitAPI({ points: 20, duration: 60 })
  @ApiOperation({
    summary: 'Start consultation',
    description: 'Starts the consultation for an appointment',
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the appointment',
    type: 'string',
  })
  @ApiBody({
    type: StartConsultationDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consultation started successfully',
  })
  @InvalidateAppointmentCache()
  async startConsultation(
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body(ValidationPipe) startDto: StartConsultationDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<{ message: string }>> {
    const startTime = Date.now();
    const context = 'AppointmentsController.startConsultation';
    const userId = req.user?.id || '';
    const clinicId = req.clinicContext?.clinicId || '';

    try {
      await this.appointmentService.startConsultation(
        appointmentId,
        startDto,
        userId,
        clinicId,
        req.user?.role || 'USER'
      );

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Consultation started via API',
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
        data: { message: 'Consultation started successfully' },
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${error instanceof Error ? error.message : String(error)}`,
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

  // =============================================
  // QR CODE CHECK-IN ENDPOINTS
  // =============================================

  @Post('check-in/scan-qr')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'update')
  @InvalidateAppointmentCache({
    patterns: ['appointments:detail:*', 'appointments:upcoming:*', 'appointments:my:*'],
    tags: ['appointments', 'appointment_data', 'check_in'],
  })
  @ApiOperation({
    summary: 'Scan location QR code and check in',
    description:
      'Scans a location QR code and automatically checks in the patient if they have a valid appointment for that location. Validates appointment, processes check-in, and adds patient to doctor queue.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: ScanLocationQRDto,
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
    description: 'Invalid QR code, wrong location, or already checked in',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  async scanLocationQRAndCheckIn(
    @Body() scanDto: ScanLocationQRDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<ScanLocationQRResponseDto['data']>> {
    const context = 'AppointmentsController.scanLocationQRAndCheckIn';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      if (!userId) {
        throw this.errors.authenticationError('User not authenticated', context);
      }

      await this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        'Scanning location QR code for check-in',
        context,
        {
          userId,
          clinicId,
          qrCode: scanDto.qrCode.substring(0, 20) + '...', // Log partial QR for security
        }
      );

      // Step 1: Verify QR code format and get location
      // First, try to parse QR code as JSON (LocationQrService format)
      let locationIdFromQR: string | null = null;
      try {
        const qrData = JSON.parse(scanDto.qrCode) as {
          locationId?: string;
          type?: string;
        };
        if (qrData.locationId && qrData.type === 'LOCATION_CHECK_IN') {
          locationIdFromQR = qrData.locationId;
          // Verify QR code is valid
          await this.locationQrService.verifyLocationQR(scanDto.qrCode, qrData.locationId);
        }
      } catch {
        // If not JSON format, treat as direct QR code string (database lookup)
      }

      // Get location by QR code (works with both JSON format and direct QR string)
      const location = await this.checkInLocationService.getLocationByQRCode(scanDto.qrCode);

      if (!location.isActive) {
        throw this.errors.validationError('location', 'Check-in location is not active', context, {
          locationId: location.id,
        });
      }

      // If QR code was in JSON format, verify it matches the location
      if (locationIdFromQR && locationIdFromQR !== location.id) {
        throw this.errors.validationError(
          'qrCode',
          'QR code does not match the location',
          context,
          { qrLocationId: locationIdFromQR, dbLocationId: location.id }
        );
      }

      // Step 2: Find user's appointments for this location
      const appointments = await this.appointmentService.findUserAppointmentsByLocation(
        userId,
        location.id,
        clinicId
      );

      if (appointments.length === 0) {
        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.WARN,
          'No appointment found for location QR scan',
          context,
          {
            userId,
            locationId: location.id,
            clinicId,
          }
        );

        throw this.errors.checkInNoAppointmentFound(location.id, context);
      }

      // Step 3: Handle multiple appointments or specific appointment selection
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Filter out already checked-in appointments
      const eligibleAppointments = appointments.filter(a => !a.checkedInAt);

      if (eligibleAppointments.length === 0) {
        throw this.errors.checkInNoAppointmentFound(location.id, context);
      }

      // If appointmentId is provided, use that specific appointment
      let appointment = eligibleAppointments[0];
      if (scanDto.appointmentId) {
        const specifiedAppointment = eligibleAppointments.find(a => a.id === scanDto.appointmentId);
        if (!specifiedAppointment) {
          throw this.errors.appointmentNotFound(scanDto.appointmentId, context);
        }
        appointment = specifiedAppointment;
      } else if (eligibleAppointments.length > 1) {
        // Multiple appointments - return them for client selection
        // Sort appointments: today first, then by date/time
        const sortedAppointments = eligibleAppointments.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);

          // Today's appointments first
          const aIsToday = dateA.toDateString() === today.toDateString();
          const bIsToday = dateB.toDateString() === today.toDateString();

          if (aIsToday && !bIsToday) return -1;
          if (!aIsToday && bIsToday) return 1;

          // Then by date/time
          if (dateA.getTime() !== dateB.getTime()) {
            return dateA.getTime() - dateB.getTime();
          }

          // Finally by time
          return a.time.localeCompare(b.time);
        });

        // Return multiple appointments for client selection
        return {
          success: false,
          data: {
            requiresSelection: true,
            eligibleAppointments: sortedAppointments.map(a => ({
              id: a.id,
              date: a.date,
              time: a.time,
              doctor: a.doctor
                ? { id: a.doctor.id, name: a.doctor.user?.name || 'Doctor' }
                : undefined,
              type: a.type,
              status: a.status,
            })),
            message: `Multiple appointments found. Please specify appointmentId to check in.`,
          } as unknown as {
            appointmentId: string;
            locationId: string;
            locationName: string;
            checkedInAt: string;
            queuePosition: number;
            totalInQueue: number;
            estimatedWaitTime: number;
            doctorId: string;
            doctorName: string;
          },
        };
      } else {
        // Single appointment - proceed normally
        appointment = eligibleAppointments[0];
      }

      if (!appointment) {
        throw this.errors.checkInNoAppointmentFound(location.id, context);
      }

      // Step 4: Validate appointment
      if (appointment.locationId !== location.id) {
        throw this.errors.checkInWrongLocation(appointment.locationId, location.id, context);
      }

      // Check if already checked in
      if (appointment.checkedInAt) {
        throw this.errors.checkInAlreadyCheckedIn(appointment.id, context);
      }

      // Step 4.5: Validate time window for check-in (30 min before to 2 hours after)
      const userRole = req.user?.role;
      const staffRoles: string[] = [
        Role.RECEPTIONIST,
        Role.DOCTOR,
        Role.CLINIC_ADMIN,
        Role.SUPER_ADMIN,
        Role.NURSE,
      ];
      const isStaff = userRole && staffRoles.includes(userRole);

      // Parse appointment date and time
      const appointmentDate = new Date(appointment.date);
      const timeParts = appointment.time.split(':').map(Number);
      const hours = timeParts[0] ?? 0;
      const minutes = timeParts[1] ?? 0;
      appointmentDate.setHours(hours, minutes, 0, 0);

      const now = new Date();
      const thirtyMinutesBefore = new Date(appointmentDate);
      thirtyMinutesBefore.setMinutes(thirtyMinutesBefore.getMinutes() - 30);
      const twoHoursAfter = new Date(appointmentDate);
      twoHoursAfter.setHours(twoHoursAfter.getHours() + 2);

      const isWithinWindow = now >= thirtyMinutesBefore && now <= twoHoursAfter;

      if (!isWithinWindow && !isStaff) {
        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.WARN,
          'Check-in attempted outside time window',
          context,
          {
            appointmentId: appointment.id,
            appointmentTime: appointmentDate.toISOString(),
            currentTime: now.toISOString(),
            userId,
            userRole,
          }
        );

        throw this.errors.checkInTimeWindowExpired(
          appointmentDate.toISOString(),
          now.toISOString(),
          context
        );
      }

      // Log staff override if applicable
      if (!isWithinWindow && isStaff) {
        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.INFO,
          'Staff override: Check-in outside time window',
          context,
          {
            appointmentId: appointment.id,
            appointmentTime: appointmentDate.toISOString(),
            currentTime: now.toISOString(),
            userId,
            userRole,
            overrideReason: 'Staff override',
          }
        );
      }

      // Step 5: Process check-in using CheckInLocationService
      // Use the interface type from @core/types which has all required properties
      const checkInData: {
        appointmentId: string;
        locationId: string;
        patientId: string;
        coordinates?: { lat: number; lng: number };
        deviceInfo?: Record<string, unknown>;
      } = {
        appointmentId: appointment.id,
        locationId: location.id,
        patientId: userId,
      };
      if (scanDto.coordinates !== undefined) {
        checkInData.coordinates = scanDto.coordinates;
      }
      if (scanDto.deviceInfo !== undefined) {
        checkInData.deviceInfo = scanDto.deviceInfo;
      }

      const checkIn = await this.checkInLocationService.processCheckIn(checkInData);

      // Step 6: Add to doctor queue
      let queuePosition: {
        position: number;
        totalInQueue: number;
        estimatedWaitTime: number;
      } | null = null;

      try {
        const queueResponse = await this.appointmentQueueService.getPatientQueuePosition(
          appointment.id,
          'healthcare' // Use default domain since appointment.domain doesn't exist
        );

        if (queueResponse && typeof queueResponse === 'object' && 'position' in queueResponse) {
          const response = queueResponse as {
            position?: number;
            totalInQueue?: number;
            estimatedWaitTime?: number;
          };
          queuePosition = {
            position: response.position || 0,
            totalInQueue: response.totalInQueue || 0,
            estimatedWaitTime: response.estimatedWaitTime || 0,
          };
        }
      } catch (queueError) {
        // Queue position is optional, log but don't fail
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Failed to get queue position after check-in',
          context,
          {
            appointmentId: appointment.id,
            error: queueError instanceof Error ? queueError.message : String(queueError),
          }
        );
      }

      // Step 7: Get doctor information
      const doctorName = appointment.doctor?.user?.name || 'Doctor';
      const doctorId =
        (appointment as { doctorId?: string; doctor?: { id: string } }).doctorId ||
        appointment.doctor?.id ||
        '';

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Location QR check-in successful',
        context,
        {
          appointmentId: appointment.id,
          locationId: location.id,
          userId,
          clinicId,
          queuePosition: queuePosition?.position,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        data: {
          appointmentId: appointment.id,
          locationId: location.id,
          locationName: location.locationName,
          checkedInAt: checkIn.checkInTime.toISOString(),
          queuePosition: queuePosition?.position || 0,
          totalInQueue: queuePosition?.totalInQueue || 0,
          estimatedWaitTime: queuePosition?.estimatedWaitTime || 0,
          doctorId,
          doctorName,
        },
        message: 'Checked in successfully',
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to scan QR and check in: ${error instanceof Error ? error.message : String(error)}`,
        context,
        {
          qrCode: scanDto.qrCode.substring(0, 20) + '...',
          userId: req.user?.sub,
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
  // CHECK-IN LOCATION MANAGEMENT ENDPOINTS
  // =============================================

  @Get('check-in/locations')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST, Role.SUPER_ADMIN)
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
    @Body()
    createDto: { locationName: string; coordinates: { lat: number; lng: number }; radius: number },
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
      });

      await this.loggingService.log(
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
      await this.loggingService.log(
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

      if (error instanceof HealthcareError) {
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
    @Body()
    updateDto: {
      locationName?: string;
      coordinates?: { lat: number; lng: number };
      radius?: number;
      isActive?: boolean;
    },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ServiceResponse<CheckInLocation>> {
    const context = 'AppointmentsController.updateCheckInLocation';
    const startTime = Date.now();

    try {
      const clinicId = req.clinicContext?.clinicId;
      if (!clinicId) {
        throw this.errors.validationError('clinicId', 'Clinic context is required', context);
      }

      const location = await this.checkInLocationService.updateCheckInLocation(
        locationId,
        updateDto
      );

      // Verify location belongs to clinic
      if (location.clinicId !== clinicId) {
        throw this.errors.insufficientPermissions(context);
      }

      await this.loggingService.log(
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
      await this.loggingService.log(
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

      if (error instanceof HealthcareError) {
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
      const location = await this.checkInLocationService.getLocationById(locationId);
      if (location.clinicId !== clinicId) {
        throw this.errors.insufficientPermissions(context);
      }

      await this.checkInLocationService.deleteCheckInLocation(locationId);

      await this.loggingService.log(
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
      await this.loggingService.log(
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

      if (error instanceof HealthcareError) {
        throw error;
      }

      throw this.errors.internalServerError(context);
    }
  }

  @Get('locations/:locationId/qr-code')
  @RateLimitAPI()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
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
      const qrCodeDataString = await this.locationQrService.generateLocationQR(location.id);

      // Generate QR code image using QrService
      const qrCodeDataUrl = await this.qrService.generateQR(qrCodeDataString);

      await this.loggingService.log(
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
      await this.loggingService.log(
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

  // =============================================
  // FOLLOW-UP APPOINTMENT ENDPOINTS
  // =============================================

  /**
   * Create a follow-up plan for an appointment
   * POST /appointments/:id/follow-up
   */
  @Post(':id/follow-up')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
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

      await this.loggingService.log(
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
            | 'routine'
            | 'urgent'
            | 'specialist'
            | 'therapy'
            | 'surgery',
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
      await this.loggingService.log(
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
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
    type: AppointmentChainResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
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
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Follow-up plans retrieved successfully',
    type: [FollowUpPlanResponseDto],
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
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
    type: ScheduleFollowUpDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Appointment scheduled successfully',
    type: AppointmentResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
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
    type: [AppointmentResponseDto],
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
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
    type: UpdateFollowUpPlanDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Follow-up plan updated successfully',
    type: FollowUpPlanResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
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
    type: CreateRecurringSeriesDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Recurring series created successfully',
    type: RecurringSeriesResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
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
    type: RecurringSeriesResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
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
    type: UpdateRecurringSeriesDto,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Series updated successfully',
    type: RecurringSeriesResponseDto,
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST, Role.PATIENT)
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
      timestamp: new Date().toISOString(),
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
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    keyTemplate: 'appointments:analytics:wait-times:{from}:{to}:{locationId}',
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    keyTemplate: 'appointments:analytics:check-in-patterns:{from}:{to}:{locationId}',
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.SUPER_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission('appointments', 'read')
  @Cache({
    keyTemplate: 'appointments:analytics:no-show-correlation:{from}:{to}:{locationId}',
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

      await this.loggingService.log(
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
      await this.loggingService.log(
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
  @ApiOperation({ summary: 'Generate appointment QR code' })
  @ApiResponse({ status: 200, description: 'QR code generated successfully' })
  async generateQR(
    @Param('id') appointmentId: string,
    @Request() _req: ClinicAuthenticatedRequest
  ) {
    const qrCode = await this.qrService.generateAppointmentQR(appointmentId);
    return {
      success: true,
      data: { qrCode },
    };
  }

  @Post('verify-qr')
  @Roles(Role.RECEPTIONIST, Role.DOCTOR)
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
}
