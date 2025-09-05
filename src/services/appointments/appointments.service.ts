import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

// Infrastructure Services
import { PrismaService } from '../../libs/infrastructure/database/prisma/prisma.service';
import { LoggingService } from '../../libs/infrastructure/logging/logging.service';
import { LogType, LogLevel } from '../../libs/infrastructure/logging/types/logging.types';
import { CacheService } from '../../libs/infrastructure/cache/cache.service';
import { QueueService } from '../../libs/infrastructure/queue/src/queue.service';

// Core Services
import { CoreAppointmentService, AppointmentContext, AppointmentResult } from './core/core-appointment.service';
import { ConflictResolutionService } from './core/conflict-resolution.service';
import { AppointmentWorkflowEngine } from './core/appointment-workflow-engine.service';
// import { BusinessRulesEngine } from './core/business-rules-engine.service';

// Plugin System
import { AppointmentEnterprisePluginManager } from './plugins/enterprise-plugin-manager';

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
  StartConsultationDto
} from './appointment.dto';

// Legacy imports for backward compatibility
import { QrService } from '../../libs/utils/QR';

// Auth Integration
import { ClinicAuthService } from '../auth/implementations/clinic-auth.service';
import { AuthPluginContext, AuthPluginDomain } from '../auth/core/auth-plugin.interface';

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
    // @Inject(forwardRef(() => BusinessRulesEngine))
    // private readonly businessRules: BusinessRulesEngine,
    
    // Plugin System
    private readonly pluginManager: AppointmentEnterprisePluginManager,
    
    // Infrastructure Services
    private readonly databaseService: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    @Optional() private readonly queueService: QueueService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    
    // Legacy Services (for backward compatibility)
    private readonly qrService: QrService,
    
    // Auth Integration
    private readonly clinicAuthService: ClinicAuthService,
    
    // Queue Injections
    @InjectQueue('clinic-appointment') private readonly appointmentQueue: Queue,
    @InjectQueue('clinic-notification') private readonly notificationQueue: Queue,
    @InjectQueue('clinic-analytics') private readonly analyticsQueue: Queue,
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
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    // Validate user access with auth service
    const authContext: AuthPluginContext = {
      domain: AuthPluginDomain.CLINIC,
      clinicId,
      userAgent: 'API',
      ipAddress: '127.0.0.1',
      metadata: { operation: 'create_appointment' },
    };

    const hasAccess = await this.clinicAuthService.verifyToken(
      userId,
      authContext.clinicId
    );

    if (!hasAccess) {
      return {
        success: false,
        message: 'Insufficient permissions to create appointment',
        error: 'INSUFFICIENT_PERMISSIONS',
      };
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
      locationId: createDto.locationId,
      doctorId: createDto.doctorId,
      patientId: createDto.patientId
    };

    const result = await this.coreAppointmentService.createAppointment(createDto, context);
    
    // Log security event for appointment creation
    if (result.success) {
      // await this.clinicAuthService.logSecurityEvent?.(
      //   'appointment_created',
      //   userId,
      //   {
      //     appointmentId: result.data?.id,
      //     doctorId: createDto.doctorId,
      //     patientId: createDto.patientId,
      //     appointmentDate: createDto.appointmentDate,
      //   },
      //   authContext
      // );
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
    role: string = 'USER',
    page: number = 1,
    limit: number = 20
  ): Promise<AppointmentResult> {
    // Validate user access with auth service
    const authContext: AuthPluginContext = {
      domain: AuthPluginDomain.CLINIC,
      clinicId,
      userAgent: 'API',
      ipAddress: '127.0.0.1',
      metadata: { operation: 'read_appointments', filters },
    };

    const hasAccess = await this.clinicAuthService.verifyToken(
      userId,
      authContext.clinicId
    );

    if (!hasAccess) {
      return {
        success: false,
        message: 'Insufficient permissions to view appointments',
        error: 'INSUFFICIENT_PERMISSIONS',
      };
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
      locationId: filters.locationId,
      doctorId: filters.providerId,
      patientId: filters.patientId
    };

    return this.coreAppointmentService.getAppointments(filters, context, page, limit);
  }

  /**
   * Update appointment using enhanced core service
   */
  async updateAppointment(
    appointmentId: string,
    updateDto: UpdateAppointmentDto,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    const context: AppointmentContext = {
      userId,
      role,
      clinicId
    };

    return this.coreAppointmentService.updateAppointment(appointmentId, updateDto, context);
  }

  /**
   * Cancel appointment using enhanced core service
   */
  async cancelAppointment(
    appointmentId: string,
    reason: string,
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    const context: AppointmentContext = {
      userId,
      role,
      clinicId
    };

    return this.coreAppointmentService.cancelAppointment(appointmentId, reason, context);
  }

  /**
   * Get single appointment by ID
   */
  async getAppointmentById(
    id: string,
    clinicId: string,
    userId?: string
  ): Promise<any> {
    try {
      // Use the Prisma service to find the appointment
      const appointment = await this.databaseService.appointment.findUnique({
        where: {
          id,
          clinicId,
        },
        include: {
          patient: true,
          doctor: true,
          location: true,
        },
      });

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      return appointment;
    } catch (error) {
      this.logger.error(`Error getting appointment ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get appointment metrics using enhanced core service
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    userId: string,
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    const context: AppointmentContext = {
      userId,
      role,
      clinicId
    };

    return this.coreAppointmentService.getAppointmentMetrics(clinicId, dateRange, context);
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
    role: string = 'USER'
  ): Promise<any> {
    try {
      // Execute through clinic check-in plugin
      const result = await this.pluginManager.executePluginOperation(
        'healthcare',
        'check-in',
        'process_checkin',
        checkInDto,
        { clinicId, userId, role }
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to process check-in through plugin: ${error.message}`);
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
    role: string = 'USER'
  ): Promise<any> {
    try {
      // Execute through clinic confirmation plugin
      const result = await this.pluginManager.executePluginOperation(
        'healthcare',
        'confirmation',
        'complete_appointment',
        { appointmentId, ...completeDto },
        { clinicId, userId, role }
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to complete appointment through plugin: ${error.message}`);
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
    role: string = 'USER'
  ): Promise<any> {
    try {
      // Execute through clinic check-in plugin
      const result = await this.pluginManager.executePluginOperation(
        'healthcare',
        'check-in',
        'start_consultation',
        { appointmentId, ...startDto },
        { clinicId, userId, role }
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to start consultation through plugin: ${error.message}`);
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
    role: string = 'USER'
  ): Promise<any> {
    try {
      // Execute through clinic queue plugin
      const result = await this.pluginManager.executePluginOperation(
        'healthcare',
        'queue',
        'get_doctor_queue',
        { doctorId, date },
        { clinicId, userId, role }
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to get queue info through plugin: ${error.message}`);
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
    role: string = 'USER'
  ): Promise<any> {
    try {
      // Execute through clinic location plugin
      const result = await this.pluginManager.executePluginOperation(
        'healthcare',
        'location',
        'get_location_info',
        { locationId },
        { clinicId, userId, role }
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to get location info through plugin: ${error.message}`);
      throw error;
    }
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
    this.logger.warn('Using legacy createAppointment method. Please migrate to enhanced version.');
    
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
      currency: 'INR',
      language: Language.EN,
      isRecurring: false
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
    this.logger.warn('Using legacy getAppointments method. Please migrate to enhanced version.');
    
    // Convert legacy filters to enhanced filters
    const enhancedFilters: AppointmentFilterDto = {
      patientId: filters.userId,
      providerId: filters.doctorId,
      status: filters.status as any,
      locationId: filters.locationId,
      startDate: filters.date,
      endDate: filters.date,
      page: filters.page,
      limit: filters.limit
    };

    return this.getAppointments(enhancedFilters, filters.userId || 'system', filters.clinicId);
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
    clinicId: string
  ): Promise<any> {
    this.logger.warn('Using legacy updateAppointment method. Please migrate to enhanced version.');
    
    // Convert legacy data to enhanced DTO
    const updateDto: UpdateAppointmentDto = {
      date: updateData.date,
      time: updateData.time,
      duration: updateData.duration,
      status: updateData.status as any,
      notes: updateData.notes
    };

    return this.updateAppointment(appointmentId, updateDto, 'system', clinicId);
  }

  /**
   * Legacy cancel appointment method
   * @deprecated Use cancelAppointment with enhanced parameters instead
   */
  async cancelAppointmentLegacy(appointmentId: string, clinicId: string): Promise<any> {
    this.logger.warn('Using legacy cancelAppointment method. Please migrate to enhanced version.');
    
    return this.cancelAppointment(appointmentId, 'Cancelled via legacy method', 'system', clinicId);
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
    context?: any
  ): Promise<any> {
    return this.pluginManager.executePluginOperation(domain, feature, operation, data, context);
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
    role: string = 'USER'
  ): Promise<any> {
    try {
      // Execute through clinic queue plugin
      const result = await this.pluginManager.executePluginOperation(
        'healthcare',
        'queue',
        'get_doctor_availability',
        { doctorId, date },
        { clinicId, userId, role }
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to get doctor availability through plugin: ${error.message}`);
      
      // Fallback to legacy method if plugin fails
      return this.getDoctorAvailabilityLegacy(doctorId, date);
    }
  }

  /**
   * Legacy doctor availability method
   * @deprecated Use getDoctorAvailability with enhanced parameters instead
   */
  async getDoctorAvailabilityLegacy(doctorId: string, date: string): Promise<any> {
    this.logger.warn('Using legacy getDoctorAvailability method. Please migrate to enhanced version.');
    
    try {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);

      const appointments = await this.databaseService.appointment.findMany({
        where: {
          doctorId,
          date: {
            gte: startDate,
            lt: endDate
          },
          status: {
            in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS']
          }
        },
        orderBy: { time: 'asc' }
      });

      // Generate time slots (9 AM to 6 PM)
      const timeSlots = [];
      for (let hour = 9; hour < 18; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          const isBooked = appointments.some(apt => apt.time === time);
          
          timeSlots.push({
            time,
            available: !isBooked,
            appointmentId: isBooked ? appointments.find(apt => apt.time === time)?.id : null
          });
        }
      }

      return {
        doctorId,
        date,
        available: timeSlots.some(slot => slot.available),
        availableSlots: timeSlots.filter(slot => slot.available).map(slot => slot.time),
        bookedSlots: timeSlots.filter(slot => !slot.available).map(slot => slot.time),
        workingHours: {
          start: '09:00',
          end: '18:00'
        },
        message: timeSlots.some(slot => slot.available) 
          ? 'Doctor has available slots' 
          : 'Doctor is fully booked for this date'
      };
    } catch (error) {
      this.logger.error(`Failed to get doctor availability: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get user upcoming appointments (enhanced version)
   */
  async getUserUpcomingAppointments(
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<any> {
    try {
      const filters: AppointmentFilterDto = {
        patientId: userId,
        startDate: new Date().toISOString().split('T')[0],
        status: AppointmentStatus.SCHEDULED
      };

      const result = await this.getAppointments(filters, userId, clinicId, role, 1, 10);
      return result;
    } catch (error) {
      this.logger.error(`Failed to get user upcoming appointments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Legacy user upcoming appointments method
   * @deprecated Use getUserUpcomingAppointments with enhanced parameters instead
   */
  async getUserUpcomingAppointmentsLegacy(userId: string): Promise<any> {
    this.logger.warn('Using legacy getUserUpcomingAppointments method. Please migrate to enhanced version.');
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const appointments = await this.databaseService.appointment.findMany({
        where: {
          patientId: userId,
          date: {
            gte: today
          },
          status: {
            in: ['SCHEDULED', 'CONFIRMED']
          }
        },
        include: {
          doctor: {
            include: {
              user: true
            }
          },
          location: true,
          clinic: true
        },
        orderBy: [
          { date: 'asc' },
          { time: 'asc' }
        ],
        take: 10
      });

      return appointments;
    } catch (error) {
      this.logger.error(`Failed to get user upcoming appointments: ${error.message}`);
      throw error;
    }
  }

  // =============================================
  // PRIVATE HELPER METHODS
  // =============================================

  /**
   * Build user context from request
   */
  private buildUserContext(userId: string, clinicId: string, role: string = 'USER'): AppointmentContext {
    return {
      userId,
      role,
      clinicId
    };
  }

  /**
   * Log operation for audit purposes
   */
  private async logOperation(
    operation: string,
    userId: string,
    clinicId: string,
    details: any
  ): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Appointment operation: ${operation}`,
        'AppointmentsService',
        {
          operation,
          userId,
          clinicId,
          timestamp: new Date().toISOString(),
          details
        }
      );
    } catch (error) {
      this.logger.error('Failed to log operation:', error);
    }
  }

  /**
   * Get patient by user ID
   */
  async getPatientByUserId(userId: string) {
    try {
      const patient = await this.databaseService.patient.findUnique({
        where: {
          userId: userId
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          }
        }
      });

      return patient;
    } catch (error) {
      this.logger.error('Error fetching patient by user ID:', error);
      throw error;
    }
  }
} 