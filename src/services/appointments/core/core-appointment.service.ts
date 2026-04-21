import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';

// Infrastructure Services
// Using unified DatabaseService for all database operations
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel } from '@core/types';
import { CacheService } from '@infrastructure/cache/cache.service';
import { QueueService } from '@infrastructure/queue';
import { JobType } from '@core/types/queue.types';
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
} from '@dtos/appointment.dto';
import {
  isVideoCallAppointmentType,
  isInPersonAppointmentType,
  isHomeVisitAppointmentType,
} from '@core/types/appointment-guards.types';
// PaymentStatus, PaymentMethod, Language removed - not used in this service
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
import { getVideoConsultationDelegate } from '@core/types/video-database.types';
import type { AppointmentUpdateInput } from '@core/types/input.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';

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
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService)) private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventService: EventService,
    @Inject(forwardRef(() => ConfigService)) private readonly configService: ConfigService,
    private readonly errors: HealthcareErrorsService,
    @Inject(forwardRef(() => ConflictResolutionService))
    private readonly conflictResolutionService: ConflictResolutionService,
    @Inject(forwardRef(() => AppointmentWorkflowEngine))
    private readonly workflowEngine: AppointmentWorkflowEngine,
    @Inject(forwardRef(() => BusinessRulesEngine))
    private readonly businessRules: BusinessRulesEngine
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

      // 0. Validate clinic context integrity
      if (createDto.clinicId && createDto.clinicId !== context.clinicId) {
        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Clinic ID mismatch: Request body does not match context',
          metadata: { processingTime: Date.now() - startTime },
        };
      }

      // 1. Validate appointment type requirements using strict type guards
      if (isVideoCallAppointmentType(createDto.type)) {
        // VIDEO_CALL appointments don't require locationId (can be null/optional)
        // Video room will be auto-created after appointment creation
      } else if (isInPersonAppointmentType(createDto.type)) {
        // IN_PERSON appointments require locationId
        if (!(createDto as { locationId?: string }).locationId) {
          return {
            success: false,
            error: 'VALIDATION_ERROR',
            message: 'Location ID is required for in-person appointments',
            metadata: {
              processingTime: Date.now() - startTime,
            },
          };
        }
      } else if (isHomeVisitAppointmentType(createDto.type)) {
        // HOME_VISIT appointments may not require locationId (patient's address)
        // But should have address information
      }

      // 2. Validate business rules
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

      // 3. Normalize relation IDs
      // The API layer may supply User IDs for doctor/patient, while Prisma relations require entity IDs.
      const resolvedIds = await this.databaseService.executeHealthcareRead<{
        patientId: string | null;
        doctorId: string | null;
        locationId: string | null;
      }>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const patient = await typedClient.patient.findFirst({
          where: {
            OR: [{ id: createDto.patientId }, { userId: createDto.patientId }],
          } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        const doctor = await typedClient.doctor.findFirst({
          where: {
            OR: [{ id: createDto.doctorId }, { userId: createDto.doctorId }],
          } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        const rawLocationId = (createDto as { locationId?: string }).locationId;
        const location = rawLocationId
          ? await typedClient.clinicLocation.findFirst({
              where: {
                OR: [{ id: rawLocationId }, { locationId: rawLocationId }],
              } as PrismaDelegateArgs,
              select: { id: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs)
          : null;

        return {
          patientId: patient?.id ?? null,
          doctorId: doctor?.id ?? null,
          locationId: location?.id ?? null,
        };
      });

      if (!resolvedIds.patientId) {
        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Patient record not found for the provided patientId',
          metadata: {
            processingTime: Date.now() - startTime,
          },
        };
      }

      if (!resolvedIds.doctorId) {
        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Doctor record not found for the provided doctorId',
          metadata: {
            processingTime: Date.now() - startTime,
          },
        };
      }

      if (isInPersonAppointmentType(createDto.type) && !resolvedIds.locationId) {
        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Location record not found for the provided locationId',
          metadata: {
            processingTime: Date.now() - startTime,
          },
        };
      }

      // 4. Check for scheduling conflicts
      const appointmentDate = new Date(createDto.appointmentDate);
      const existingAppointments = await this.getExistingTimeSlots(
        resolvedIds.doctorId,
        context.clinicId,
        appointmentDate
      );

      const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(
        {
          patientId: resolvedIds.patientId,
          doctorId: resolvedIds.doctorId,
          clinicId: context.clinicId,
          requestedTime: appointmentDate,
          duration: createDto.duration,
          priority: this.mapPriority(createDto.priority || AppointmentPriority.NORMAL),
          serviceType: createDto.type,
          ...(createDto.notes && { notes: createDto.notes }),
        },
        this.convertToTimeSlots(existingAppointments, resolvedIds.doctorId, context.clinicId),
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

      // 4. Create appointment with enhanced metadata
      // Extract date and time from appointmentDate
      const appointmentDateTime = new Date(createDto.appointmentDate);
      const { date: dateStr, time: timeStr } = this.getISTDateAndTime(appointmentDateTime);

      const appointmentData: Record<string, unknown> = {
        ...createDto,
        patientId: resolvedIds.patientId,
        doctorId: resolvedIds.doctorId,
        ...(resolvedIds.locationId && { locationId: resolvedIds.locationId }),
        userId: context.userId, // Add required userId
        clinicId: context.clinicId, // Enforce context clinic ID
        status: AppointmentStatus.SCHEDULED,
        priority: createDto.priority || AppointmentPriority.NORMAL,
        date: new Date(`${dateStr}T00:00:00.000+05:30`),
        time: timeStr,
      };
      // Remove appointmentDate as it's not part of AppointmentCreateInput
      delete appointmentData['appointmentDate'];

      // Cast to AppointmentCreateInput - appointmentData has all required fields from createDto
      const appointment = (await this.databaseService.createAppointmentSafe(
        appointmentData as unknown as Parameters<
          typeof this.databaseService.createAppointmentSafe
        >[0]
      )) as AppointmentData;

      // Cast for AppointmentResult compatibility
      const appointmentResult = appointment as unknown as Record<string, unknown>;

      // 5. Auto-create video room for VIDEO_CALL appointments
      // Note: Video room creation is handled by AppointmentsService after appointment creation
      // to avoid circular dependencies. The video room creation is triggered via event.
      if (isVideoCallAppointmentType(appointment.type)) {
        void this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          `Video appointment created - video room will be auto-created`,
          'CoreAppointmentService.createAppointment',
          { appointmentId: appointment.id, type: appointment.type }
        );
      }

      // 6. Initialize workflow
      this.workflowEngine.initializeWorkflow(appointment.id, 'APPOINTMENT_CREATED');

      // 7. Queue background operations
      await this.queueBackgroundOperations(appointment, context);

      // 8. Emit events
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
   * Optimized for 10M+ users: Uses indexes, pagination, and efficient queries
   *
   * NOTE: Caching is handled by AppointmentsService wrapper to avoid double caching
   * This method focuses on database query optimization only (SOLID: Single Responsibility)
   */
  async getAppointments(
    filters: AppointmentFilterDto,
    context: AppointmentContext,
    page: number = 1,
    limit: number = 20
  ): Promise<AppointmentResult> {
    const startTime = Date.now();

    try {
      // Build where clause with role-based access control (uses indexed fields)
      const where = this.buildAppointmentWhereClause(filters, context);

      // Calculate pagination offset (optimized for large datasets)
      const offset = (page - 1) * limit;

      // Parallel queries for data and count (optimized for 10M+ users)
      // Both queries use indexed fields: clinicId, doctorId, patientId, status, date
      const [appointments, total] = await Promise.all([
        this.databaseService.findAppointmentsSafe(where, {
          skip: offset,
          take: limit,
          // Stable ordering prevents freshly-booked appointments from being buried
          // when many rows share the same appointment date.
          orderBy:
            context.role === 'PATIENT'
              ? [{ date: 'desc' }, { createdAt: 'desc' }]
              : [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
        this.databaseService.countAppointmentsSafe(where),
      ]);

      // Apply priority-based sorting for doctor/staff if requested or by default for specific statuses
      let sortedAppointments = appointments;
      const isClinicStaff = ['DOCTOR', 'RECEPTIONIST', 'PHARMACIST', 'ASSISTANT_DOCTOR'].includes(
        context.role
      );
      const normalizedStatus = String(filters.status || '').toUpperCase();

      if (
        isClinicStaff &&
        (normalizedStatus === 'SCHEDULED' ||
          normalizedStatus === 'CONFIRMED' ||
          normalizedStatus === 'WAITING' ||
          filters.priority)
      ) {
        const PRIORITY_WEIGHTS: Record<string, number> = {
          EMERGENCY: 100,
          URGENT: 80,
          HIGH: 50,
          MEDIUM: 30,
          NORMAL: 20,
          LOW: 10,
          ROUTINE: 0,
        };

        sortedAppointments = [...appointments].sort((a, b) => {
          const pA = a.priority ? (PRIORITY_WEIGHTS[a.priority.toUpperCase()] ?? 20) : 20;
          const pB = b.priority ? (PRIORITY_WEIGHTS[b.priority.toUpperCase()] ?? 20) : 20;
          if (pA !== pB) return pB - pA;
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        });
      }

      const result = {
        appointments: sortedAppointments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };

      // HIPAA audit log (async, non-blocking)
      void this.hipaaAuditLog('VIEW_APPOINTMENTS', context, {
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

      // Robust error handling - log synchronously for critical errors
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get appointments: ${errorMessage}`,
        'CoreAppointmentService.getAppointments',
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
          filters,
          context: { clinicId: context.clinicId, role: context.role },
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

      // Enforce strict isolation: Appointment must belong to current clinic context
      if (!existingAppointment || existingAppointment.clinicId !== context.clinicId) {
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
      if (updateDto.appointmentDate && existingAppointment.doctorId) {
        const newAppointmentDate = new Date(updateDto.appointmentDate);
        const { date: newDateStr } = this.getISTDateAndTime(newAppointmentDate);

        const existingAppointments = await this.getExistingTimeSlots(
          existingAppointment.doctorId,
          existingAppointment.clinicId,
          new Date(`${newDateStr}T00:00:00.000+05:30`)
        );

        const updateDtoWithNotes = updateDto as Record<string, unknown>;
        const notesValue = updateDtoWithNotes['notes'] as string | undefined;
        const conflictResult = await this.conflictResolutionService.resolveSchedulingConflict(
          {
            patientId: existingAppointment.patientId,
            doctorId: existingAppointment.doctorId,
            clinicId: existingAppointment.clinicId,
            requestedTime: newAppointmentDate,
            duration: updateDto.duration || existingAppointment.duration,
            priority: 'regular',
            serviceType: existingAppointment.type,
            // notes property exists in UpdateAppointmentDto (line 355)
            ...(notesValue && { notes: notesValue }),
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
      if (updateDto.appointmentDate) {
        const appointmentDateTime = new Date(updateDto.appointmentDate);
        const { date: dateStr, time: timeStr } = this.getISTDateAndTime(appointmentDateTime);
        updateData['date'] = new Date(`${dateStr}T00:00:00.000+05:30`);
        updateData['time'] = timeStr;
        // Remove appointmentDate as it's not part of AppointmentUpdateInput
        delete updateData['appointmentDate'];
      } else {
        // Ensure appointmentDate is not in updateData
        delete updateData['appointmentDate'];
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

      // Enforce strict isolation: Appointment must belong to current clinic context
      if (!existingAppointment || existingAppointment.clinicId !== context.clinicId) {
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
        cancellationReason: reason,
        cancelledBy: context.userId,
        cancelledAt: new Date(),
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

      // 6. Keep any linked video session aligned with the appointment status
      await this.cancelAssociatedVideoSession(appointmentId, context);

      // 7. Emit events
      await this.eventService.emit('appointment.cancelled', {
        appointmentId: cancelledAppointment.id,
        clinicId: cancelledAppointment.clinicId,
        doctorId: cancelledAppointment.doctorId,
        patientId: cancelledAppointment.patientId,
        reason: reason,
        context,
      });

      // 8. HIPAA audit log
      await this.hipaaAuditLog('CANCEL_APPOINTMENT', context, {
        appointmentId: cancelledAppointment.id,
        patientId: cancelledAppointment.patientId,
        outcome: 'SUCCESS',
        reason,
      });

      // 9. Invalidate cache
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
    const rawStatusList = (filters as AppointmentFilterDto & { statusList?: AppointmentStatus[] })
      .statusList;
    const rawStatusValue = String(filters.status || '').trim();
    const normalizedStatusList =
      Array.isArray(rawStatusList) && rawStatusList.length > 0
        ? rawStatusList
            .map(value => String(value).trim().toUpperCase())
            .filter((value): value is AppointmentStatus =>
              Object.values(AppointmentStatus).includes(value as AppointmentStatus)
            )
        : rawStatusValue.includes(',')
          ? rawStatusValue
              .split(',')
              .map(value => value.trim().toUpperCase())
              .filter((value): value is AppointmentStatus =>
                Object.values(AppointmentStatus).includes(value as AppointmentStatus)
              )
          : rawStatusValue
            ? [rawStatusValue.toUpperCase() as AppointmentStatus]
            : [];

    // Apply role-based filtering
    switch (context.role) {
      case 'DOCTOR':
        where['doctorId'] = context.doctorId || context.userId;
        break;
      case 'PATIENT':
        // Prefer the resolved Patient.id so the query can use indexed scalar filters.
        if (context.patientId) {
          where['patientId'] = context.patientId;
        } else {
          // Fallback for older call sites that only pass the authenticated User.id.
          where['patient'] = { userId: context.userId };
        }
        break;
      case 'NURSE':
      case 'RECEPTIONIST':
        // Can see all appointments in their clinic
        // Enforce location scope when clinic context is location-tagged.
        if (context.role === 'RECEPTIONIST' && context.locationId) {
          where['locationId'] = context.locationId;
        }
        break;
      default:
        // For unknown roles, restrict to user's own appointments
        where['OR'] = [{ doctorId: context.userId }, { patientId: context.userId }];
        break;
    }

    // Apply filters
    if (normalizedStatusList && normalizedStatusList.length > 0) {
      where['status'] =
        normalizedStatusList.length === 1 ? normalizedStatusList[0] : { in: normalizedStatusList };
    } else if (filters.status) {
      where['status'] = filters.status;
    }
    if (filters.type) where['type'] = filters.type;
    if (filters.priority) where['priority'] = filters.priority;
    if (filters.patientId) where['patientId'] = filters.patientId;
    if (!(context.role === 'RECEPTIONIST' && context.locationId) && filters.locationId) {
      where['locationId'] = filters.locationId;
    }

    if (filters.date || filters.startDate || filters.endDate) {
      where['date'] = {};

      if (filters.date) {
        const date = new Date(filters.date);
        const startOfDay = new Date(date.setUTCHours(0, 0, 0, 0));
        const endOfDay = new Date(date.setUTCHours(23, 59, 59, 999));
        (where['date'] as Record<string, unknown>)['gte'] = startOfDay;
        (where['date'] as Record<string, unknown>)['lte'] = endOfDay;
      } else {
        if (filters.startDate) {
          (where['date'] as Record<string, unknown>)['gte'] = new Date(filters.startDate);
        }
        if (filters.endDate) {
          (where['date'] as Record<string, unknown>)['lte'] = new Date(filters.endDate);
        }
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
      // Queue notification job using canonical JobType
      await this.queueService.addJob(
        JobType.NOTIFICATION,
        'APPOINTMENT_NOTIFICATION',
        {
          appointmentId: appointment.id,
          operation,
          context: _context,
        },
        {
          priority: (QueueService.PRIORITIES as { NORMAL: number }).NORMAL,
          delay: 0,
          attempts: 3,
        }
      );

      // Queue analytics job using canonical JobType
      await this.queueService.addJob(
        JobType.ANALYTICS,
        'APPOINTMENT_ANALYTICS',
        {
          appointmentId: appointment.id,
          operation,
          context: _context,
        },
        {
          priority: (QueueService.PRIORITIES as { LOW: number }).LOW,
          delay: 5000, // 5 second delay
          attempts: 2,
        }
      );

      // Queue appointment processing job using canonical JobType
      await this.queueService.addJob(
        JobType.APPOINTMENT,
        'APPOINTMENT_PROCESSING',
        {
          appointmentId: appointment.id,
          operation,
          context: _context,
        },
        {
          priority: (QueueService.PRIORITIES as { HIGH: number }).HIGH,
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

  private async cancelAssociatedVideoSession(
    appointmentId: string,
    context: AppointmentContext
  ): Promise<void> {
    try {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const delegate = getVideoConsultationDelegate(client);
          await delegate.updateMany({
            where: { appointmentId, status: { not: 'CANCELLED' } },
            data: { status: 'CANCELLED' },
          });
        },
        {
          userId: context.userId,
          userRole: context.role,
          operation: 'CANCEL_APPOINTMENT',
          resourceType: 'videoConsultation',
          resourceId: appointmentId,
          clinicId: context.clinicId,
        }
      );

      await this.cacheService.del(`video_session:${appointmentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to cancel linked video session: ${errorMessage}`,
        'CoreAppointmentService.cancelAssociatedVideoSession',
        {
          appointmentId,
          error: errorMessage,
        }
      );
    }
  }

  private async invalidateAppointmentCache(clinicId: string): Promise<void> {
    try {
      const patterns = [
        `appointments:${clinicId}:*`,
        `metrics:${clinicId}:*`,
        `doctor:*:clinic:${clinicId}:*availability*`, // Matches enhanced key pattern
        `availability:${clinicId}:*`,
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

  private getISTDateAndTime(date: Date): { date: string; time: string } {
    const istDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);

    const istTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    return { date: istDate, time: istTime };
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
      type SessionWindow = { start: string; end: string };
      const isRecord = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value);
      const normalizeTime = (value: unknown): string | null => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
        if (!match) return null;
        const h = Number(match[1]);
        const m = Number(match[2]);
        if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
          return null;
        }
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };
      const extractSessions = (value: unknown): SessionWindow[] => {
        if (!value) return [];
        if (Array.isArray(value)) {
          return value
            .map(item => {
              if (!isRecord(item)) return null;
              const start = normalizeTime(item['start']);
              const end = normalizeTime(item['end']);
              if (!start || !end) return null;
              return { start, end };
            })
            .filter((x): x is SessionWindow => !!x);
        }
        if (isRecord(value)) {
          const start = normalizeTime(value['start']);
          const end = normalizeTime(value['end']);
          if (start && end) return [{ start, end }];
        }
        return [];
      };
      const extractDaySessions = (value: unknown, dayName: string): SessionWindow[] => {
        if (!value) return [];
        if (isRecord(value) && dayName in value) {
          return extractSessions(value[dayName]);
        }
        return extractSessions(value);
      };

      const defaultWorkingHours = {
        start: '11:00',
        end: '23:59',
      };
      const workingHours = { ...defaultWorkingHours };
      let sessionWindows: SessionWindow[] = [];
      let slotDuration = 30;
      if (_context?.appointmentType === 'VIDEO_CALL') {
        slotDuration = 15;
      } else if (_context?.appointmentType === 'IN_PERSON' || !_context?.appointmentType) {
        slotDuration = 3;
      }
      let clinicPaused = false;
      let doctorPaused = false;
      let emergencyOnly = false;
      let generalConsultationEnabled = true;
      let videoConsultationEnabled = true;
      let pauseReason = '';
      const dayName = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
      })
        .format(new Date(`${date}T00:00:00.000+05:30`))
        .toLowerCase();

      // Check doctor-clinic association and specific location availability
      if (_context?.clinicId) {
        try {
          const doctorClinic = await this.databaseService.executeHealthcareRead(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              doctorClinic: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
              clinic: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
            };
            const association = await typedClient.doctorClinic.findUnique({
              where: {
                doctorId_clinicId: {
                  doctorId,
                  clinicId: _context.clinicId,
                },
              } as PrismaDelegateArgs,
              include: {
                doctor: { select: { workingHours: true, isAvailable: true } },
                location: { select: { id: true, workingHours: true } },
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);

            const clinic = await typedClient.clinic.findUnique({
              where: { id: _context.clinicId } as PrismaDelegateArgs,
              select: { settings: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);

            return { association, clinic };
          });

          const associationData = doctorClinic as {
            association?: {
              locationId: string | null;
              startTime: Date | null;
              endTime: Date | null;
              doctor?: { workingHours?: unknown; isAvailable?: boolean } | null;
              location?: { workingHours?: unknown } | null;
            } | null;
            clinic?: { settings?: unknown } | null;
          } | null;

          const association = associationData?.association;
          const clinicSettings = isRecord(associationData?.clinic?.settings)
            ? associationData?.clinic?.settings
            : {};
          const appointmentSettings = isRecord(clinicSettings['appointmentSettings'])
            ? clinicSettings['appointmentSettings']
            : {};
          const clinicOpdControls = isRecord(appointmentSettings['opdControls'])
            ? appointmentSettings['opdControls']
            : isRecord(appointmentSettings['opdControl'])
              ? appointmentSettings['opdControl']
              : {};
          const doctorControlMap = isRecord(appointmentSettings['doctorConsultationControls'])
            ? appointmentSettings['doctorConsultationControls']
            : {};
          const doctorControl = isRecord(doctorControlMap[doctorId])
            ? doctorControlMap[doctorId]
            : {};

          const configuredAppointmentDuration = Number(appointmentSettings['appointmentDuration']);
          if (_context?.appointmentType === 'VIDEO_CALL') {
            // Video proposals are always quarter-hour slots in the patient UX and validation flow.
            slotDuration = 15;
          } else {
            slotDuration = Math.max(
              3,
              Number.isFinite(configuredAppointmentDuration)
                ? configuredAppointmentDuration
                : slotDuration
            );
          }
          clinicPaused = Boolean(
            clinicOpdControls['isOpdPaused'] ?? clinicOpdControls['clinicPaused'] ?? false
          );
          doctorPaused = Boolean(doctorControl['isPaused'] ?? doctorControl['paused'] ?? false);
          emergencyOnly = Boolean(
            clinicOpdControls['emergencyOnly'] ?? doctorControl['emergencyOnly'] ?? false
          );
          generalConsultationEnabled = Boolean(
            doctorControl['generalConsultationEnabled'] ??
            clinicOpdControls['generalConsultationEnabled'] ??
            true
          );
          videoConsultationEnabled = Boolean(
            doctorControl['videoConsultationEnabled'] ??
            clinicOpdControls['videoConsultationEnabled'] ??
            true
          );
          pauseReason =
            (typeof doctorControl['pauseReason'] === 'string'
              ? doctorControl['pauseReason']
              : '') ||
            (typeof clinicOpdControls['pauseReason'] === 'string'
              ? clinicOpdControls['pauseReason']
              : '');

          if (association?.doctor?.isAvailable === false) {
            doctorPaused = true;
          }

          if (association) {
            // If doctor is assigned to a specific location, satisfy strict location requirement
            if (
              _context.locationId &&
              association.locationId &&
              association.locationId !== _context.locationId
            ) {
              return {
                doctorId,
                date,
                available: false,
                availableSlots: [],
                bookedSlots: [],
                workingHours,
                restrictions: {
                  clinicPaused,
                  doctorPaused: true,
                  emergencyOnly,
                  generalConsultationEnabled,
                  videoConsultationEnabled,
                  reason: 'Doctor is not available at this location',
                },
                message: 'Doctor is not available at this location',
              };
            }

            if (
              clinicPaused ||
              doctorPaused ||
              (!generalConsultationEnabled && !videoConsultationEnabled)
            ) {
              return {
                doctorId,
                date,
                available: false,
                availableSlots: [],
                bookedSlots: [],
                workingHours,
                restrictions: {
                  clinicPaused,
                  doctorPaused,
                  emergencyOnly,
                  generalConsultationEnabled,
                  videoConsultationEnabled,
                  reason: pauseReason || 'Consultation is currently paused',
                },
                message:
                  pauseReason ||
                  (clinicPaused
                    ? 'Clinic OPD is temporarily paused'
                    : doctorPaused
                      ? 'Doctor consultation is temporarily paused'
                      : 'Consultation is currently disabled'),
              };
            }

            const locationSessions = extractDaySessions(
              association.location?.workingHours,
              dayName
            );
            const doctorSessions = extractDaySessions(association.doctor?.workingHours, dayName);
            const clinicSessions = extractDaySessions(
              appointmentSettings['operatingWindowsByDay'],
              dayName
            );

            // Update working hours if defined - extract HH:mm using IST to avoid UTC shifts
            const timeFormatOptions = {
              timeZone: 'Asia/Kolkata',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            } as const;
            if (association.startTime) {
              workingHours.start = new Intl.DateTimeFormat('en-US', timeFormatOptions).format(
                new Date(association.startTime)
              );
            }
            if (association.endTime) {
              workingHours.end = new Intl.DateTimeFormat('en-US', timeFormatOptions).format(
                new Date(association.endTime)
              );
            }

            const legacySession = [{ start: workingHours.start, end: workingHours.end }];
            sessionWindows =
              locationSessions.length > 0
                ? locationSessions
                : doctorSessions.length > 0
                  ? doctorSessions
                  : clinicSessions.length > 0
                    ? clinicSessions
                    : legacySession;
          }
        } catch (e) {
          // Fallback to defaults if check fails
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to check doctor details for availability: ${e instanceof Error ? e.message : String(e)}`,
            'CoreAppointmentService.getDoctorAvailability'
          );
        }
      }

      if (sessionWindows.length === 0) {
        sessionWindows = [{ start: defaultWorkingHours.start, end: defaultWorkingHours.end }];
      }

      // Build a precise day-boundary filter so only appointments on THIS date in IST count
      // Use IST offset (+05:30) to define the exact start and end of the day in that timezone
      const dayStart = new Date(`${date}T00:00:00.000+05:30`);
      const dayEnd = new Date(`${date}T23:59:59.999+05:30`);

      const appointmentsResult = await this.databaseService.findAppointmentsSafe(
        {
          doctorId,
          ...(_context?.clinicId && { clinicId: _context.clinicId }),
          // Filter to only active appointments on the requested date
          // Cancelled/Completed/No-show appointments free up the slot
          date: { gte: dayStart, lte: dayEnd },
          status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
        },
        { rowLevelSecurity: false }
      );

      // Ensure appointments is an array
      // findAppointmentsSafe should return AppointmentWithRelations[], but handle edge cases
      type AppointmentItem = Record<string, unknown> & { id?: string; time?: string };
      let appointments: AppointmentItem[] = [];
      if (Array.isArray(appointmentsResult)) {
        appointments = appointmentsResult as unknown as AppointmentItem[];
      } else if (
        appointmentsResult &&
        typeof appointmentsResult === 'object' &&
        'data' in appointmentsResult
      ) {
        const data = (appointmentsResult as { data: unknown }).data;
        appointments = Array.isArray(data) ? (data as AppointmentItem[]) : [];
      }

      // Generate time slots based on working hours
      const timeSlots = [];
      const slotsByTime = new Map<
        string,
        { time: string; available: boolean; appointmentId?: string | null }
      >();
      const validSessions = sessionWindows
        .map(window => {
          const [startHour, startMinute] = window.start.split(':').map(Number);
          const [endHour, endMinute] = window.end.split(':').map(Number);
          const startMinutes = (startHour || 0) * 60 + (startMinute || 0);
          const endMinutes = (endHour || 0) * 60 + (endMinute || 0);
          if (
            !Number.isFinite(startMinutes) ||
            !Number.isFinite(endMinutes) ||
            endMinutes <= startMinutes
          ) {
            return null;
          }
          return { ...window, startMinutes, endMinutes };
        })
        .filter((w): w is SessionWindow & { startMinutes: number; endMinutes: number } => !!w);

      if (validSessions.length === 0) {
        validSessions.push({
          start: defaultWorkingHours.start,
          end: defaultWorkingHours.end,
          startMinutes: 11 * 60,
          endMinutes: 23 * 60 + 59,
        });
      }

      const earliestStart = Math.min(...validSessions.map(x => x.startMinutes));
      const latestEnd = Math.max(...validSessions.map(x => x.endMinutes));
      workingHours.start = `${Math.floor(earliestStart / 60)
        .toString()
        .padStart(2, '0')}:${(earliestStart % 60).toString().padStart(2, '0')}`;
      workingHours.end = `${Math.floor(latestEnd / 60)
        .toString()
        .padStart(2, '0')}:${(latestEnd % 60).toString().padStart(2, '0')}`;

      for (const window of validSessions) {
        for (
          let currentMinutes = window.startMinutes;
          currentMinutes < window.endMinutes;
          currentMinutes += slotDuration
        ) {
          const hour = Math.floor(currentMinutes / 60);
          const minute = currentMinutes % 60;

          const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

          // Check if slot is booked - account for appointment duration (default 30 min)
          // A slot is unavailable if it falls within any existing appointment's time range
          const isBooked = appointments.some((apt: AppointmentItem) => {
            const aptTime = (apt as Record<string, unknown>)['time'] as string | undefined;
            if (!aptTime) return false;
            const aptDuration =
              ((apt as Record<string, unknown>)['duration'] as number | undefined) || 30;
            // Extract time parts - using non-null assertion on split result
            const timeParts = (aptTime || '').split(':');
            const aptHour = parseInt(timeParts[0] || '0', 10);
            const aptMin = parseInt(timeParts[1] || '0', 10);
            const aptStartMinutes = aptHour * 60 + aptMin;

            // Slot overlaps with appointment if:
            // Appointment start is before slot end AND Appointment end is after slot start
            const slotEndMinutes = currentMinutes + slotDuration;
            const aptEndMinutes = aptStartMinutes + aptDuration;

            return aptStartMinutes < slotEndMinutes && aptEndMinutes > currentMinutes;
          });

          // 3. For today's availability, filter out slots that have already passed
          const dateParts = date.split('-');
          // Enforce IST time exactly
          const now = new Date();
          const istOptions = {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          } as const;
          const istParts = new Intl.DateTimeFormat('en-US', istOptions).formatToParts(now);
          const istYear = parseInt(istParts.find(p => p.type === 'year')?.value || '2000', 10);
          const istMonth = parseInt(istParts.find(p => p.type === 'month')?.value || '1', 10);
          const istDay = parseInt(istParts.find(p => p.type === 'day')?.value || '1', 10);

          const requestedDate = new Date(
            parseInt(dateParts[0] || '2000'),
            parseInt(dateParts[1] || '01') - 1,
            parseInt(dateParts[2] || '01')
          );
          const todayIST = new Date(istYear, istMonth - 1, istDay);
          const isToday = requestedDate.toDateString() === todayIST.toDateString();

          if (isToday) {
            // Calculate current minutes in IST explicitly
            const istTimeOptions = {
              timeZone: 'Asia/Kolkata',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            } as const;
            const istTimeParts = new Intl.DateTimeFormat('en-US', istTimeOptions).format(now);
            const [currentHourStr, currentMinuteStr] = istTimeParts.split(':');
            const currentHour = parseInt(currentHourStr || '0', 10);
            const currentMinute = parseInt(currentMinuteStr || '0', 10);
            const totalCurrentMinutes = currentHour * 60 + currentMinute;

            // For same-day booking, only hide slots that are already in the past.
            if (currentMinutes < totalCurrentMinutes) {
              slotsByTime.set(time, {
                time,
                available: false,
                appointmentId: null,
              });
              continue;
            }
          }

          const bookedAppointment = isBooked
            ? appointments.find((apt: AppointmentItem) => {
                const aptTime = (apt as Record<string, unknown>)['time'] as string | undefined;
                if (!aptTime) return false;
                const aptDuration =
                  ((apt as Record<string, unknown>)['duration'] as number | undefined) || 30;
                // Extract time parts - using non-null assertion on split result
                const timeParts = (aptTime || '').split(':');
                const aptHour = parseInt(timeParts[0] || '0', 10);
                const aptMin = parseInt(timeParts[1] || '0', 10);
                const aptStartMinutes = aptHour * 60 + aptMin;
                const aptEndMinutes = aptStartMinutes + aptDuration;

                return currentMinutes >= aptStartMinutes && currentMinutes < aptEndMinutes;
              })
            : null;

          slotsByTime.set(time, {
            time,
            available: !isBooked,
            appointmentId: bookedAppointment?.id ?? null,
          });
        }
      }
      timeSlots.push(
        ...Array.from(slotsByTime.values()).sort((a, b) => a.time.localeCompare(b.time))
      );

      return {
        doctorId,
        date,
        available: timeSlots.some(slot => slot.available),
        availableSlots: timeSlots.filter(slot => slot.available).map(slot => slot.time),
        bookedSlots: timeSlots.filter(slot => !slot.available).map(slot => slot.time),
        workingHours,
        workingSessions: validSessions.map(({ start, end }) => ({ start, end })),
        restrictions: {
          clinicPaused,
          doctorPaused,
          emergencyOnly,
          generalConsultationEnabled,
          videoConsultationEnabled,
          reason: pauseReason || '',
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
