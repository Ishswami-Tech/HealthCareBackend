import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";

// Infrastructure Services
import { CacheService, QueueService } from "src/libs/infrastructure";
import {
  LoggingService,
  LogType,
  LogLevel,
} from "src/libs/infrastructure/logging";

// Core Services
import {
  CoreAppointmentService,
  AppointmentContext,
  AppointmentResult,
} from "./core/core-appointment.service";
import { ConflictResolutionService } from "./core/conflict-resolution.service";
import { AppointmentWorkflowEngine } from "./core/appointment-workflow-engine.service";
import { BusinessRulesEngine } from "./core/business-rules-engine.service";

// Plugin System
import { AppointmentEnterprisePluginManager } from "./plugins/enterprise-plugin-manager";

// DTOs and Types
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
  AppointmentListResponseDto,
  AppointmentFilterDto,
  Appointment,
  AppointmentWithRelations,
  AppointmentStatus,
  AppointmentPriority,
  PaymentStatus,
  PaymentMethod,
  Language,
  ProcessCheckInDto,
  CompleteAppointmentDto,
  StartConsultationDto,
} from "./appointment.dto";

// Legacy imports for backward compatibility
import { PrismaService } from "../../libs/infrastructure/database/prisma/prisma.service";
import { QrService } from "../../libs/utils/QR";

// Auth Integration
import { AuthService } from "../auth/auth.service";

/**
 * Enhanced Appointments Service
 *
 * This service integrates with the new enhanced service layer architecture:
 * - Uses CoreAppointmentService for enterprise-grade operations
 * - Integrates with plugin system for extensible functionality
 * - Maintains backward compatibility with existing code
 * - Provides enhanced features through the new architecture
 */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    // Enhanced Services
    @Inject(forwardRef(() => CoreAppointmentService))
    private readonly coreAppointmentService: CoreAppointmentService,
    @Inject(forwardRef(() => ConflictResolutionService))
    private readonly conflictResolutionService: ConflictResolutionService,
    @Inject(forwardRef(() => AppointmentWorkflowEngine))
    private readonly workflowEngine: AppointmentWorkflowEngine,
    @Inject(forwardRef(() => BusinessRulesEngine))
    private readonly businessRules: BusinessRulesEngine,

    // Plugin System
    private readonly pluginManager: AppointmentEnterprisePluginManager,

    // Infrastructure Services
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,

    // Legacy Services (for backward compatibility)
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,

    // Auth Integration
    private readonly authService: AuthService,

    // Queue Injections
    @InjectQueue("clinic-appointment") private readonly appointmentQueue: Queue,
    @InjectQueue("clinic-notification")
    private readonly notificationQueue: Queue,
    @InjectQueue("clinic-analytics") private readonly analyticsQueue: Queue,
  ) {}

  // =============================================
  // ENHANCED APPOINTMENT OPERATIONS
  // =============================================

  /**
   * Create appointment using enhanced core service with auth integration
   */
  async createAppointment(
    createDto: CreateAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<AppointmentResult> {
    // Validate user access with auth service
    const hasAccess = await this.authService.getUserPermissions(
      userId,
      clinicId,
    );

    if (!hasAccess || !hasAccess.includes("appointments:create")) {
      return {
        success: false,
        error: "Insufficient permissions to create appointment",
        message: "Access denied",
      };
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
      locationId: createDto.locationId,
      doctorId: createDto.doctorId,
      patientId: createDto.patientId,
    };

    const result = await this.coreAppointmentService.createAppointment(
      createDto,
      context,
    );

    // Log security event for appointment creation
    if (result.success) {
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        "Appointment created successfully",
        "AppointmentsService",
        {
          appointmentId: (result.data as Record<string, unknown>)?.id as string,
          doctorId: createDto.doctorId,
          patientId: createDto.patientId,
          userId,
          clinicId,
        },
      );

      // Invalidate related cache entries
      await this.cacheService.invalidateAppointmentCache(
        (result.data as Record<string, unknown>)?.id as string,
        createDto.patientId,
        createDto.doctorId,
        clinicId,
      );

      // Emit event for real-time broadcasting
      await this.eventEmitter.emit("appointment.created", {
        appointmentId: (result.data as Record<string, unknown>)?.id as string,
        userId: createDto.patientId,
        doctorId: createDto.doctorId,
        clinicId,
        status: (result.data as Record<string, unknown>)?.status as string,
        appointmentType: createDto.type,
        createdBy: userId,
      });
    }

    return result;
  }

  /**
   * Get appointments using enhanced core service with auth integration
   */
  async getAppointments(
    filters: AppointmentFilterDto,
    userId: string,
    clinicId: string,
    role: string = "USER",
    page: number = 1,
    limit: number = 20,
  ): Promise<AppointmentResult> {
    // Validate user access with auth service
    const hasAccess = await this.authService.getUserPermissions(
      userId,
      clinicId,
    );

    if (!hasAccess || !hasAccess.includes("appointments:read")) {
      return {
        success: false,
        error: "Insufficient permissions to view appointments",
        message: "Access denied",
      };
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
      locationId: filters.locationId,
      doctorId: filters.providerId,
      patientId: filters.patientId,
    };

    // Use cache service for appointment data
    const cacheKey = `appointments:list:${clinicId}:${JSON.stringify(filters)}:${page}:${limit}`;

    return this.cacheService.cache(
      cacheKey,
      () =>
        this.coreAppointmentService.getAppointments(
          filters,
          context,
          page,
          limit,
        ),
      {
        ttl: 300,
        tags: ["appointments", "clinic_appointments", `clinic:${clinicId}`],
        priority: "normal",
        enableSwr: true,
        containsPHI: true,
        compress: true,
      },
    );
  }

  /**
   * Update appointment using enhanced core service
   */
  async updateAppointment(
    appointmentId: string,
    updateDto: UpdateAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<AppointmentResult> {
    // Validate user access with auth service
    const hasAccess = await this.authService.getUserPermissions(
      userId,
      clinicId,
    );

    if (!hasAccess || !hasAccess.includes("appointments:update")) {
      return {
        success: false,
        error: "Insufficient permissions to update appointment",
        message: "Access denied",
      };
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    const result = await this.coreAppointmentService.updateAppointment(
      appointmentId,
      updateDto,
      context,
    );

    // Invalidate related cache entries
    if (result.success) {
      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.patientId as string,
        (result.data as Record<string, unknown>)?.doctorId as string,
        clinicId,
      );

      // Emit event for real-time broadcasting
      await this.eventEmitter.emit("appointment.updated", {
        appointmentId,
        userId: (result.data as Record<string, unknown>)?.patientId as string,
        doctorId: (result.data as Record<string, unknown>)?.doctorId as string,
        clinicId,
        changes: updateDto,
        updatedBy: userId,
      });
    }

    return result;
  }

  /**
   * Cancel appointment using enhanced core service
   */
  async cancelAppointment(
    appointmentId: string,
    reason: string,
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<AppointmentResult> {
    // Validate user access with auth service
    const hasAccess = await this.authService.getUserPermissions(
      userId,
      clinicId,
    );

    if (!hasAccess || !hasAccess.includes("appointments:update")) {
      return {
        success: false,
        error: "Insufficient permissions to cancel appointment",
        message: "Access denied",
      };
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    const result = await this.coreAppointmentService.cancelAppointment(
      appointmentId,
      reason,
      context,
    );

    // Invalidate related cache entries
    if (result.success) {
      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.patientId as string,
        (result.data as Record<string, unknown>)?.doctorId as string,
        clinicId,
      );

      // Emit event for real-time broadcasting
      await this.eventEmitter.emit("appointment.cancelled", {
        appointmentId,
        userId: (result.data as Record<string, unknown>)?.patientId as string,
        doctorId: (result.data as Record<string, unknown>)?.doctorId as string,
        clinicId,
        reason,
        cancelledBy: userId,
      });
    }

    return result;
  }

  /**
   * Get appointment metrics using enhanced core service
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    userId: string,
    role: string = "USER",
  ): Promise<AppointmentResult> {
    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    return this.coreAppointmentService.getAppointmentMetrics(
      clinicId,
      dateRange,
      context,
    );
  }

  // =============================================
  // PLUGIN-BASED OPERATIONS
  // =============================================

  /**
   * Process appointment check-in through plugins
   */
  async processCheckIn(
    checkInDto: ProcessCheckInDto,
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<unknown> {
    try {
      // Execute through clinic check-in plugin
      const result = await this.pluginManager.executePluginOperation(
        "healthcare",
        "queue",
        "process_checkin",
        checkInDto,
        { clinicId, userId, role },
      );

      if (result.success) {
        // Log the check-in event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          "Check-in processed successfully",
          "AppointmentsService",
          { appointmentId: checkInDto.appointmentId, userId, clinicId },
        );

        // Emit event for real-time broadcasting
        await this.eventEmitter.emit("appointment.checked_in", {
          appointmentId: checkInDto.appointmentId,
          clinicId,
          checkedInBy: userId,
          checkInData: checkInDto,
        });
      }
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to process check-in through plugin: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
      );
      throw _error;
    }
  }

  /**
   * Complete appointment through plugins
   */
  async completeAppointment(
    appointmentId: string,
    completeDto: CompleteAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<unknown> {
    try {
      // Execute through clinic confirmation plugin
      const result = await this.pluginManager.executePluginOperation(
        "healthcare",
        "scheduling",
        "complete_appointment",
        { appointmentId, ...completeDto },
        { clinicId, userId, role },
      );

      if (result.success) {
        // Log the completion event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          "Appointment completed successfully",
          "AppointmentsService",
          { appointmentId, userId, clinicId },
        );

        // Emit event for real-time broadcasting
        await this.eventEmitter.emit("appointment.completed", {
          appointmentId,
          clinicId,
          completedBy: userId,
          completionData: completeDto,
        });
      }
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to complete appointment through plugin: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
      );
      throw _error;
    }
  }

  /**
   * Start consultation through plugins
   */
  async startConsultation(
    appointmentId: string,
    startDto: StartConsultationDto,
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<unknown> {
    try {
      // Execute through clinic check-in plugin
      const result = await this.pluginManager.executePluginOperation(
        "healthcare",
        "scheduling",
        "start_consultation",
        { appointmentId, ...startDto },
        { clinicId, userId, role },
      );

      if (result.success) {
        // Log the consultation start event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          "Consultation started successfully",
          "AppointmentsService",
          { appointmentId, userId, clinicId },
        );

        // Emit event for real-time broadcasting
        await this.eventEmitter.emit("appointment.consultation_started", {
          appointmentId,
          clinicId,
          startedBy: userId,
          consultationData: startDto,
        });
      }
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to start consultation through plugin: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
      );
      throw _error;
    }
  }

  /**
   * Get queue information through plugins
   */
  async getQueueInfo(
    doctorId: string,
    date: string,
    clinicId: string,
    userId: string,
    role: string = "USER",
  ): Promise<unknown> {
    try {
      // Execute through clinic queue plugin
      const result = await this.pluginManager.executePluginOperation(
        "healthcare",
        "queue",
        "get_doctor_queue",
        { doctorId, date },
        { clinicId, userId, role },
      );

      if (result.success) {
        // Log the queue info retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          "Queue information retrieved successfully",
          "AppointmentsService",
          { doctorId, date, userId, clinicId },
        );
      }
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get queue info through plugin: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
      );
      throw _error;
    }
  }

  /**
   * Get location information through plugins
   */
  async getLocationInfo(
    locationId: string,
    clinicId: string,
    userId: string,
    role: string = "USER",
  ): Promise<unknown> {
    try {
      // Execute through clinic location plugin - use scheduling as fallback since 'location' plugin doesn't exist in our plugin manager
      const result = await this.pluginManager.executePluginOperation(
        "healthcare",
        "scheduling",
        "get_location_info",
        { locationId },
        { clinicId, userId, role },
      );

      if (result.success) {
        // Log the location info retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          "Location information retrieved successfully",
          "AppointmentsService",
          { locationId, userId, clinicId },
        );
      }
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get location info through plugin: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
      );
      throw _error;
    }
  }

  // =============================================
  // MISSING METHODS (for controller compatibility)
  // =============================================

  /**
   * Get appointment by ID
   */
  async getAppointmentById(id: string, clinicId: string): Promise<unknown> {
    const cacheKey = `appointments:detail:${id}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const appointment = await this.prisma.appointment.findFirst({
          where: {
            id,
            clinicId,
          },
          include: {
            patient: true,
            doctor: true,
            clinic: true,
            location: true,
          },
        });

        if (!appointment) {
          throw new Error("Appointment not found");
        }

        return appointment;
      },
      {
        ttl: 1800,
        tags: ["appointments", "appointment_details", `appointment:${id}`],
        priority: "high",
        enableSwr: true,
        containsPHI: true,
        compress: true,
      },
    );
  }

  /**
   * Get patient by user ID
   */
  async getPatientByUserId(userId: string): Promise<unknown> {
    const cacheKey = `patient:user:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const patient = await this.prisma.patient.findFirst({
          where: {
            userId,
          },
          include: {
            user: true,
          },
        });

        return patient;
      },
      {
        ttl: 3600,
        tags: ["patients", "user_patients", `user:${userId}`],
        priority: "high",
        enableSwr: true,
        containsPHI: true,
        compress: true,
      },
    );
  }

  // =============================================
  // LEGACY METHODS REMOVED
  // =============================================
  // Legacy methods have been removed to eliminate duplication.
  // Please use the enhanced methods directly:
  // - createAppointment() instead of createAppointmentLegacy()

  // - getAppointments() instead of getAppointmentsLegacy()
  // - updateAppointment() instead of updateAppointmentLegacy()
  // - cancelAppointment() instead of cancelAppointmentLegacy()

  // =============================================
  // UTILITY METHODS
  // =============================================

  /**
   * Get plugin information
   */
  async getPluginInfo(): Promise<unknown> {
    return this.pluginManager.getPluginInfo();
  }

  /**
   * Get domain features
   */
  async getDomainFeatures(domain: string): Promise<string[]> {
    return this.pluginManager.getDomainFeatures(domain);
  }

  /**
   * Execute plugin operation
   */
  async executePluginOperation(
    domain: string,
    feature: string,
    operation: string,
    data: unknown,
    context?: unknown,
  ): Promise<unknown> {
    return this.pluginManager.executePluginOperation(
      domain,
      feature,
      operation,
      data,
      context,
    );
  }

  /**
   * Check if plugin exists
   */
  hasPlugin(domain: string, feature: string): boolean {
    return this.pluginManager.hasPlugin(domain, feature);
  }

  /**
   * Get doctor availability (enhanced version)
   */
  async getDoctorAvailability(
    doctorId: string,
    date: string,
    clinicId: string,
    userId: string,
    role: string = "USER",
  ): Promise<unknown> {
    const cacheKey = `appointments:availability:${doctorId}:${date}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        try {
          // Execute through clinic queue plugin
          const result = await this.pluginManager.executePluginOperation(
            "healthcare",
            "queue",
            "get_doctor_availability",
            { doctorId, date },
            { clinicId, userId, role },
          );

          if (result.success) {
            // Log the availability retrieval
            await this.loggingService.log(
              LogType.BUSINESS,
              LogLevel.INFO,
              "Doctor availability retrieved successfully",
              "AppointmentsService",
              { doctorId, date, userId, clinicId },
            );
          }
          return result;
        } catch (_error) {
          this.logger.error(
            `Failed to get doctor availability through plugin: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
          );

          // Fallback to core service if plugin fails
          return this.coreAppointmentService.getDoctorAvailability(
            doctorId,
            date,
          );
        }
      },
      {
        ttl: 180,
        tags: ["appointments", "doctor_availability", `doctor:${doctorId}`],
        priority: "high",
        enableSwr: true,
        containsPHI: false,
        compress: false,
      },
    );
  }

  // - getDoctorAvailability() instead of getDoctorAvailabilityLegacy()

  /**
   * Get user upcoming appointments (enhanced version)
   */
  async getUserUpcomingAppointments(
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<unknown> {
    const cacheKey = `appointments:upcoming:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const filters: AppointmentFilterDto = {
          patientId: userId,
          startDate: new Date().toISOString().split("T")[0],
          status: AppointmentStatus.SCHEDULED,
        };

        const result = await this.getAppointments(
          filters,
          userId,
          clinicId,
          role,
          1,
          10,
        );
        return result;
      },
      {
        ttl: 600,
        tags: ["appointments", "upcoming_appointments", `user:${userId}`],
        priority: "high",
        enableSwr: true,
        containsPHI: true,
        compress: true,
      },
    );
  }

  // - getUserUpcomingAppointments() instead of getUserUpcomingAppointmentsLegacy()

  // =============================================
  // PRIVATE HELPER METHODS
  // =============================================

  /**
   * Build user context from request
   */
  private buildUserContext(
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): AppointmentContext {
    return {
      userId,
      role,
      clinicId,
    };
  }

  /**
   * Log operation for audit purposes
   */
  private async logOperation(
    operation: string,
    userId: string,
    clinicId: string,
    details: unknown,
  ): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Appointment operation: ${operation}`,
        "AppointmentsService",
        {
          operation,
          userId,
          clinicId,
          timestamp: new Date().toISOString(),
          details,
        },
      );
    } catch (_error) {
      this.logger.error("Failed to log operation:", _error);
    }
  }
}
