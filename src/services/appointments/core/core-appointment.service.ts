import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

// Infrastructure Services
// Using unified DatabaseService for all database operations
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel } from '@core/types';
import { CacheService } from '@infrastructure/cache';
import { QueueService } from '@infrastructure/queue';
import { DatabaseService } from '@infrastructure/database';
import { HealthcareErrorsService } from '@core/errors';

// Core Services
import { ConflictResolutionService } from './conflict-resolution.service';
import type { TimeSlot } from '@core/types/appointment.types';
import { AppointmentWorkflowEngine } from './appointment-workflow-engine.service';
import { BusinessRulesEngine } from './business-rules-engine.service';

// DTOs and Types
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentFilterDto,
  AppointmentStatus,
  AppointmentPriority,
} from '../appointment.dto';
import { PaymentStatus, PaymentMethod, Language } from '@core/types';
import type {
  AppointmentContext,
  AppointmentResult,
  AppointmentMetricsData,
} from '@core/types/appointment.types';

// CoreAppointmentMetrics is an alias for AppointmentMetricsData
export type CoreAppointmentMetrics = AppointmentMetricsData;

// AppointmentTimeSlot is imported from database types
import type { AppointmentTimeSlot } from '@core/types/database.types';

// Use centralized types from database service
import type {
  AppointmentBase as Appointment,
  PatientBase as Patient,
  Doctor,
  Clinic,
} from '@core/types/database.types';
import type { AppointmentUpdateInput } from '@core/types/input.types';

export type AppointmentData = Appointment;
export type PatientData = Patient;
export type DoctorData = Doctor;
export type ClinicData = Clinic;

// Removed duplicate interfaces - using centralized types from database service

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
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly METRICS_CACHE_TTL = 600; // 10 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventService: EventService,
    private readonly configService: ConfigService,
    private readonly errors: HealthcareErrorsService,
    @Inject(forwardRef(() => ConflictResolutionService))
    private readonly conflictResolutionService: ConflictResolutionService,
    @Inject(forwardRef(() => AppointmentWorkflowEngine))
    private readonly workflowEngine: AppointmentWorkflowEngine,
    @Inject(forwardRef(() => BusinessRulesEngine))
    private readonly businessRules: BusinessRulesEngine,
    @InjectQueue('clinic-appointment')
    private readonly appointmentQueue: Queue,
    @InjectQueue('clinic-notification')
    private readonly notificationQueue: Queue,
    @InjectQueue('clinic-analytics')
    private readonly analyticsQueue: Queue
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
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Creating appointment for patient ${createDto.patientId} with doctor ${createDto.doctorId}`,
        'CoreAppointmentService.createAppointment'
      );

      // 1. Validate business rules
      const businessRuleValidation = await this.businessRules.validateAppointmentCreation(
        createDto,
        context
      );
      if (!businessRuleValidation.passed) {
        return {
          success: false,
          error: 'BUSINESS_RULE_VIOLATION',
          message: businessRuleValidation.violations.join(', '),
          metadata: {
            processingTime: Date.now() - startTime,
            warnings: businessRuleValidation.violations,
          },
        };
      }

      // 2. Check for scheduling conflicts
      const existingAppointments = await this.getExistingTimeSlots(
        createDto.doctorId,
        createDto.clinicId,
        new Date(createDto.date)
      );

      const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(
        {
          patientId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId: createDto.clinicId,
          requestedTime: new Date(`${createDto.date}T${createDto.time}`),
          duration: createDto.duration,
          priority: this.mapPriority(createDto.priority || AppointmentPriority.NORMAL),
          serviceType: createDto.type,
          ...(createDto.notes && { notes: createDto.notes }),
        },
        this.convertToTimeSlots(existingAppointments, createDto.doctorId, createDto.clinicId),
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
            alternatives: conflictResult.alternatives,
          },
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
        isRecurring: createDto.isRecurring || false,
        date: new Date(createDto.date),
      };

      const appointment = (await this.databaseService.createAppointmentSafe(
        appointmentData
      )) as AppointmentData;

      // Cast for AppointmentResult compatibility
      const appointmentResult = appointment as unknown as Record<string, unknown>;

      // 4. Initialize workflow
      this.workflowEngine.initializeWorkflow(appointment.id, 'APPOINTMENT_CREATED');

      // 5. Queue background operations
      await this.queueBackgroundOperations(appointment, context);

      // 6. Emit events
      await this.eventService.emit('appointment.created', {
        appointmentId: appointment.id,
        clinicId: appointment.clinicId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        scheduledDate: appointment.date,
        scheduledTime: appointment.time,
        context,
      });

      // 7. HIPAA audit log
      await this.hipaaAuditLog('CREATE_APPOINTMENT', context, {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        outcome: 'SUCCESS',
      });

      // 8. Invalidate cache
      await this.invalidateAppointmentCache(context.clinicId);

      const processingTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Appointment created successfully in ${processingTime}ms`,
        'CoreAppointmentService.createAppointment',
        { processingTime }
      );

      return {
        success: true,
        data: appointmentResult,
        message: 'Appointment created successfully',
        metadata: {
          processingTime,
          warnings: conflictResult.warnings || [],
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create appointment: ${errorMessage}`,
        'CoreAppointmentService.createAppointment',
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
        }
      );

      // HIPAA audit log for failure
      await this.hipaaAuditLog('CREATE_APPOINTMENT', context, {
        outcome: 'FAILURE',
        error: errorMessage,
      });

      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to create appointment',
        metadata: { processingTime },
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
          data: cachedResult as Record<string, unknown>,
          message: 'Appointments retrieved from cache',
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // Build where clause with role-based access control
      const where = this.buildAppointmentWhereClause(filters, context);

      const _offset = (page - 1) * limit;

      const [appointments, total] = await Promise.all([
        this.databaseService.findAppointmentsSafe(where),
        this.databaseService.countAppointmentsSafe(where),
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
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, result, this.CACHE_TTL);

      // HIPAA audit log
      await this.hipaaAuditLog('VIEW_APPOINTMENTS', context, {
        outcome: 'SUCCESS',
        filters,
        resultCount: appointments.length,
      });

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: result,
        message: 'Appointments retrieved successfully',
        metadata: { processingTime },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get appointments: ${errorMessage}`,
        'CoreAppointmentService.getAppointments',
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
        }
      );

      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to retrieve appointments',
        metadata: { processingTime },
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
      // Get appointments using unified database service
      const existingAppointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

      if (!existingAppointment) {
        return {
          success: false,
          error: 'APPOINTMENT_NOT_FOUND',
          message: 'Appointment not found',
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // 2. Validate status transitions
      if (
        updateDto.status &&
        !this.workflowEngine.isValidStatusTransition(existingAppointment.status, updateDto.status)
      ) {
        return {
          success: false,
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot transition from ${existingAppointment.status} to ${updateDto.status}`,
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // 3. Check for scheduling conflicts if date/time is being changed
      if ((updateDto.date || updateDto.time) && existingAppointment.doctorId) {
        const newDate = updateDto.date || existingAppointment.date;
        const newTime = updateDto.time || existingAppointment.time;

        const existingAppointments = await this.getExistingTimeSlots(
          existingAppointment.doctorId,
          existingAppointment.clinicId,
          new Date(newDate)
        );

        const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(
          {
            patientId: existingAppointment.patientId,
            doctorId: existingAppointment.doctorId,
            clinicId: existingAppointment.clinicId,
            requestedTime: new Date(`${String(newDate)}T${String(newTime)}`),
            duration: updateDto.duration || existingAppointment.duration,
            priority: 'regular',
            serviceType: existingAppointment.type,
            ...(updateDto.notes && { notes: updateDto.notes }),
          },
          this.convertToTimeSlots(
            existingAppointments,
            existingAppointment.doctorId,
            existingAppointment.clinicId
          ),
          { allowOverlap: false, suggestAlternatives: true }
        );

        if (!conflictResult.canSchedule) {
          return {
            success: false,
            error: 'SCHEDULING_CONFLICT',
            message: 'Updated appointment time conflicts with existing schedule',
            metadata: {
              processingTime: Date.now() - startTime,
              conflicts: conflictResult.conflicts,
            },
          };
        }
      }

      // 4. Update appointment
      // Handle date conversion properly for exactOptionalPropertyTypes
      const updateData: Record<string, unknown> = { ...updateDto };
      if (updateDto.date) {
        updateData['date'] =
          typeof updateDto.date === 'string' ? new Date(updateDto.date) : updateDto.date;
      }
      // Cast to AppointmentUpdateInput - the Record<string, unknown> is compatible
      // since AppointmentUpdateInput has all optional properties
      const updatedAppointment = (await this.databaseService.updateAppointmentSafe(
        appointmentId,
        updateData as unknown as AppointmentUpdateInput
      )) as AppointmentData;

      // Cast for AppointmentResult compatibility
      const updatedAppointmentResult = updatedAppointment as unknown as Record<string, unknown>;

      // 5. Update workflow if status changed
      if (updateDto.status && String(updateDto.status) !== String(existingAppointment.status)) {
        this.workflowEngine.transitionStatus(
          appointmentId,
          existingAppointment.status,
          updateDto.status,
          context.userId
        );
      }

      // 6. Queue background operations
      await this.queueBackgroundOperations(updatedAppointment, context, 'UPDATE');

      // 7. Emit events
      await this.eventService.emit('appointment.updated', {
        appointmentId: updatedAppointment.id,
        clinicId: updatedAppointment.clinicId,
        doctorId: updatedAppointment.doctorId,
        patientId: updatedAppointment.patientId,
        status: updatedAppointment.status,
        changes: updateDto,
        context,
      });

      // 8. HIPAA audit log
      await this.hipaaAuditLog('UPDATE_APPOINTMENT', context, {
        appointmentId: updatedAppointment.id,
        patientId: updatedAppointment.patientId,
        outcome: 'SUCCESS',
        changes: updateDto,
      });

      // 9. Invalidate cache
      await this.invalidateAppointmentCache(context.clinicId);

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: updatedAppointmentResult,
        message: 'Appointment updated successfully',
        metadata: { processingTime },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update appointment: ${errorMessage}`,
        'CoreAppointmentService.updateAppointment',
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
        }
      );

      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to update appointment',
        metadata: { processingTime },
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
      // Get appointments using unified database service
      const existingAppointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

      if (!existingAppointment) {
        return {
          success: false,
          error: 'APPOINTMENT_NOT_FOUND',
          message: 'Appointment not found',
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // 2. Validate cancellation is allowed
      if (!this.workflowEngine.canCancelAppointment(existingAppointment.status)) {
        return {
          success: false,
          error: 'CANCELLATION_NOT_ALLOWED',
          message: `Cannot cancel appointment in ${existingAppointment.status} status`,
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // 3. Cancel appointment
      const cancelledAppointment = await this.databaseService.updateAppointmentSafe(appointmentId, {
        status: AppointmentStatus.CANCELLED,
      });

      // 4. Update workflow
      this.workflowEngine.transitionStatus(
        appointmentId,
        existingAppointment.status,
        AppointmentStatus.CANCELLED,
        context.userId
      );

      // 5. Queue background operations
      await this.queueBackgroundOperations(cancelledAppointment, context, 'CANCELLATION');

      // 6. Emit events
      await this.eventService.emit('appointment.cancelled', {
        appointmentId: cancelledAppointment.id,
        clinicId: cancelledAppointment.clinicId,
        doctorId: cancelledAppointment.doctorId,
        patientId: cancelledAppointment.patientId,
        reason: reason,
        context,
      });

      // 7. HIPAA audit log
      await this.hipaaAuditLog('CANCEL_APPOINTMENT', context, {
        appointmentId: cancelledAppointment.id,
        patientId: cancelledAppointment.patientId,
        outcome: 'SUCCESS',
        reason,
      });

      // 8. Invalidate cache
      await this.invalidateAppointmentCache(context.clinicId);

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: cancelledAppointment as unknown as Record<string, unknown>,
        message: 'Appointment cancelled successfully',
        metadata: { processingTime },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to cancel appointment: ${errorMessage}`,
        'CoreAppointmentService.cancelAppointment',
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
        }
      );

      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to cancel appointment',
        metadata: { processingTime },
      };
    }
  }

  /**
   * Get appointment metrics for analytics
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    _context: AppointmentContext
  ): Promise<AppointmentResult> {
    const startTime = Date.now();

    try {
      const cacheKey = `metrics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

      // Try to get from cache first
      const cachedMetrics = await this.cacheService.get(cacheKey);
      if (cachedMetrics) {
        return {
          success: true,
          data: cachedMetrics as Record<string, unknown>,
          message: 'Metrics retrieved from cache',
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // Get appointments using unified database service

      // Get appointments in date range
      const appointments = await this.databaseService.findAppointmentsSafe({
        clinicId,
      });

      // Calculate metrics
      const metrics = this.calculateAppointmentMetrics(appointments, dateRange);

      // Cache the metrics
      await this.cacheService.set(cacheKey, metrics, this.METRICS_CACHE_TTL);

      const processingTime = Date.now() - startTime;
      return {
        success: true,
        data: metrics as unknown as Record<string, unknown>,
        message: 'Appointment metrics retrieved successfully',
        metadata: { processingTime },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get appointment metrics: ${errorMessage}`,
        'CoreAppointmentService.getAppointmentMetrics',
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
        }
      );

      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to retrieve appointment metrics',
        metadata: { processingTime },
      };
    }
  }

  // =============================================
  // PRIVATE HELPER METHODS
  // =============================================

  /**
   * Convert appointment time slots to conflict resolution TimeSlot format
   */
  private convertToTimeSlots(
    appointments: AppointmentTimeSlot[],
    doctorId: string,
    clinicId: string
  ): TimeSlot[] {
    return appointments.map(appointment => {
      const startTime = new Date(
        `${appointment.date.toISOString().split('T')[0]}T${appointment.time}`
      );
      const endTime = new Date(startTime.getTime() + appointment.duration * 60000); // duration in minutes

      return {
        startTime,
        endTime,
        doctorId,
        clinicId,
        isAvailable: false, // These are existing appointments, so not available
        appointmentId: appointment.id,
        bufferMinutes: 15, // Default buffer
      };
    });
  }

  private getExistingTimeSlots(
    doctorId: string,
    clinicId: string,
    date: Date
  ): Promise<AppointmentTimeSlot[]> {
    // Using prisma directly instead of databaseService

    return this.databaseService.findAppointmentTimeSlotsSafe(doctorId, clinicId, date);
  }

  private buildAppointmentWhereClause(
    filters: AppointmentFilterDto,
    context: AppointmentContext
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { clinicId: context.clinicId };

    // Apply role-based filtering
    switch (context.role) {
      case 'DOCTOR':
        where['doctorId'] = context.userId;
        break;
      case 'PATIENT':
        where['patientId'] = context.userId;
        break;
      case 'NURSE':
      case 'RECEPTIONIST':
        // Can see all appointments in their clinic
        break;
      default:
        // For unknown roles, restrict to user's own appointments
        where['OR'] = [{ doctorId: context.userId }, { patientId: context.userId }];
        break;
    }

    // Apply filters
    if (filters.status) where['status'] = filters.status;
    if (filters.type) where['type'] = filters.type;
    if (filters.priority) where['priority'] = filters.priority;
    if (filters.patientId) where['patientId'] = filters.patientId;
    if (filters.locationId) where['locationId'] = filters.locationId;

    if (filters.startDate || filters.endDate) {
      where['date'] = {};
      if (filters.startDate) {
        (where['date'] as Record<string, unknown>)['gte'] = new Date(filters.startDate);
      }
      if (filters.endDate) {
        (where['date'] as Record<string, unknown>)['lte'] = new Date(filters.endDate);
      }
    }

    return where;
  }

  private async queueBackgroundOperations(
    appointment: AppointmentData,
    _context: AppointmentContext,
    operation: string = 'CREATE'
  ): Promise<void> {
    try {
      // Queue notification job
      await this.notificationQueue.add(
        'APPOINTMENT_NOTIFICATION',
        {
          appointmentId: appointment.id,
          operation,
          context: _context,
        },
        {
          priority: 3,
          delay: 0,
          attempts: 3,
        }
      );

      // Queue analytics job
      await this.analyticsQueue.add(
        'APPOINTMENT_ANALYTICS',
        {
          appointmentId: appointment.id,
          operation,
          context: _context,
        },
        {
          priority: 5,
          delay: 5000, // 5 second delay
          attempts: 2,
        }
      );

      // Queue appointment processing job
      await this.appointmentQueue.add(
        'APPOINTMENT_PROCESSING',
        {
          appointmentId: appointment.id,
          operation,
          context: _context,
        },
        {
          priority: 2,
          delay: 0,
          attempts: 3,
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to queue background operations: ${errorMessage}`,
        'CoreAppointmentService.queueBackgroundOperations',
        { error: errorMessage }
      );
      // Don't throw error as background operations shouldn't break main flow
    }
  }

  private async invalidateAppointmentCache(clinicId: string): Promise<void> {
    try {
      const patterns = [
        `appointments:${clinicId}:*`,
        `metrics:${clinicId}:*`,
        `doctor:availability:${clinicId}:*`,
      ];

      for (const pattern of patterns) {
        await this.cacheService.delPattern(pattern);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to invalidate cache: ${errorMessage}`,
        'CoreAppointmentService.invalidateAppointmentCache',
        { error: errorMessage }
      );
    }
  }

  private calculateAppointmentMetrics(
    appointments: AppointmentData[],
    _dateRange: { from: Date; to: Date }
  ): CoreAppointmentMetrics {
    const totalAppointments = appointments.length;
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let _cancelledCount = 0;
    let noShowCount = 0;

    appointments.forEach(appointment => {
      // Count by status
      statusCounts[appointment.status] = (statusCounts[appointment.status] || 0) + 1;

      // Count by priority
      const appointmentWithPriority = appointment as { priority?: string };
      if (appointmentWithPriority.priority) {
        priorityCounts[appointmentWithPriority.priority] =
          (priorityCounts[appointmentWithPriority.priority] || 0) + 1;
      }

      // Calculate duration
      if (appointment.duration) {
        totalDuration += appointment.duration;
      }

      // Count specific statuses
      if (appointment.status === 'COMPLETED') completedCount++;
      if (appointment.status === 'CANCELLED') _cancelledCount++;
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
      queueEfficiency: 0, // Would be calculated from queue service
    };
  }

  private async hipaaAuditLog(
    action: string,
    context: AppointmentContext,
    details: unknown
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
          ...(details as Record<string, unknown>),
          compliance: {
            hipaa: true,
            phiAccessed: true,
            auditTrail: true,
          },
        }
      );
    } catch (_error) {
      // Silent failure for audit logging - already in error handling
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to log HIPAA audit: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'CoreAppointmentService.hipaaAuditLog',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      // Don't throw _error as audit logging failure shouldn't break the main operation
    }
  }

  /**
   * Get doctor availability for a specific date
   */
  async getDoctorAvailability(
    doctorId: string,
    date: string,
    _context?: AppointmentContext
  ): Promise<unknown> {
    try {
      const _startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);

      const appointments = await this.databaseService.findAppointmentsSafe({
        doctorId,
        status: 'SCHEDULED',
      });

      // Generate time slots (9 AM to 6 PM)
      const timeSlots = [];
      for (let hour = 9; hour < 18; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          const isBooked = appointments.some(
            (apt: unknown) => (apt as Record<string, unknown>)['time'] === time
          );

          timeSlots.push({
            time,
            available: !isBooked,
            appointmentId: isBooked
              ? appointments.find(
                  (apt: unknown) => (apt as Record<string, unknown>)['time'] === time
                )?.id
              : null,
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
          end: '18:00',
        },
        message: timeSlots.some(slot => slot.available)
          ? 'Doctor has available slots'
          : 'Doctor is fully booked for this date',
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get doctor availability: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'CoreAppointmentService.getDoctorAvailability',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
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
