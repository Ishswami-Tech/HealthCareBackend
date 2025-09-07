import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

// Infrastructure Services
// DatabaseService removed - using PrismaService directly
import { LoggingService, LogType, LogLevel } from '../../../libs/infrastructure/logging';
import { CacheService } from '../../../libs/infrastructure/cache';
import { QueueService } from '../../../libs/infrastructure/queue';
import { PrismaService } from '../../../libs/infrastructure/database/prisma/prisma.service';

// Core Services
import { ConflictResolutionService } from './conflict-resolution.service';
import { AppointmentWorkflowEngine } from './appointment-workflow-engine.service';
import { BusinessRulesEngine } from './business-rules-engine.service';

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
  Language
} from '../appointment.dto';

// Interfaces
export interface AppointmentContext {
  userId: string;
  role: string;
  clinicId: string;
  locationId?: string;
  doctorId?: string;
  patientId?: string;
}

export interface AppointmentResult {
  success: boolean;
  data?: any;
  error?: string;
  message: string;
  metadata?: {
    processingTime: number;
    conflicts?: any[];
    warnings?: string[];
    auditTrail?: any[];
    alternatives?: any[];
  };
}

export interface AppointmentMetrics {
  totalAppointments: number;
  appointmentsByStatus: Record<string, number>;
  appointmentsByPriority: Record<string, number>;
  averageDuration: number;
  conflictResolutionRate: number;
  noShowRate: number;
  completionRate: number;
  averageWaitTime: number;
  queueEfficiency: number;
}

/**
 * Core Appointment Service
 * 
 * Handles base appointment operations with enterprise-grade features:
 * - CRUD operations with validation
 * - Conflict resolution and intelligent scheduling
 * - Business rules enforcement
 * - Workflow management
 * - Performance optimization
 * - Audit logging
 */
@Injectable()
export class CoreAppointmentService {
  private readonly logger = new Logger(CoreAppointmentService.name);
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly METRICS_CACHE_TTL = 600; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => ConflictResolutionService))
    private readonly conflictResolutionService: ConflictResolutionService,
    @Inject(forwardRef(() => AppointmentWorkflowEngine))
    private readonly workflowEngine: AppointmentWorkflowEngine,
    @Inject(forwardRef(() => BusinessRulesEngine))
    private readonly businessRules: BusinessRulesEngine,
    @InjectQueue('clinic-appointment') private readonly appointmentQueue: Queue,
    @InjectQueue('clinic-notification') private readonly notificationQueue: Queue,
    @InjectQueue('clinic-analytics') private readonly analyticsQueue: Queue,
  ) {}

  /**
   * Create a new appointment with comprehensive validation
   */
  async createAppointment(
    createDto: CreateAppointmentDto,
    context: AppointmentContext
  ): Promise<AppointmentResult> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Creating appointment for patient ${createDto.patientId} with doctor ${createDto.doctorId}`);

      // 1. Validate business rules
      const businessRuleValidation = await this.businessRules.validateAppointmentCreation(createDto, context);
      if (!businessRuleValidation.passed) {
        return {
          success: false,
          error: 'BUSINESS_RULE_VIOLATION',
          message: businessRuleValidation.violations.join(', '),
          metadata: {
            processingTime: Date.now() - startTime,
            warnings: businessRuleValidation.violations
          }
        };
      }

      // 2. Check for scheduling conflicts
      const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(
        {
          patientId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId: createDto.clinicId,
          requestedTime: new Date(`${createDto.date}T${createDto.time}`),
          duration: createDto.duration,
          priority: this.mapPriority(createDto.priority || AppointmentPriority.NORMAL),
          serviceType: createDto.type,
          notes: createDto.notes
        },
        await this.getExistingTimeSlots(createDto.doctorId, createDto.clinicId, new Date(createDto.date)),
        { allowOverlap: false, suggestAlternatives: true }
      );

      if (!conflictResult.canSchedule && conflictResult.conflicts.length > 0) {
        return {
          success: false,
          error: 'SCHEDULING_CONFLICT',
          message: 'Appointment time conflicts with existing schedule',
          metadata: {
            processingTime: Date.now() - startTime,
            conflicts: conflictResult.conflicts,
            alternatives: conflictResult.alternatives
          }
        };
      }

      // 3. Create appointment with enhanced metadata
      const appointmentData = {
        ...createDto,
        userId: context.userId, // Add required userId
        status: AppointmentStatus.SCHEDULED,
        priority: createDto.priority || AppointmentPriority.NORMAL,
        paymentStatus: createDto.paymentStatus || PaymentStatus.PENDING,
        paymentMethod: createDto.paymentMethod || PaymentMethod.CASH,
        amount: createDto.amount || 0,
        currency: createDto.currency || 'INR',
        language: createDto.language || Language.EN,
        isRecurring: createDto.isRecurring || false
      };

      const appointment = await this.prisma.appointment.create({
        data: appointmentData as any,
        include: {
          patient: true,
          doctor: true,
          clinic: true,
          location: true,
        }
      });

      // 4. Initialize workflow
      await this.workflowEngine.initializeWorkflow(appointment.id, 'APPOINTMENT_CREATED');

      // 5. Queue background operations
      await this.queueBackgroundOperations(appointment, context);

      // 6. Emit events
      await this.eventEmitter.emit('appointment.created', {
        appointmentId: appointment.id,
        clinicId: appointment.clinicId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        scheduledDate: appointment.date,
        scheduledTime: appointment.time,
        context
      });

      // 7. HIPAA audit log
      await this.hipaaAuditLog('CREATE_APPOINTMENT', context, {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        outcome: 'SUCCESS'
      });

      // 8. Invalidate cache
      await this.invalidateAppointmentCache(context.clinicId);

      const processingTime = Date.now() - startTime;
      this.logger.log(`Appointment created successfully in ${processingTime}ms`);

      return {
        success: true,
        data: appointment,
        message: 'Appointment created successfully',
        metadata: {
          processingTime,
          warnings: conflictResult.warnings || []
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to create appointment: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      
      // HIPAA audit log for failure
      await this.hipaaAuditLog('CREATE_APPOINTMENT', context, {
        outcome: 'FAILURE',
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to create appointment',
        metadata: { processingTime }
      };
    }
  }

  /**
   * Get appointments with advanced filtering and pagination
   */
  async getAppointments(
    filters: AppointmentFilterDto,
    context: AppointmentContext,
    page: number = 1,
    limit: number = 20
  ): Promise<AppointmentResult> {
    const startTime = Date.now();
    
    try {
      // Build cache key
      const cacheKey = `appointments:${context.clinicId}:${JSON.stringify(filters)}:${page}:${limit}`;
      
      // Try to get from cache first
      const cachedResult = await this.cacheService.get(cacheKey);
      if (cachedResult) {
        return {
          success: true,
          data: cachedResult,
          message: 'Appointments retrieved from cache',
          metadata: { processingTime: Date.now() - startTime }
        };
      }

      // Build where clause with role-based access control
      const where = this.buildAppointmentWhereClause(filters, context);
      
      const offset = (page - 1) * limit;

      const [appointments, total] = await Promise.all([
        this.prisma.appointment.findMany({
          where,
          include: {
            patient: true,
            doctor: true,
            clinic: true,
            location: true,
          },
          orderBy: [
            { priority: 'desc' },
            { date: 'asc' },
            { time: 'asc' }
          ],
          skip: offset,
          take: limit,
        }),
        this.prisma.appointment.count({ where })
      ]);

      const result = {
        appointments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        }
      };

      // Cache the result
      await this.cacheService.set(cacheKey, result, this.CACHE_TTL);

      // HIPAA audit log
      await this.hipaaAuditLog('VIEW_APPOINTMENTS', context, {
        outcome: 'SUCCESS',
        filters,
        resultCount: appointments.length
      });

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: result,
        message: 'Appointments retrieved successfully',
        metadata: { processingTime }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to get appointments: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to retrieve appointments',
        metadata: { processingTime }
      };
    }
  }

  /**
   * Update appointment with validation and conflict resolution
   */
  async updateAppointment(
    appointmentId: string,
    updateDto: UpdateAppointmentDto,
    context: AppointmentContext
  ): Promise<AppointmentResult> {
    const startTime = Date.now();
    
    try {
      // 1. Get existing appointment
      // Using prisma directly instead of databaseService
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId, clinicId: context.clinicId },
        include: { patient: true, doctor: true }
      });

      if (!existingAppointment) {
        return {
          success: false,
          error: 'APPOINTMENT_NOT_FOUND',
          message: 'Appointment not found',
          metadata: { processingTime: Date.now() - startTime }
        };
      }

      // 2. Validate status transitions
      if (updateDto.status && !this.workflowEngine.isValidStatusTransition(
        existingAppointment.status,
        updateDto.status
      )) {
        return {
          success: false,
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot transition from ${existingAppointment.status} to ${updateDto.status}`,
          metadata: { processingTime: Date.now() - startTime }
        };
      }

      // 3. Check for scheduling conflicts if date/time is being changed
      if ((updateDto.date || updateDto.time) && existingAppointment.doctorId) {
        const newDate = updateDto.date || existingAppointment.date;
        const newTime = updateDto.time || existingAppointment.time;
        
        const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(
          {
            patientId: existingAppointment.patientId,
            doctorId: existingAppointment.doctorId,
            clinicId: existingAppointment.clinicId,
            requestedTime: new Date(`${newDate}T${newTime}`),
            duration: updateDto.duration || existingAppointment.duration,
            priority: this.mapPriority(existingAppointment.priority as any),
            serviceType: existingAppointment.type,
            notes: updateDto.notes
          },
          await this.getExistingTimeSlots(existingAppointment.doctorId, existingAppointment.clinicId, new Date(newDate)),
          { allowOverlap: false, suggestAlternatives: true }
        );

        if (!conflictResult.canSchedule) {
          return {
            success: false,
            error: 'SCHEDULING_CONFLICT',
            message: 'Updated appointment time conflicts with existing schedule',
            metadata: {
              processingTime: Date.now() - startTime,
              conflicts: conflictResult.conflicts
            }
          };
        }
      }

      // 4. Update appointment
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId, clinicId: context.clinicId },
        data: {
          ...updateDto,
          updatedAt: new Date()
        } as any,
        include: {
          patient: true,
          doctor: true,
          clinic: true,
          location: true,
        }
      });

      // 5. Update workflow if status changed
      if (updateDto.status && updateDto.status !== existingAppointment.status) {
        await this.workflowEngine.transitionStatus(appointmentId, existingAppointment.status, updateDto.status, context.userId);
      }

      // 6. Queue background operations
      await this.queueBackgroundOperations(updatedAppointment, context, 'UPDATE');

      // 7. Emit events
      await this.eventEmitter.emit('appointment.updated', {
        appointmentId: updatedAppointment.id,
        clinicId: updatedAppointment.clinicId,
        doctorId: updatedAppointment.doctorId,
        patientId: updatedAppointment.patientId,
        status: updatedAppointment.status,
        changes: updateDto,
        context
      });

      // 8. HIPAA audit log
      await this.hipaaAuditLog('UPDATE_APPOINTMENT', context, {
        appointmentId: updatedAppointment.id,
        patientId: updatedAppointment.patientId,
        outcome: 'SUCCESS',
        changes: updateDto
      });

      // 9. Invalidate cache
      await this.invalidateAppointmentCache(context.clinicId);

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: updatedAppointment,
        message: 'Appointment updated successfully',
        metadata: { processingTime }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to update appointment: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to update appointment',
        metadata: { processingTime }
      };
    }
  }

  /**
   * Cancel appointment with business rule validation
   */
  async cancelAppointment(
    appointmentId: string,
    reason: string,
    context: AppointmentContext
  ): Promise<AppointmentResult> {
    const startTime = Date.now();
    
    try {
      // 1. Get existing appointment
      // Using prisma directly instead of databaseService
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId, clinicId: context.clinicId },
        include: { patient: true, doctor: true }
      });

      if (!existingAppointment) {
        return {
          success: false,
          error: 'APPOINTMENT_NOT_FOUND',
          message: 'Appointment not found',
          metadata: { processingTime: Date.now() - startTime }
        };
      }

      // 2. Validate cancellation is allowed
      if (!this.workflowEngine.canCancelAppointment(existingAppointment.status)) {
        return {
          success: false,
          error: 'CANCELLATION_NOT_ALLOWED',
          message: `Cannot cancel appointment in ${existingAppointment.status} status`,
          metadata: { processingTime: Date.now() - startTime }
        };
      }

      // 3. Cancel appointment
      const cancelledAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId, clinicId: context.clinicId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: reason,
          cancelledBy: context.userId,
          cancelledAt: new Date(),
          updatedAt: new Date()
        },
        include: {
          patient: true,
          doctor: true,
          clinic: true,
          location: true,
        }
      });

      // 4. Update workflow
      await this.workflowEngine.transitionStatus(appointmentId, existingAppointment.status, AppointmentStatus.CANCELLED, context.userId);

      // 5. Queue background operations
      await this.queueBackgroundOperations(cancelledAppointment, context, 'CANCELLATION');

      // 6. Emit events
      await this.eventEmitter.emit('appointment.cancelled', {
        appointmentId: cancelledAppointment.id,
        clinicId: cancelledAppointment.clinicId,
        doctorId: cancelledAppointment.doctorId,
        patientId: cancelledAppointment.patientId,
        reason: reason,
        context
      });

      // 7. HIPAA audit log
      await this.hipaaAuditLog('CANCEL_APPOINTMENT', context, {
        appointmentId: cancelledAppointment.id,
        patientId: cancelledAppointment.patientId,
        outcome: 'SUCCESS',
        reason
      });

      // 8. Invalidate cache
      await this.invalidateAppointmentCache(context.clinicId);

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: cancelledAppointment,
        message: 'Appointment cancelled successfully',
        metadata: { processingTime }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to cancel appointment: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to cancel appointment',
        metadata: { processingTime }
      };
    }
  }

  /**
   * Get appointment metrics for analytics
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    context: AppointmentContext
  ): Promise<AppointmentResult> {
    const startTime = Date.now();
    
    try {
      const cacheKey = `metrics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;
      
      // Try to get from cache first
      const cachedMetrics = await this.cacheService.get(cacheKey);
      if (cachedMetrics) {
        return {
          success: true,
          data: cachedMetrics,
          message: 'Metrics retrieved from cache',
          metadata: { processingTime: Date.now() - startTime }
        };
      }

      // Using prisma directly instead of databaseService
      
      // Get appointments in date range
      const appointments = await this.prisma.appointment.findMany({
        where: {
          clinicId,
          date: {
            gte: dateRange.from,
            lte: dateRange.to
          }
        },
        select: {
          status: true,
          duration: true,
          createdAt: true,
          checkedInAt: true,
          completedAt: true,
          priority: true
        }
      });

      // Calculate metrics
      const metrics = this.calculateAppointmentMetrics(appointments, dateRange);
      
      // Cache the metrics
      await this.cacheService.set(cacheKey, metrics, this.METRICS_CACHE_TTL);

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: metrics,
        message: 'Appointment metrics retrieved successfully',
        metadata: { processingTime }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to get appointment metrics: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to retrieve appointment metrics',
        metadata: { processingTime }
      };
    }
  }

  // =============================================
  // PRIVATE HELPER METHODS
  // =============================================

  private async getExistingTimeSlots(doctorId: string, clinicId: string, date: Date): Promise<any[]> {
    // Using prisma directly instead of databaseService
    
    return this.prisma.appointment.findMany({
      where: {
        doctorId,
        clinicId,
        date: date,
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS]
        }
      },
      select: {
        id: true,
        date: true,
        time: true,
        duration: true,
        status: true,
        priority: true,
      }
    });
  }

  private buildAppointmentWhereClause(filters: AppointmentFilterDto, context: AppointmentContext): any {
    const where: any = { clinicId: context.clinicId };
    
    // Apply role-based filtering
    switch (context.role) {
      case 'DOCTOR':
        where.doctorId = context.userId;
        break;
      case 'PATIENT':
        where.patientId = context.userId;
        break;
      case 'NURSE':
      case 'RECEPTIONIST':
        // Can see all appointments in their clinic
        break;
      default:
        // For unknown roles, restrict to user's own appointments
        where.OR = [
          { doctorId: context.userId },
          { patientId: context.userId }
        ];
        break;
    }

    // Apply filters
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.priority) where.priority = filters.priority;
    // Note: doctorId filter removed as it's not in the AppointmentFilterDto interface
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.locationId) where.locationId = filters.locationId;
    
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }

    return where;
  }

  private async queueBackgroundOperations(
    appointment: any,
    context: AppointmentContext,
    operation: string = 'CREATE'
  ): Promise<void> {
    try {
      // Queue notification job
      await this.notificationQueue.add('APPOINTMENT_NOTIFICATION', {
        appointmentId: appointment.id,
        operation,
        context
      }, {
        priority: appointment.priority === 'EMERGENCY' ? 1 : 3,
        delay: 0,
        attempts: 3
      });

      // Queue analytics job
      await this.analyticsQueue.add('APPOINTMENT_ANALYTICS', {
        appointmentId: appointment.id,
        operation,
        context
      }, {
        priority: 5,
        delay: 5000, // 5 second delay
        attempts: 2
      });

      // Queue appointment processing job
      await this.appointmentQueue.add('APPOINTMENT_PROCESSING', {
        appointmentId: appointment.id,
        operation,
        context
      }, {
        priority: appointment.priority === 'EMERGENCY' ? 1 : 2,
        delay: 0,
        attempts: 3
      });

    } catch (error) {
      this.logger.error(`Failed to queue background operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Don't throw error as background operations shouldn't break main flow
    }
  }

  private async invalidateAppointmentCache(clinicId: string): Promise<void> {
    try {
      const patterns = [
        `appointments:${clinicId}:*`,
        `metrics:${clinicId}:*`,
        `doctor:availability:${clinicId}:*`
      ];
      
      for (const pattern of patterns) {
        await this.cacheService.delPattern(pattern);
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private calculateAppointmentMetrics(appointments: any[], dateRange: { from: Date; to: Date }): AppointmentMetrics {
    const totalAppointments = appointments.length;
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let noShowCount = 0;

    appointments.forEach(appointment => {
      // Count by status
      statusCounts[appointment.status] = (statusCounts[appointment.status] || 0) + 1;
      
      // Count by priority
      if (appointment.priority) {
        priorityCounts[appointment.priority] = (priorityCounts[appointment.priority] || 0) + 1;
      }
      
      // Calculate duration
      if (appointment.duration) {
        totalDuration += appointment.duration;
      }
      
      // Count specific statuses
      if (appointment.status === 'COMPLETED') completedCount++;
      if (appointment.status === 'CANCELLED') cancelledCount++;
      if (appointment.status === 'NO_SHOW') noShowCount++;
    });

    const averageDuration = totalDuration > 0 ? totalDuration / totalAppointments : 0;
    const completionRate = totalAppointments > 0 ? (completedCount / totalAppointments) * 100 : 0;
    const noShowRate = totalAppointments > 0 ? (noShowCount / totalAppointments) * 100 : 0;

    return {
      totalAppointments,
      appointmentsByStatus: statusCounts,
      appointmentsByPriority: priorityCounts,
      averageDuration,
      conflictResolutionRate: 0, // Would be calculated from conflict resolution service
      noShowRate,
      completionRate,
      averageWaitTime: 0, // Would be calculated from queue service
      queueEfficiency: 0 // Would be calculated from queue service
    };
  }

  private async hipaaAuditLog(
    action: string,
    context: AppointmentContext,
    details: any
  ): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `HIPAA Audit: ${action}`,
        'CoreAppointmentService',
        {
          action,
          userId: context.userId,
          role: context.role,
          clinicId: context.clinicId,
          timestamp: new Date().toISOString(),
          ...details,
          compliance: {
            hipaa: true,
            phiAccessed: true,
            auditTrail: true
          }
        }
      );
    } catch (error) {
      this.logger.error('Failed to log HIPAA audit:', error);
      // Don't throw error as audit logging failure shouldn't break the main operation
    }
  }

  /**
   * Map AppointmentPriority enum to conflict resolution priority values
   */
  private mapPriority(priority: AppointmentPriority): 'emergency' | 'vip' | 'regular' | 'followup' {
    switch (priority) {
      case AppointmentPriority.EMERGENCY:
        return 'emergency';
      case AppointmentPriority.URGENT:
      case AppointmentPriority.HIGH:
        return 'vip';
      case AppointmentPriority.LOW:
        return 'followup';
      case AppointmentPriority.NORMAL:
      default:
        return 'regular';
    }
  }
}
