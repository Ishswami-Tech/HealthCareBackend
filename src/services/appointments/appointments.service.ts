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
          appointmentId: result.data?.id,
          doctorId: createDto.doctorId,
          patientId: createDto.patientId,
          userId,
          clinicId,
        },
      );

      // Invalidate related cache entries
      await this.cacheService.invalidateAppointmentCache(
        result.data?.id,
        createDto.patientId,
        createDto.doctorId,
        clinicId,
      );
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
        result.data?.patientId,
        result.data?.doctorId,
        clinicId,
      );
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
        result.data?.patientId,
        result.data?.doctorId,
        clinicId,
      );
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
  ): Promise<any> {
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
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to process check-in through plugin: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
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
  ): Promise<any> {
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
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to complete appointment through plugin: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
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
  ): Promise<any> {
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
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to start consultation through plugin: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
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
  ): Promise<any> {
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
    } catch (error) {
      this.logger.error(
        `Failed to get queue info through plugin: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
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
  ): Promise<any> {
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
    } catch (error) {
      this.logger.error(
        `Failed to get location info through plugin: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  // =============================================
  // MISSING METHODS (for controller compatibility)
  // =============================================

  /**
   * Get appointment by ID
   */
  async getAppointmentById(id: string, clinicId: string): Promise<any> {
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
  async getPatientByUserId(userId: string): Promise<any> {
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
  // LEGACY METHODS (for backward compatibility)
  // =============================================

  /**
   * Legacy create appointment method
   * @deprecated Use createAppointment with enhanced DTO instead
   */
  async createAppointmentLegacy(data: {
    userId: string;
    doctorId: string;
    locationId: string;
    date: string;
    time: string;
    duration: number;
    type: string;
    notes?: string;
    clinicId: string;
  }): Promise<any> {
    this.logger.warn(
      "Using legacy createAppointment method. Please migrate to enhanced version.",
    );

    // Convert legacy data to enhanced DTO
    const createDto: CreateAppointmentDto = {
      patientId: data.userId, // Assuming userId is patientId in legacy
      doctorId: data.doctorId,
      locationId: data.locationId,
      clinicId: data.clinicId,
      date: data.date,
      time: data.time,
      duration: data.duration,
      type: data.type as any,
      notes: data.notes,
      priority: AppointmentPriority.NORMAL,
      paymentStatus: PaymentStatus.PENDING,
      paymentMethod: PaymentMethod.CASH,
      amount: 0,
      currency: "INR",
      language: Language.EN,
      isRecurring: false,
    };

    return this.createAppointment(createDto, data.userId, data.clinicId);
  }

  /**
   * Legacy get appointments method
   * @deprecated Use getAppointments with enhanced filters instead
   */
  async getAppointmentsLegacy(filters: {
    userId?: string;
    doctorId?: string;
    status?: string;
    locationId?: string;
    date?: string;
    clinicId: string;
    page?: number;
    limit?: number;
  }): Promise<any> {
    this.logger.warn(
      "Using legacy getAppointments method. Please migrate to enhanced version.",
    );

    // Convert legacy filters to enhanced filters
    const enhancedFilters: AppointmentFilterDto = {
      patientId: filters.userId,
      providerId: filters.doctorId,
      status: filters.status as any,
      locationId: filters.locationId,
      startDate: filters.date,
      endDate: filters.date,
      page: filters.page,
      limit: filters.limit,
    };

    return this.getAppointments(
      enhancedFilters,
      filters.userId || "system",
      filters.clinicId,
    );
  }

  /**
   * Legacy update appointment method
   * @deprecated Use updateAppointment with enhanced DTO instead
   */
  async updateAppointmentLegacy(
    appointmentId: string,
    updateData: {
      date?: string;
      time?: string;
      duration?: number;
      status?: string;
      notes?: string;
    },
    clinicId: string,
  ): Promise<any> {
    this.logger.warn(
      "Using legacy updateAppointment method. Please migrate to enhanced version.",
    );

    // Convert legacy data to enhanced DTO
    const updateDto: UpdateAppointmentDto = {
      date: updateData.date,
      time: updateData.time,
      duration: updateData.duration,
      status: updateData.status as any,
      notes: updateData.notes,
    };

    return this.updateAppointment(appointmentId, updateDto, "system", clinicId);
  }

  /**
   * Legacy cancel appointment method
   * @deprecated Use cancelAppointment with enhanced parameters instead
   */
  async cancelAppointmentLegacy(
    appointmentId: string,
    clinicId: string,
  ): Promise<any> {
    this.logger.warn(
      "Using legacy cancelAppointment method. Please migrate to enhanced version.",
    );

    return this.cancelAppointment(
      appointmentId,
      "Cancelled via legacy method",
      "system",
      clinicId,
    );
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  /**
   * Get plugin information
   */
  async getPluginInfo(): Promise<any> {
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
    data: any,
    context?: any,
  ): Promise<any> {
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
  ): Promise<any> {
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
        } catch (error) {
          this.logger.error(
            `Failed to get doctor availability through plugin: ${error instanceof Error ? error.message : "Unknown error"}`,
          );

          // Fallback to legacy method if plugin fails
          return this.getDoctorAvailabilityLegacy(doctorId, date);
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

  /**
   * Legacy doctor availability method
   * @deprecated Use getDoctorAvailability with enhanced parameters instead
   */
  async getDoctorAvailabilityLegacy(
    doctorId: string,
    date: string,
  ): Promise<any> {
    this.logger.warn(
      "Using legacy getDoctorAvailability method. Please migrate to enhanced version.",
    );

    try {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          doctorId,
          date: {
            gte: startDate,
            lt: endDate,
          },
          status: {
            in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"],
          },
        },
        orderBy: { time: "asc" },
      });

      // Generate time slots (9 AM to 6 PM)
      const timeSlots = [];
      for (let hour = 9; hour < 18; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
          const isBooked = appointments.some((apt: any) => apt.time === time);

          timeSlots.push({
            time,
            available: !isBooked,
            appointmentId: isBooked
              ? appointments.find((apt: any) => apt.time === time)?.id
              : null,
          });
        }
      }

      return {
        doctorId,
        date,
        available: timeSlots.some((slot) => slot.available),
        availableSlots: timeSlots
          .filter((slot) => slot.available)
          .map((slot) => slot.time),
        bookedSlots: timeSlots
          .filter((slot) => !slot.available)
          .map((slot) => slot.time),
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
        message: timeSlots.some((slot) => slot.available)
          ? "Doctor has available slots"
          : "Doctor is fully booked for this date",
      };
    } catch (error) {
      this.logger.error(
        `Failed to get doctor availability: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  /**
   * Get user upcoming appointments (enhanced version)
   */
  async getUserUpcomingAppointments(
    userId: string,
    clinicId: string,
    role: string = "USER",
  ): Promise<any> {
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

  /**
   * Legacy user upcoming appointments method
   * @deprecated Use getUserUpcomingAppointments with enhanced parameters instead
   */
  async getUserUpcomingAppointmentsLegacy(userId: string): Promise<any> {
    this.logger.warn(
      "Using legacy getUserUpcomingAppointments method. Please migrate to enhanced version.",
    );

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          patientId: userId,
          date: {
            gte: today,
          },
          status: {
            in: ["SCHEDULED", "CONFIRMED"],
          },
        },
        include: {
          doctor: {
            include: {
              user: true,
            },
          },
          location: true,
          clinic: true,
        },
        orderBy: [{ date: "asc" }, { time: "asc" }],
        take: 10,
      });

      return appointments;
    } catch (error) {
      this.logger.error(
        `Failed to get user upcoming appointments: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

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
    details: any,
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
    } catch (error) {
      this.logger.error("Failed to log operation:", error);
    }
  }
}
