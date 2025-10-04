import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  NotFoundException,
  Request,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { AppointmentsService } from "./appointments.service";
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
} from "@nestjs/swagger";
import { UseGuards } from "@nestjs/common";
import {
  Role,
  AppointmentStatus,
} from "../../libs/infrastructure/database/prisma/prisma.types";
import { JwtAuthGuard, RolesGuard, Roles } from "../../libs/core";
import { ClinicGuard } from "../../libs/core/guards/clinic.guard";
import { ClinicRoute } from "../../libs/core/decorators/clinic-route.decorator";
import {
  HealthcareErrorsService,
  HealthcareError,
} from "../../libs/core/errors";
import {
  LoggingService,
  LogType,
  LogLevel,
} from "../../libs/infrastructure/logging";
import { CacheService } from "../../libs/infrastructure/cache/cache.service";
import {
  Cache,
  PatientCache,
  InvalidatePatientCache,
} from "../../libs/infrastructure/cache/decorators/cache.decorator";
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
  AppointmentListResponseDto,
  DoctorAvailabilityResponseDto,
} from "./appointment.dto";
import { RbacGuard } from "../../libs/core/rbac/rbac.guard";
import { RequireResourcePermission } from "../../libs/core/rbac/rbac.decorators";
import { AuthenticatedRequest } from "../../libs/core/types/clinic.types";
import { RateLimitAPI } from "../../libs/security/rate-limit/rate-limit.decorator";
import {
  JitsiVideoService,
  JitsiMeetingToken,
  VideoConsultationSession,
} from "./plugins/video/jitsi-video.service";

// Type definitions for controller interfaces
interface AppointmentFilters {
  userId?: string;
  doctorId?: string;
  status?: AppointmentStatus;
  date?: string;
  locationId?: string;
  clinicId: string;
  page: number;
  limit: number;
}

interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

@ApiTags("Appointments")
@Controller("appointments")
@ApiBearerAuth()
@ApiSecurity("session-id")
@ApiHeader({
  name: "X-Clinic-ID",
  description: "Clinic identifier",
  required: true,
})
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  }),
)
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name);

  constructor(
    private readonly appointmentService: AppointmentsService,
    private readonly errors: HealthcareErrorsService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    private readonly jitsiVideoService: JitsiVideoService,
  ) {}

  @Post()
  @RateLimitAPI()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "create")
  @ApiOperation({
    summary: "Create a new appointment",
    description:
      "Create a new appointment with the specified details. Patients can create their own appointments, while staff can create appointments for patients. Requires valid clinic context and appropriate permissions.",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: CreateAppointmentDto,
    description: "Appointment creation data",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Appointment created successfully",
    type: AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid appointment data or validation errors",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions or invalid clinic context",
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: "Doctor not available at requested time",
  })
  async createAppointment(
    @Body() appointmentData: CreateAppointmentDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException("Clinic context is required");
      }

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(
        `Creating appointment for user ${userId} in clinic ${clinicId}`,
      );

      const result = await this.appointmentService.createAppointment(
        appointmentData,
        userId,
        clinicId,
        req.user?.role || Role.PATIENT,
      );

      this.logger.log(
        `Appointment created successfully: ${result.success ? "Success" : "Failed"}`,
      );
      return result as ServiceResponse<AppointmentResponseDto>;
    } catch (_error) {
      this.logger.error(
        `Failed to create appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        _error instanceof Error ? _error.stack : undefined,
      );

      if (_error instanceof BadRequestException) {
        throw _error;
      }

      if (_error instanceof Error && _error.message.includes("not available")) {
        throw new BadRequestException(_error.message);
      }

      throw _error;
    }
  }

  @Get("my-appointments")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "read", { requireOwnership: true })
  @PatientCache({
    keyTemplate: "appointments:my:{userId}:{clinicId}",
    ttl: 300,
    tags: ["appointments", "patient_appointments"],
    priority: "high",
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: "Get current user appointments",
    description:
      "Get appointments for the currently authenticated patient. Only returns appointments for the authenticated user.",
  })
  @ApiQuery({
    name: "status",
    required: false,
    description: "Filter by appointment status",
    enum: [
      "PENDING",
      "SCHEDULED",
      "CONFIRMED",
      "CANCELLED",
      "COMPLETED",
      "NO_SHOW",
    ],
  })
  @ApiQuery({
    name: "date",
    required: false,
    description: "Filter by appointment date (YYYY-MM-DD)",
  })
  @ApiQuery({
    name: "page",
    required: false,
    description: "Page number for pagination",
    type: Number,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Number of items per page",
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Return user appointments",
    type: AppointmentListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Only patients can access this endpoint",
  })
  async getMyAppointments(
    @Request() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("date") date?: string,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 10,
  ): Promise<ServiceResponse<AppointmentListResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID not found");
      }

      if (!clinicId) {
        throw new BadRequestException("Clinic context is required");
      }

      this.logger.log(
        `Getting appointments for user ${userId} in clinic ${clinicId}`,
      );

      const filters: AppointmentFilters = {
        userId,
        clinicId,
        status: status as AppointmentStatus,
        date,
        page: Math.max(1, page),
        limit: Math.min(100, Math.max(1, limit)),
      };

      const result = await this.appointmentService.getAppointments(
        filters,
        userId,
        clinicId,
        req.user?.role || Role.PATIENT,
        filters.page || 1,
        filters.limit || 20,
      );

      this.logger.log(
        `Retrieved ${(result.data as AppointmentResponseDto[])?.length || 0} appointments for user ${userId}`,
      );
      return result as ServiceResponse<AppointmentListResponseDto>;
    } catch (_error) {
      this.logger.error(
        `Failed to get my appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      throw _error;
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "read")
  @Cache({
    keyTemplate: "appointments:list:{clinicId}:{filters}",
    ttl: 300,
    staleTime: 60,
    tags: ["appointments", "clinic_appointments"],
    priority: "normal",
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: "Get all appointments",
    description:
      "Get all appointments with optional filtering. Only clinic staff can access this endpoint. Supports pagination and various filters.",
  })
  @ApiQuery({
    name: "userId",
    required: false,
    description: "Filter by patient user ID",
  })
  @ApiQuery({
    name: "doctorId",
    required: false,
    description: "Filter by doctor ID",
  })
  @ApiQuery({
    name: "status",
    required: false,
    description: "Filter by appointment status",
    enum: [
      "PENDING",
      "SCHEDULED",
      "CONFIRMED",
      "CANCELLED",
      "COMPLETED",
      "NO_SHOW",
    ],
  })
  @ApiQuery({
    name: "date",
    required: false,
    description: "Filter by appointment date (YYYY-MM-DD)",
  })
  @ApiQuery({
    name: "locationId",
    required: false,
    description: "Filter by location ID",
  })
  @ApiQuery({
    name: "page",
    required: false,
    description: "Page number for pagination",
    type: Number,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Number of items per page",
    type: Number,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Return all appointments",
    type: AppointmentListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Only clinic staff can access this endpoint",
  })
  async getAppointments(
    @Request() req: AuthenticatedRequest,
    @Query("userId") userId?: string,
    @Query("doctorId") doctorId?: string,
    @Query("status") status?: string,
    @Query("date") date?: string,
    @Query("locationId") locationId?: string,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 10,
  ): Promise<ServiceResponse<AppointmentListResponseDto>> {
    const context = "AppointmentsController.getAppointments";

    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw this.errors.validationError(
          "clinicId",
          "Clinic context is required",
          context,
        );
      }

      // Log the operation with proper structure
      await this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        "Retrieving appointments list",
        context,
        {
          userId: currentUserId,
          clinicId,
          filters: { userId, doctorId, status, date, locationId, page, limit },
          operation: "getAppointments",
        },
      );

      const filters: AppointmentFilters = {
        userId,
        doctorId,
        status: status as AppointmentStatus,
        date,
        locationId,
        clinicId,
        page: Math.max(1, page),
        limit: Math.min(100, Math.max(1, limit)),
      };

      const result = await this.appointmentService.getAppointments(
        filters,
        clinicId,
        currentUserId,
      );

      // Log successful operation
      await this.loggingService.log(
        LogType.RESPONSE,
        LogLevel.INFO,
        `Retrieved ${(result.data as AppointmentResponseDto[])?.length || 0} appointments successfully`,
        context,
        {
          userId: currentUserId,
          clinicId,
          appointmentCount:
            (result.data as AppointmentResponseDto[])?.length || 0,
          operation: "getAppointments",
        },
      );

      return result as ServiceResponse<AppointmentListResponseDto>;
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, context);
        throw _error;
      }

      // Log the error with proper structure
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to retrieve appointments: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
        context,
        {
          userId: req.user?.sub,
          clinicId: req.clinicContext?.clinicId,
          filters: { userId, doctorId, status, date, locationId, page, limit },
          _error: _error instanceof Error ? _error.stack : String(_error),
          operation: "getAppointments",
        },
      );

      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  @Get("doctor/:doctorId/availability")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR, Role.CLINIC_ADMIN)
  @RequireResourcePermission("appointments", "read")
  @Cache({
    keyTemplate: "appointments:availability:{doctorId}:{date}",
    ttl: 180,
    tags: ["appointments", "doctor_availability"],
    priority: "high",
    enableSWR: true,
    containsPHI: false,
    compress: false,
  })
  @ApiOperation({
    summary: "Get doctor availability",
    description:
      "Check a doctor's availability for a specific date. Returns available time slots and working hours.",
  })
  @ApiParam({
    name: "doctorId",
    description: "ID of the doctor",
    type: "string",
    format: "uuid",
  })
  @ApiQuery({
    name: "date",
    description: "Date to check availability for (YYYY-MM-DD)",
    required: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Return doctor availability",
    type: DoctorAvailabilityResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid date format or missing date parameter",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Doctor not found",
  })
  async getDoctorAvailability(
    @Param("doctorId", ParseUUIDPipe) doctorId: string,
    @Query("date") date: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<DoctorAvailabilityResponseDto> {
    try {
      const clinicId =
        req.user?.clinicId ||
        (req.headers?.["clinic-id"] as string | undefined);

      if (!clinicId) {
        throw new BadRequestException("Clinic ID is required");
      }

      if (!date) {
        throw new BadRequestException("Date parameter is required");
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        throw new BadRequestException("Date must be in YYYY-MM-DD format");
      }

      // Check if date is not in the past
      const requestedDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (requestedDate < today) {
        throw new BadRequestException(
          "Cannot check availability for past dates",
        );
      }

      this.logger.log(
        `Checking availability for doctor ${doctorId} on ${date}`,
      );

      const result = (await this.appointmentService.getDoctorAvailability(
        doctorId,
        date,
        clinicId,
        req.user?.sub,
        req.user?.role || Role.PATIENT,
      )) as DoctorAvailabilityResponseDto;

      this.logger.log(
        `Retrieved availability for doctor ${doctorId}: ${result.availableSlots?.length || 0} slots available`,
      );
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get doctor availability: ${_error instanceof Error ? _error.message : String(_error)}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      throw _error;
    }
  }

  @Get("user/:userId/upcoming")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission("appointments", "read")
  @PatientCache({
    keyTemplate: "appointments:upcoming:{userId}",
    ttl: 600,
    tags: ["appointments", "upcoming_appointments"],
    priority: "high",
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: "Get user upcoming appointments",
    description:
      "Get upcoming appointments for a specific user. Patients can only access their own upcoming appointments.",
  })
  @ApiParam({
    name: "userId",
    description: "ID of the user",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Return user upcoming appointments",
    type: [AppointmentResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Cannot access other user's appointments",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "User not found",
  })
  async getUserUpcomingAppointments(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<AppointmentResponseDto[]> {
    try {
      const currentUserId = req.user?.sub;
      const clinicId =
        req.user?.clinicId ||
        (req.headers?.["clinic-id"] as string | undefined);

      if (!clinicId) {
        throw new BadRequestException("Clinic ID is required");
      }

      // Patients can only access their own upcoming appointments
      if (req.user?.role === Role.PATIENT && currentUserId !== userId) {
        throw new ForbiddenException(
          "Patients can only access their own appointments",
        );
      }

      this.logger.log(
        `Getting upcoming appointments for user ${userId} (requested by ${currentUserId})`,
      );

      const result = (await this.appointmentService.getUserUpcomingAppointments(
        userId,
        clinicId,
        req.user?.role || Role.PATIENT,
      )) as AppointmentResponseDto[];

      this.logger.log(
        `Retrieved ${result?.length || 0} upcoming appointments for user ${userId}`,
      );
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get user appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      throw _error;
    }
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "read", { requireOwnership: true })
  @PatientCache({
    keyTemplate: "appointments:detail:{id}",
    ttl: 1800,
    tags: ["appointments", "appointment_details"],
    priority: "high",
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: "Get an appointment by ID",
    description:
      "Get detailed information about a specific appointment. Patients can only access their own appointments.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Return the appointment",
    type: AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Cannot access this appointment",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Appointment not found",
  })
  async getAppointmentById(
    @Param("id", ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<AppointmentResponseDto> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException("Clinic context is required");
      }

      this.logger.log(
        `Getting appointment ${id} for user ${currentUserId} in clinic ${clinicId}`,
      );

      const result = (await this.appointmentService.getAppointmentById(
        id,
        clinicId,
      )) as AppointmentResponseDto;

      // Additional security check for patients
      if (req.user?.role === Role.PATIENT) {
        const patient = (await this.appointmentService.getPatientByUserId(
          currentUserId,
        )) as { id: string } | null;
        if (result.patient?.id !== patient?.id) {
          throw new ForbiddenException(
            "Patients can only access their own appointments",
          );
        }
      }

      this.logger.log(`Retrieved appointment ${id} successfully`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get appointment ${id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      throw _error;
    }
  }

  @Put(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "update", {
    requireOwnership: true,
  })
  @InvalidatePatientCache({
    patterns: [
      "appointments:detail:{id}",
      "appointments:my:*",
      "appointments:upcoming:*",
      "appointments:list:*",
    ],
    tags: [
      "appointments",
      "appointment_details",
      "patient_appointments",
      "upcoming_appointments",
      "clinic_appointments",
    ],
  })
  @ApiOperation({
    summary: "Update an appointment",
    description:
      "Update an existing appointment's details. Patients can only update their own appointments.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: UpdateAppointmentDto,
    description: "Appointment update data",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Appointment updated successfully",
    type: AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid update data",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Cannot update this appointment",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Appointment not found",
  })
  async updateAppointment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() updateData: UpdateAppointmentDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException("Clinic context is required");
      }

      this.logger.log(
        `Updating appointment ${id} by user ${currentUserId} in clinic ${clinicId}`,
      );

      // Additional security check for patients
      if (req.user?.role === Role.PATIENT) {
        const patient = (await this.appointmentService.getPatientByUserId(
          currentUserId,
        )) as { id: string } | null;
        const appointment = (await this.appointmentService.getAppointmentById(
          id,
          clinicId,
        )) as { patientId: string };
        if (appointment.patientId !== patient?.id) {
          throw new ForbiddenException(
            "Patients can only update their own appointments",
          );
        }
      }

      const result = await this.appointmentService.updateAppointment(
        id,
        updateData,
        currentUserId,
        clinicId,
        req.user?.role || Role.PATIENT,
      );

      this.logger.log(`Appointment ${id} updated successfully`);
      return result as ServiceResponse<AppointmentResponseDto>;
    } catch (_error) {
      this.logger.error(
        `Failed to update appointment ${id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      throw _error;
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "update", {
    requireOwnership: true,
  })
  @InvalidatePatientCache({
    patterns: [
      "appointments:detail:{id}",
      "appointments:my:*",
      "appointments:upcoming:*",
      "appointments:list:*",
      "appointments:availability:*",
    ],
    tags: [
      "appointments",
      "appointment_details",
      "patient_appointments",
      "upcoming_appointments",
      "clinic_appointments",
      "doctor_availability",
    ],
  })
  @ApiOperation({
    summary: "Cancel an appointment",
    description:
      "Cancel an existing appointment. Patients can only cancel their own appointments. Completed appointments cannot be cancelled.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Appointment cancelled successfully",
    type: AppointmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Cannot cancel completed appointment",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Cannot cancel this appointment",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Appointment not found",
  })
  async cancelAppointment(
    @Param("id", ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ServiceResponse<AppointmentResponseDto>> {
    const context = "AppointmentsController.cancelAppointment";

    try {
      const clinicId = req.clinicContext?.clinicId;
      const currentUserId = req.user?.sub;

      if (!clinicId) {
        throw this.errors.validationError(
          "clinicId",
          "Clinic context is required",
          context,
        );
      }

      // Log the operation with proper structure
      await this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        "Cancelling appointment",
        context,
        {
          appointmentId: id,
          userId: currentUserId,
          clinicId,
          operation: "cancelAppointment",
        },
      );

      // Additional security check for patients
      if (req.user?.role === Role.PATIENT) {
        const patient = (await this.appointmentService.getPatientByUserId(
          currentUserId,
        )) as { id: string } | null;
        const appointment = (await this.appointmentService.getAppointmentById(
          id,
          clinicId,
        )) as { patientId: string };
        if (appointment.patientId !== patient?.id) {
          throw this.errors.insufficientPermissions(
            "Patients can only cancel their own appointments",
          );
        }
      }

      const result = await this.appointmentService.cancelAppointment(
        id,
        "Cancelled by user",
        currentUserId,
        clinicId,
        req.user?.role || Role.PATIENT,
      );

      // Log successful operation
      await this.loggingService.log(
        LogType.RESPONSE,
        LogLevel.INFO,
        "Appointment cancelled successfully",
        context,
        {
          appointmentId: id,
          userId: currentUserId,
          clinicId,
          operation: "cancelAppointment",
        },
      );

      return result as ServiceResponse<AppointmentResponseDto>;
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, context);
        throw _error;
      }

      // Log the error with proper structure
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel appointment: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
        context,
        {
          appointmentId: id,
          userId: req.user?.sub,
          clinicId: req.clinicContext?.clinicId,
          _error: _error instanceof Error ? _error.stack : String(_error),
          operation: "cancelAppointment",
        },
      );

      const healthcareError = this.errors.internalServerError(context);
      this.errors.handleError(healthcareError, context);
      throw healthcareError;
    }
  }

  // =============================================
  // VIDEO CONSULTATION ENDPOINTS
  // =============================================

  @Post(":id/video/create-room")
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "update")
  @ApiOperation({
    summary: "Create video consultation room",
    description:
      "Create a secure Jitsi room for healthcare video consultation with HIPAA compliance.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Video consultation room created successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Appointment not found",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions",
  })
  async createVideoConsultationRoom(
    @Param("id", ParseUUIDPipe) appointmentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<unknown> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;

      if (!clinicId) {
        throw new BadRequestException("Clinic context is required");
      }

      this.logger.log(`Creating video room for appointment ${appointmentId}`, {
        clinicId,
        createdBy: userId,
      });

      // Get appointment details
      const appointment = await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId,
      ) as any;
      if (!appointment) {
        throw new NotFoundException("Appointment not found");
      }

      // Create secure Jitsi room
      const roomConfig = await this.jitsiVideoService.createConsultationRoom(
        appointmentId,
        appointment.patient?.id,
        appointment.doctor?.id,
        clinicId,
        {
          enableRecording: true,
          enableChat: true,
          enableScreenShare: true,
          enableLobby: true,
        },
      );

      return {
        success: true,
        data: {
          roomName: roomConfig.roomName,
          domain: roomConfig.domain,
          appointmentId: roomConfig.appointmentId,
          securityEnabled: roomConfig.isSecure,
          recordingEnabled: roomConfig.enableRecording,
          maxParticipants: roomConfig.maxParticipants,
          hipaaCompliant: roomConfig.hipaaCompliant,
        },
        message: "Video consultation room created successfully",
      };
    } catch (_error) {
      this.logger.error(
        `Failed to create video room for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
      throw _error;
    }
  }

  @Post(":id/video/join-token")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "read", { requireOwnership: true })
  @ApiOperation({
    summary: "Generate video consultation join token",
    description:
      "Generate secure JWT token for joining the video consultation with role-based permissions.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Join token generated successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Appointment or video room not found",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Not authorized to join this consultation",
  })
  async generateVideoJoinToken(
    @Param("id", ParseUUIDPipe) appointmentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<JitsiMeetingToken> {
    try {
      const clinicId = req.clinicContext?.clinicId;
      const userId = req.user?.sub;
      const userRole = req.user?.role;

      if (!clinicId || !userId) {
        throw new BadRequestException("User and clinic context required");
      }

      this.logger.log(
        `Generating video join token for appointment ${appointmentId}`,
        {
          userId,
          userRole,
          clinicId,
        },
      );

      // Get appointment details
      const appointment = await this.appointmentService.getAppointmentById(
        appointmentId,
        clinicId,
      ) as any;
      if (!appointment) {
        throw new NotFoundException("Appointment not found");
      }

      // Determine user role in consultation
      let consultationRole: "patient" | "doctor";
      if (userRole === Role.PATIENT) {
        if (appointment.patient?.userId !== userId) {
          throw new ForbiddenException(
            "Patients can only join their own consultations",
          );
        }
        consultationRole = "patient";
      } else {
        consultationRole = "doctor";
      }

      // Generate secure meeting token
      const meetingToken = await this.jitsiVideoService.generateMeetingToken(
        appointmentId,
        userId,
        consultationRole,
        {
          name:
            consultationRole === "patient"
              ? appointment.patient?.name
              : appointment.doctor?.name,
          email: req.user?.email || "",
          avatar:
            consultationRole === "patient"
              ? appointment.patient?.avatar
              : appointment.doctor?.avatar,
        },
      );

      return meetingToken;
    } catch (_error) {
      this.logger.error(
        `Failed to generate join token for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId: req.user?.sub,
        },
      );
      throw _error;
    }
  }

  @Post(":id/video/start")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "update", {
    requireOwnership: true,
  })
  @ApiOperation({
    summary: "Start video consultation",
    description:
      "Start the video consultation session and track participant joining.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Video consultation started successfully",
  })
  async startVideoConsultation(
    @Param("id", ParseUUIDPipe) appointmentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<VideoConsultationSession> {
    try {
      const userId = req.user?.sub;
      const userRole = req.user?.role;

      if (!userId) {
        throw new BadRequestException("User ID required");
      }

      const consultationRole = userRole === Role.PATIENT ? "patient" : "doctor";

      this.logger.log(
        `Starting video consultation for appointment ${appointmentId}`,
        {
          userId,
          role: consultationRole,
        },
      );

      const session = await this.jitsiVideoService.startConsultation(
        appointmentId,
        userId,
        consultationRole,
      );

      return session;
    } catch (_error) {
      this.logger.error(
        `Failed to start consultation for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId: req.user?.sub,
        },
      );
      throw _error;
    }
  }

  @Post(":id/video/end")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "update", {
    requireOwnership: true,
  })
  @ApiOperation({
    summary: "End video consultation",
    description: "End the video consultation session and save meeting notes.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        meetingNotes: {
          type: "string",
          description: "Optional meeting notes from the consultation",
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Video consultation ended successfully",
  })
  async endVideoConsultation(
    @Param("id", ParseUUIDPipe) appointmentId: string,
    @Body() body: { meetingNotes?: string },
    @Request() req: AuthenticatedRequest,
  ): Promise<VideoConsultationSession> {
    try {
      const userId = req.user?.sub;
      const userRole = req.user?.role;

      if (!userId) {
        throw new BadRequestException("User ID required");
      }

      const consultationRole = userRole === Role.PATIENT ? "patient" : "doctor";

      this.logger.log(
        `Ending video consultation for appointment ${appointmentId}`,
        {
          userId,
          role: consultationRole,
          hasNotes: !!body.meetingNotes,
        },
      );

      const session = await this.jitsiVideoService.endConsultation(
        appointmentId,
        userId,
        consultationRole,
        body.meetingNotes,
      );

      return session;
    } catch (_error) {
      this.logger.error(
        `Failed to end consultation for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId: req.user?.sub,
        },
      );
      throw _error;
    }
  }

  @Get(":id/video/status")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "read", { requireOwnership: true })
  @ApiOperation({
    summary: "Get video consultation status",
    description:
      "Get the current status and details of the video consultation session.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Video consultation status retrieved successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Video consultation session not found",
  })
  async getVideoConsultationStatus(
    @Param("id", ParseUUIDPipe) appointmentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<VideoConsultationSession | null> {
    try {
      this.logger.log(
        `Getting video consultation status for appointment ${appointmentId}`,
      );

      const session =
        await this.jitsiVideoService.getConsultationStatus(appointmentId);

      if (!session) {
        throw new NotFoundException("Video consultation session not found");
      }

      return session;
    } catch (_error) {
      this.logger.error(
        `Failed to get consultation status for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
      throw _error;
    }
  }

  @Post(":id/video/report-issue")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR)
  @ClinicRoute()
  @RequireResourcePermission("appointments", "update", {
    requireOwnership: true,
  })
  @ApiOperation({
    summary: "Report technical issue",
    description:
      "Report a technical issue during the video consultation for support tracking.",
  })
  @ApiParam({
    name: "id",
    description: "ID of the appointment",
    type: "string",
    format: "uuid",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["issueType", "description"],
      properties: {
        issueType: {
          type: "string",
          enum: ["audio", "video", "connection", "other"],
          description: "Type of technical issue",
        },
        description: {
          type: "string",
          description: "Detailed description of the issue",
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Technical issue reported successfully",
  })
  async reportTechnicalIssue(
    @Param("id", ParseUUIDPipe) appointmentId: string,
    @Body()
    body: {
      issueType: "audio" | "video" | "connection" | "other";
      description: string;
    },
    @Request() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID required");
      }

      this.logger.log(
        `Technical issue reported for appointment ${appointmentId}`,
        {
          userId,
          issueType: body.issueType,
        },
      );

      await this.jitsiVideoService.reportTechnicalIssue(
        appointmentId,
        userId,
        body.description,
        body.issueType,
      );

      return {
        success: true,
        message: "Technical issue reported successfully",
      };
    } catch (_error) {
      this.logger.error(
        `Failed to report technical issue for appointment ${appointmentId}`,
        {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
          userId: req.user?.sub,
        },
      );
      throw _error;
    }
  }

  @Get("test/context")
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.PATIENT,
  )
  @ApiOperation({
    summary: "Test appointment context",
    description: "Test endpoint to debug appointment context and permissions",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the current appointment context and user info.",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "Unauthorized",
  })
  testAppointmentContext(@Request() req: AuthenticatedRequest): {
    message: string;
    timestamp: string;
    user: {
      id?: string;
      sub?: string;
      role?: Role;
      email?: string;
    };
    clinicContext: {
      identifier?: string;
      clinicId?: string;
      subdomain?: string;
      appName?: string;
      isValid?: boolean;
    };
    headers: {
      "x-clinic-id"?: string | string[];
      "x-clinic-identifier"?: string | string[];
      authorization: string;
    };
  } {
    const clinicContext = req.clinicContext;
    const user = req.user;

    return {
      message: "Appointment context test",
      timestamp: new Date().toISOString(),
      user: {
        id: user?.sub,
        sub: user?.sub,
        role: user?.role,
        email: user?.email,
      },
      clinicContext: {
        identifier: clinicContext?.identifier,
        clinicId: clinicContext?.clinicId,
        subdomain: clinicContext?.subdomain,
        appName: clinicContext?.appName,
        isValid: clinicContext?.isValid,
      },
      headers: {
        "x-clinic-id": req.headers["x-clinic-id"],
        "x-clinic-identifier": req.headers["x-clinic-identifier"],
        authorization: req.headers.authorization ? "Bearer ***" : "none",
      },
    };
  }
}
