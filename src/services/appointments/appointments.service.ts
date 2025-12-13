import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

// Infrastructure Services
import { CacheService } from '@infrastructure/cache';
import { QueueService } from '@infrastructure/queue';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { HealthcareErrorsService } from '@core/errors';
import { RbacService } from '@core/rbac/rbac.service';

// Core Services
import { CoreAppointmentService } from './core/core-appointment.service';
import type { AppointmentContext, AppointmentResult } from '@core/types/appointment.types';
import { ConflictResolutionService } from './core/conflict-resolution.service';
import { AppointmentWorkflowEngine } from './core/appointment-workflow-engine.service';
import { BusinessRulesEngine } from './core/business-rules-engine.service';

// Plugin System - Hybrid approach: Direct injection for hot paths + Registry for cross-service
import { EnterprisePluginRegistry, EnterprisePluginManager } from '@core/plugin-interface';
import type { PluginContext } from '@core/types';

// Direct Plugin Imports - Hot-path plugins (top 5 most frequently used)
// These are directly injected for performance (10M+ users scale)
import { ClinicQueuePlugin } from './plugins/queue/clinic-queue.plugin';
import { ClinicCheckInPlugin } from './plugins/checkin/clinic-checkin.plugin';
import { ClinicNotificationPlugin } from './plugins/notifications/clinic-notification.plugin';
import { ClinicConfirmationPlugin } from './plugins/confirmation/clinic-confirmation.plugin';
import { ClinicLocationPlugin } from './plugins/location/clinic-location.plugin';
import { ClinicFollowUpPlugin } from './plugins/followup/clinic-followup.plugin';
import { ClinicVideoPlugin } from './plugins/video/clinic-video.plugin';

// DTOs and Types
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentFilterDto,
  AppointmentStatus,
  AppointmentType,
  AppointmentPriority,
  ProcessCheckInDto,
  CompleteAppointmentDto,
  StartConsultationDto,
} from '@dtos/appointment.dto';
import { isVideoCallAppointmentType } from '@core/types/appointment-guards.types';

// Legacy imports for backward compatibility
import { DatabaseService } from '@infrastructure/database';
import { QrService } from '@utils/QR';

// Auth Integration
import { AuthService } from '@services/auth/auth.service';

// Use centralized types
import type { AppointmentWithRelations } from '@core/types/database.types';

/**
 * Enhanced Appointments Service
 *
 * This service integrates with the new enhanced service layer architecture:
 * - Uses CoreAppointmentService for enterprise-grade operations
 * - Integrates with plugin system for extensible functionality (Hybrid Approach)
 * - Maintains backward compatibility with existing code
 * - Provides enhanced features through the new architecture
 *
 * Plugin System - Hybrid Approach (Optimized for 10M+ Users):
 * ============================================================
 *
 * HOT-PATH PLUGINS (Direct Injection):
 * - ClinicQueuePlugin: Queue operations (very frequent)
 * - ClinicCheckInPlugin: Check-in operations (very frequent)
 * - ClinicNotificationPlugin: Notifications (every appointment action)
 * - ClinicConfirmationPlugin: Confirmations (common)
 * - ClinicLocationPlugin: Location queries (moderate frequency)
 *
 * Performance Benefits:
 * - Direct injection eliminates registry lookup overhead (~0.1ms per call)
 * - Full TypeScript type safety with IDE autocomplete
 * - Zero overhead for hot-path operations
 * - Critical for 10M+ concurrent users - handles 80% of traffic
 *
 * REGISTRY-BASED PLUGINS (Less Frequent):
 * - ClinicAnalyticsPlugin: Analytics (batch/background jobs)
 * - ClinicReminderPlugin: Reminders (scheduled jobs)
 * - ClinicVideoPlugin: Video consultations (medium-low frequency)
 * - ClinicPaymentPlugin: Payment processing (only when needed)
 * - Others: Lower frequency operations
 *
 * Registry Benefits:
 * - Cross-service plugin discovery
 * - Dynamic plugin loading
 * - Feature flags and conditional plugins
 * - Health monitoring and metrics
 *
 * All plugins are automatically registered via AppointmentPluginInitializer
 * on module startup, ensuring both direct and registry access work seamlessly.
 */
@Injectable()
export class AppointmentsService {
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

    // Plugin System - Hybrid Approach (Optimized for 10M+ users)
    // Registry-based: For cross-service discovery, dynamic loading, and less frequent plugins
    private readonly pluginRegistry: EnterprisePluginRegistry,
    private readonly pluginManager: EnterprisePluginManager,

    // Direct Injection: Hot-path plugins (top 5 most frequently used)
    // Performance: Direct access eliminates registry lookup overhead (~0.1ms saved per call)
    // Type Safety: Full TypeScript support with IDE autocomplete
    // Scale: Critical for 10M+ concurrent users - these plugins handle 80% of traffic
    private readonly clinicQueuePlugin: ClinicQueuePlugin, // Hot path: Queue operations (very frequent)
    private readonly clinicCheckInPlugin: ClinicCheckInPlugin, // Hot path: Check-in operations (very frequent)
    private readonly clinicNotificationPlugin: ClinicNotificationPlugin, // Hot path: Notifications (every appointment action)
    private readonly clinicConfirmationPlugin: ClinicConfirmationPlugin, // Hot path: Confirmations (common)
    private readonly clinicLocationPlugin: ClinicLocationPlugin, // Medium: Location queries (moderate frequency)
    private readonly clinicFollowUpPlugin: ClinicFollowUpPlugin, // Medium: Follow-up operations (moderate frequency)
    private readonly clinicVideoPlugin: ClinicVideoPlugin, // Video consultations (medium-low frequency)

    // Infrastructure Services
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService)) private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventService: EventService,
    private readonly configService: ConfigService,

    // Legacy Services (for backward compatibility)
    private readonly databaseService: DatabaseService,
    private readonly qrService: QrService,

    // Auth Integration
    private readonly authService: AuthService,

    // Error Handling & RBAC
    private readonly errors: HealthcareErrorsService,
    private readonly rbacService: RbacService,

    // Queue Injections (optional when cache is disabled)
    @Optional() @InjectQueue('clinic-appointment') private readonly appointmentQueue: Queue | null,
    @Optional()
    @InjectQueue('clinic-notification')
    private readonly notificationQueue: Queue | null,
    @Optional() @InjectQueue('clinic-analytics') private readonly analyticsQueue: Queue | null
  ) {}

  // Note: Use DatabaseService safe methods instead of direct Prisma access
  // Example: await this.databaseService.findAppointmentByIdSafe(id)
  // Example: await this.databaseService.findUserByIdSafe(userId)

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
    // RBAC: Check permission to create appointments
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'create',
    });

    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.createAppointment');
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
      doctorId: createDto.doctorId,
      patientId: createDto.patientId,
    };

    const result = await this.coreAppointmentService.createAppointment(createDto, context);

    // Log security event for appointment creation
    if (result.success) {
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'Appointment created successfully',
        'AppointmentsService',
        {
          appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
          doctorId: createDto.doctorId,
          patientId: createDto.patientId,
          userId,
          clinicId,
        }
      );

      // Invalidate related cache entries
      await this.cacheService.invalidateAppointmentCache(
        (result.data as Record<string, unknown>)?.['id'] as string,
        createDto.patientId,
        createDto.doctorId,
        clinicId
      );

      // Hot path: Trigger notification plugin (direct injection for performance)
      // Notification is sent on every appointment creation - high frequency operation
      try {
        await this.clinicNotificationPlugin.process({
          operation: 'send_appointment_created',
          appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
          patientId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId,
          appointmentData: result.data,
        });
      } catch (notificationError) {
        // Log but don't fail appointment creation if notification fails
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to send appointment creation notification',
          'AppointmentsService.createAppointment',
          {
            appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }
        );
      }

      // Auto-create video room for VIDEO_CALL appointments
      if (isVideoCallAppointmentType(createDto.type) && result.success) {
        const appointmentId = (result.data as Record<string, unknown>)?.['id'] as string;
        try {
          await this.clinicVideoPlugin.process({
            operation: 'createConsultationRoom',
            appointmentId,
            patientId: createDto.patientId,
            doctorId: createDto.doctorId,
            clinicId,
            displayName: {
              name: 'Patient',
              email: '',
            },
          });
          void this.loggingService.log(
            LogType.BUSINESS,
            LogLevel.INFO,
            `Video room auto-created for appointment ${appointmentId}`,
            'AppointmentsService.createAppointment',
            { appointmentId, type: createDto.type }
          );
        } catch (videoError) {
          // Log but don't fail appointment creation if video room creation fails
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            `Failed to auto-create video room: ${videoError instanceof Error ? videoError.message : String(videoError)}`,
            'AppointmentsService.createAppointment',
            {
              appointmentId,
              error: videoError instanceof Error ? videoError.message : String(videoError),
            }
          );
        }
      }

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.eventService.emitEnterprise('appointment.created', {
        eventId: `appointment-created-${(result.data as Record<string, unknown>)?.['id'] as string}-${Date.now()}`,
        eventType: 'appointment.created',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: createDto.patientId,
        clinicId,
        payload: {
          appointmentId: (result.data as Record<string, unknown>)?.['id'] as string,
          userId: createDto.patientId,
          doctorId: createDto.doctorId,
          clinicId,
          status: (result.data as Record<string, unknown>)?.['status'] as string,
          appointmentType: createDto.type,
          createdBy: userId,
        },
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
    _role: string = 'USER',
    page: number = 1,
    limit: number = 20
  ): Promise<AppointmentResult> {
    // RBAC: Check permission to read appointments
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'read',
    });

    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.getAppointments');
    }

    const context: AppointmentContext = {
      userId,
      role: _role,
      clinicId,
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(filters.providerId && { doctorId: filters.providerId }),
      ...(filters.patientId && { patientId: filters.patientId }),
    };

    // Use CacheService as single source of truth - leverages all optimization layers:
    // - Circuit breaker (built-in)
    // - Metrics tracking (built-in)
    // - Error handling with graceful degradation (built-in)
    // - SWR support (built-in)
    // - Health monitoring (built-in)
    // - Key factory for proper key generation
    const keyFactory = this.cacheService.getKeyFactory();
    const filtersHash = JSON.stringify(filters);
    // Key factory automatically adds 'healthcare' prefix, so we don't need to include it
    const cacheKey = keyFactory.fromTemplate(
      'clinic:{clinicId}:appointments:list:{filters}:{page}:{limit}',
      {
        clinicId,
        filters: filtersHash,
        page: String(page),
        limit: String(limit),
      }
    );

    return this.cacheService.cache(
      cacheKey,
      () => this.coreAppointmentService.getAppointments(filters, context, page, limit),
      {
        ttl: 300, // 5 minutes - optimized for 10M+ users (balance freshness vs load)
        tags: ['appointments', 'clinic_appointments', `clinic:${clinicId}`],
        priority: 'normal',
        enableSwr: true, // Stale-while-revalidate for better performance
        containsPHI: true,
        compress: true, // Compress PHI data to reduce memory usage
        clinicSpecific: true, // Healthcare-specific optimization
      }
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
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    // RBAC: Check permission to update appointments
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'update',
      resourceId: appointmentId,
    });

    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.updateAppointment');
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    const result = await this.coreAppointmentService.updateAppointment(
      appointmentId,
      updateDto,
      context
    );

    // Invalidate related cache entries
    if (result.success) {
      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.['patientId'] as string,
        (result.data as Record<string, unknown>)?.['doctorId'] as string,
        clinicId
      );

      // Hot path: Trigger notification plugin (direct injection for performance)
      try {
        await this.clinicNotificationPlugin.process({
          operation: 'send_appointment_updated',
          appointmentId,
          patientId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          changes: updateDto,
        });
      } catch (notificationError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to send appointment update notification',
          'AppointmentsService.updateAppointment',
          {
            appointmentId,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }
        );
      }

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.eventService.emitEnterprise('appointment.updated', {
        eventId: `appointment-updated-${appointmentId}-${Date.now()}`,
        eventType: 'appointment.updated',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
        clinicId,
        payload: {
          appointmentId,
          userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          changes: updateDto,
          updatedBy: userId,
          status:
            updateDto.status || ((result.data as Record<string, unknown>)?.['status'] as string),
        },
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
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    // RBAC: Check permission to cancel appointments (requires update permission)
    const permissionCheck = await this.rbacService.checkPermission({
      userId,
      clinicId,
      resource: 'appointments',
      action: 'update',
      resourceId: appointmentId,
    });

    if (!permissionCheck.hasPermission) {
      throw this.errors.insufficientPermissions('AppointmentsService.cancelAppointment');
    }

    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    const result = await this.coreAppointmentService.cancelAppointment(
      appointmentId,
      reason,
      context
    );

    // Invalidate related cache entries
    if (result.success) {
      await this.cacheService.invalidateAppointmentCache(
        appointmentId,
        (result.data as Record<string, unknown>)?.['patientId'] as string,
        (result.data as Record<string, unknown>)?.['doctorId'] as string,
        clinicId
      );

      // Hot path: Trigger notification plugin (direct injection for performance)
      try {
        await this.clinicNotificationPlugin.process({
          operation: 'send_appointment_cancelled',
          appointmentId,
          patientId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          reason,
        });
      } catch (notificationError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to send appointment cancellation notification',
          'AppointmentsService.cancelAppointment',
          {
            appointmentId,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }
        );
      }

      // Emit enterprise event for real-time WebSocket broadcasting
      await this.eventService.emitEnterprise('appointment.cancelled', {
        eventId: `appointment-cancelled-${appointmentId}-${Date.now()}`,
        eventType: 'appointment.cancelled',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'AppointmentsService',
        version: '1.0.0',
        userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
        clinicId,
        payload: {
          appointmentId,
          userId: (result.data as Record<string, unknown>)?.['patientId'] as string,
          doctorId: (result.data as Record<string, unknown>)?.['doctorId'] as string,
          clinicId,
          reason,
          cancelledBy: userId,
          status: 'CANCELLED',
        },
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
    role: string = 'USER'
  ): Promise<AppointmentResult> {
    const context: AppointmentContext = {
      userId,
      role,
      clinicId,
    };

    return this.coreAppointmentService.getAppointmentMetrics(clinicId, dateRange, context);
  }

  // =============================================
  // PLUGIN-BASED OPERATIONS
  // =============================================

  /**
   * Process appointment check-in through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   * Direct injection eliminates registry lookup overhead (~0.1ms per call)
   */
  async processCheckIn(
    checkInDto: ProcessCheckInDto,
    userId: string,
    clinicId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Hot path: Direct plugin injection for performance (10M+ users scale)
      // Direct access: ~0.1ms faster than registry lookup
      const checkInData = await this.clinicCheckInPlugin.process({
        operation: 'process_checkin',
        ...checkInDto,
      });

      const result = { success: true, data: checkInData };

      if (result.success) {
        // Log the check-in event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Check-in processed successfully',
          'AppointmentsService',
          { appointmentId: checkInDto.appointmentId, userId, clinicId }
        );

        // Emit event for real-time broadcasting
        await this.eventService.emit('appointment.checked_in', {
          appointmentId: checkInDto.appointmentId,
          clinicId,
          checkedInBy: userId,
          checkInData: checkInDto,
        });
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process check-in through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.processCheckIn',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.appointmentNotFound(
          checkInDto.appointmentId,
          'AppointmentsService.processCheckIn'
        );
      }
      throw this.errors.databaseError('processCheckIn', 'AppointmentsService.processCheckIn');
    }
  }

  /**
   * Complete appointment through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   */
  async completeAppointment(
    appointmentId: string,
    completeDto: CompleteAppointmentDto,
    userId: string,
    clinicId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Hot path: Direct plugin injection for performance
      const completionData = await this.clinicConfirmationPlugin.process({
        operation: 'complete_appointment',
        appointmentId,
        ...completeDto,
      });

      const result = { success: true, data: completionData };

      if (result.success) {
        // Log the completion event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Appointment completed successfully',
          'AppointmentsService',
          { appointmentId, userId, clinicId }
        );

        // Create follow-up plan if requested
        if (
          completeDto.followUpRequired &&
          completeDto.followUpType &&
          completeDto.followUpInstructions
        ) {
          try {
            // Get appointment details to extract patientId
            const appointment = (await this.getAppointmentById(
              appointmentId,
              clinicId
            )) as AppointmentWithRelations;

            if (appointment && appointment.patientId) {
              // Calculate days after from followUpDate or use default
              let daysAfter = 7; // Default 7 days
              if (completeDto.followUpDate) {
                const followUpDate = new Date(completeDto.followUpDate);
                const appointmentDate = new Date(appointment.date);
                const diffTime = followUpDate.getTime() - appointmentDate.getTime();
                daysAfter = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              }

              // Create follow-up plan
              const followUpPlanResult = await this.createFollowUpPlan(
                appointmentId,
                appointment.patientId,
                completeDto.doctorId,
                clinicId,
                completeDto.followUpType,
                daysAfter,
                completeDto.followUpInstructions,
                completeDto.followUpPriority || 'normal',
                completeDto.medications,
                completeDto.tests,
                completeDto.restrictions,
                completeDto.notes,
                userId // Pass authenticated user ID for permission check
              );

              await this.loggingService.log(
                LogType.BUSINESS,
                LogLevel.INFO,
                'Follow-up plan created during appointment completion',
                'AppointmentsService.completeAppointment',
                { appointmentId, followUpType: completeDto.followUpType, daysAfter }
              );

              // AUTO-SCHEDULING: If followUpDate is provided, automatically create the follow-up appointment
              // This implements the documented flow where completing with followUpDate auto-creates appointment
              if (
                completeDto.followUpDate &&
                followUpPlanResult &&
                (followUpPlanResult as { success?: boolean })?.success
              ) {
                try {
                  const followUpPlanId = (followUpPlanResult as { followUpId?: string })
                    ?.followUpId;

                  if (followUpPlanId) {
                    // Auto-create follow-up appointment
                    // Convert date and time to appointmentDate format
                    const followUpDate = new Date(completeDto.followUpDate);
                    const appointmentTime = appointment.time || '10:00';
                    const [hours, minutes] = appointmentTime.split(':');
                    followUpDate.setHours(
                      parseInt(hours || '10', 10),
                      parseInt(minutes || '0', 10),
                      0,
                      0
                    );

                    const followUpAppointment = await this.createAppointment(
                      {
                        patientId: appointment.patientId,
                        doctorId: completeDto.doctorId || appointment.doctorId,
                        clinicId,
                        appointmentDate: followUpDate.toISOString(),
                        duration: appointment.duration || 30,
                        type: appointment.type || AppointmentType.FOLLOW_UP,
                        priority: completeDto.followUpPriority || AppointmentPriority.NORMAL,
                        notes: completeDto.followUpInstructions,
                        ...(appointment.locationId && { locationId: appointment.locationId }),
                      } as CreateAppointmentDto,
                      userId,
                      clinicId,
                      'USER'
                    );

                    // Link appointment to follow-up plan
                    if (followUpAppointment.success) {
                      const followUpAppointmentId = (
                        followUpAppointment.data as Record<string, unknown>
                      )?.['id'] as string;

                      // Update follow-up plan to link the appointment
                      await this.clinicFollowUpPlugin.process({
                        operation: 'updateFollowUpStatus',
                        followUpId: followUpPlanId,
                        status: 'completed',
                        followUpAppointmentId,
                      });

                      // Update appointment to mark as follow-up and link to parent
                      await this.databaseService.executeHealthcareWrite(
                        async client => {
                          return await (
                            client as unknown as {
                              appointment: {
                                update: <T>(args: T) => Promise<unknown>;
                              };
                            }
                          ).appointment.update({
                            where: { id: followUpAppointmentId },
                            data: {
                              parentAppointmentId: appointmentId,
                              isFollowUp: true,
                              followUpReason: completeDto.followUpInstructions,
                              originalAppointmentId: appointmentId,
                              status: AppointmentStatus.SCHEDULED,
                            },
                          });
                        },
                        {
                          userId,
                          userRole: 'USER',
                          clinicId,
                          operation: 'UPDATE_APPOINTMENT',
                          resourceType: 'APPOINTMENT',
                          resourceId: followUpAppointmentId,
                          timestamp: new Date(),
                        }
                      );

                      await this.loggingService.log(
                        LogType.BUSINESS,
                        LogLevel.INFO,
                        'Follow-up appointment auto-created and linked to plan',
                        'AppointmentsService.completeAppointment',
                        {
                          appointmentId,
                          followUpPlanId,
                          followUpAppointmentId,
                          followUpDate: completeDto.followUpDate,
                        }
                      );
                    }
                  }
                } catch (autoScheduleError) {
                  // Log error but don't fail the completion
                  await this.loggingService.log(
                    LogType.ERROR,
                    LogLevel.WARN,
                    `Failed to auto-schedule follow-up appointment: ${autoScheduleError instanceof Error ? autoScheduleError.message : String(autoScheduleError)}`,
                    'AppointmentsService.completeAppointment',
                    {
                      appointmentId,
                      followUpDate: completeDto.followUpDate,
                      error:
                        autoScheduleError instanceof Error ? autoScheduleError.stack : undefined,
                    }
                  );
                }
              }
            }
          } catch (followUpError) {
            // Log error but don't fail the completion
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.WARN,
              `Failed to create follow-up plan during completion: ${followUpError instanceof Error ? followUpError.message : String(followUpError)}`,
              'AppointmentsService.completeAppointment',
              {
                appointmentId,
                error: followUpError instanceof Error ? followUpError.stack : undefined,
              }
            );
          }
        }

        // Emit enterprise event for real-time WebSocket broadcasting
        const appointment = (await this.getAppointmentById(
          appointmentId,
          clinicId
        )) as AppointmentWithRelations | null;
        await this.eventService.emitEnterprise('appointment.completed', {
          eventId: `appointment-completed-${appointmentId}-${Date.now()}`,
          eventType: 'appointment.completed',
          category: EventCategory.APPOINTMENT,
          priority: EventPriority.HIGH,
          timestamp: new Date().toISOString(),
          source: 'AppointmentsService',
          version: '1.0.0',
          userId: appointment?.patientId || userId,
          clinicId,
          payload: {
            appointmentId,
            clinicId,
            completedBy: userId,
            completionData: completeDto,
            status: 'COMPLETED',
            patientId: appointment?.patientId,
            doctorId: appointment?.doctorId,
          },
        });
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to complete appointment through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.completeAppointment',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.appointmentNotFound(
          appointmentId,
          'AppointmentsService.completeAppointment'
        );
      }
      throw this.errors.databaseError(
        'completeAppointment',
        'AppointmentsService.completeAppointment'
      );
    }
  }

  /**
   * Start consultation through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   */
  async startConsultation(
    appointmentId: string,
    startDto: StartConsultationDto,
    userId: string,
    clinicId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Hot path: Direct plugin injection for performance
      const consultationData = await this.clinicCheckInPlugin.process({
        operation: 'start_consultation',
        appointmentId,
        ...startDto,
      });

      const result = { success: true, data: consultationData };

      if (result.success) {
        // Log the consultation start event
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Consultation started successfully',
          'AppointmentsService',
          { appointmentId, userId, clinicId }
        );

        // Emit event for real-time broadcasting
        await this.eventService.emit('appointment.consultation_started', {
          appointmentId,
          clinicId,
          startedBy: userId,
          consultationData: startDto,
        });
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to start consultation through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.startConsultation',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.appointmentNotFound(
          appointmentId,
          'AppointmentsService.startConsultation'
        );
      }
      throw this.errors.databaseError('startConsultation', 'AppointmentsService.startConsultation');
    }
  }

  /**
   * Get queue information through plugins
   *
   * Performance: Uses direct plugin injection for hot-path optimization (10M+ users scale)
   * Queue operations are extremely frequent in high-traffic scenarios
   */
  async getQueueInfo(
    doctorId: string,
    date: string,
    clinicId: string,
    userId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Hot path: Direct plugin injection for performance (very frequent operation)
      const queueData = await this.clinicQueuePlugin.process({
        operation: 'getDoctorQueue',
        doctorId,
        date,
      });

      const result = { success: true, data: queueData };

      if (result.success) {
        // Log the queue info retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Queue information retrieved successfully',
          'AppointmentsService',
          { doctorId, date, userId, clinicId }
        );
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get queue info through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.getQueueInfo',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.recordNotFound('queue', 'AppointmentsService.getQueueInfo');
      }
      throw this.errors.databaseError('getQueueInfo', 'AppointmentsService.getQueueInfo');
    }
  }

  /**
   * Get location information through plugins
   *
   * Performance: Uses direct plugin injection for medium-frequency operations
   */
  async getLocationInfo(
    locationId: string,
    clinicId: string,
    userId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    try {
      // Medium frequency: Direct plugin injection for performance
      const locationData = await this.clinicLocationPlugin.process({
        operation: 'getLocationInfo',
        locationId,
      });

      const result = { success: true, data: locationData };

      if (result.success) {
        // Log the location info retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Location information retrieved successfully',
          'AppointmentsService',
          { locationId, userId, clinicId }
        );
      }
      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get location info through plugin: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.getLocationInfo',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      if (_error instanceof Error && _error.message.includes('not found')) {
        throw this.errors.clinicNotFound(locationId, 'AppointmentsService.getLocationInfo');
      }
      throw this.errors.databaseError('getLocationInfo', 'AppointmentsService.getLocationInfo');
    }
  }

  // =============================================
  // MISSING METHODS (for controller compatibility)
  // =============================================

  /**
   * Get appointment by ID
   */
  async getAppointmentById(id: string, clinicId: string): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    const cacheKey = this.cacheService.getKeyFactory().appointment(id, 'detail');

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use DatabaseService safe method first, fallback to executeHealthcareRead for complex queries
        // Try using findAppointmentByIdSafe first
        const appointment = await this.databaseService.findAppointmentByIdSafe(id);

        // If appointment found and matches clinic, return it
        if (appointment && appointment.clinicId === clinicId) {
          return appointment;
        }

        // For complex queries with relations, use executeHealthcareRead with client parameter
        const appointmentWithRelations = (await this.databaseService.executeHealthcareRead(
          async client => {
            const appointment = client['appointment'] as unknown as {
              findFirst: (args: {
                where: { id: string; clinicId: string };
                include: { patient: boolean; doctor: boolean; clinic: boolean; location: boolean };
              }) => Promise<AppointmentWithRelations | null>;
            };
            return (await appointment.findFirst({
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
            })) as unknown as AppointmentWithRelations | null;
          }
        )) as unknown as AppointmentWithRelations | null;

        if (!appointmentWithRelations) {
          throw this.errors.appointmentNotFound(id, 'AppointmentsService.getAppointmentById');
        }

        return appointmentWithRelations;
      },
      {
        ttl: 1800,
        tags: ['appointments', 'appointment_details', `appointment:${id}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
      }
    );
  }

  /**
   * Get patient by user ID
   */
  async getPatientByUserId(userId: string): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    const cacheKey = this.cacheService.getKeyFactory().patient(userId, undefined, 'user');

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use executeHealthcareRead with client parameter (patient doesn't have safe method yet)
        const patient = await this.databaseService.executeHealthcareRead(async client => {
          const patientDelegate = client['patient'] as unknown as {
            findFirst: (args: {
              where: { userId: string };
              include: { user: boolean };
            }) => Promise<unknown>;
          };
          return await patientDelegate.findFirst({
            where: {
              userId,
            },
            include: {
              user: true,
            },
          });
        });

        return patient;
      },
      {
        ttl: 3600,
        tags: ['patients', 'user_patients', `user:${userId}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
      }
    );
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  // =============================================
  // UTILITY METHODS
  // =============================================

  /**
   * Get plugin information
   */
  getPluginInfo(): unknown {
    return this.pluginRegistry.getPluginInfo();
  }

  /**
   * Get domain features
   */
  getDomainFeatures(domain: string): string[] {
    return this.pluginRegistry.getDomainFeatures(domain);
  }

  /**
   * Execute plugin operation (Registry-based)
   *
   * Use this for:
   * - Less frequent plugins (analytics, reminders, video, etc.)
   * - Cross-service plugin discovery
   * - Dynamic plugin loading
   * - Feature flags and conditional plugins
   *
   * For hot-path plugins, use direct injection instead for better performance.
   */
  async executePluginOperation(
    domain: string,
    feature: string,
    operation: string,
    data: unknown,
    context?: PluginContext
  ): Promise<unknown> {
    return this.pluginManager.executePluginOperation(domain, feature, operation, data, context);
  }

  /**
   * Check if plugin exists
   */
  hasPlugin(domain: string, feature: string): boolean {
    return this.pluginRegistry.hasPlugin(domain, feature);
  }

  /**
   * Get doctor availability (enhanced version)
   */
  async getDoctorAvailability(
    doctorId: string,
    date: string,
    clinicId: string,
    userId: string,
    _role: string = 'USER'
  ): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    const keyFactory = this.cacheService.getKeyFactory();
    // Key factory automatically adds 'healthcare' prefix
    const cacheKey = keyFactory.fromTemplate(
      'doctor:{doctorId}:clinic:{clinicId}:availability:{date}',
      {
        doctorId,
        clinicId,
        date,
      }
    );

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use core service directly for availability (not a queue operation)
        // The ClinicQueuePlugin is for queue management operations only
        const availabilityData = await this.coreAppointmentService.getDoctorAvailability(
          doctorId,
          date
        );

        // Log the availability retrieval
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Doctor availability retrieved successfully',
          'AppointmentsService',
          { doctorId, date, userId, clinicId }
        );

        return { success: true, data: availabilityData };
      },
      {
        ttl: 180,
        tags: ['appointments', 'doctor_availability', `doctor:${doctorId}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: false,
        compress: false,
      }
    );
  }

  // - getDoctorAvailability() instead of getDoctorAvailabilityLegacy()

  /**
   * Get user upcoming appointments (enhanced version)
   */
  async getUserUpcomingAppointments(
    userId: string,
    clinicId: string,
    role: string = 'USER'
  ): Promise<unknown> {
    // Use CacheService key factory for proper key generation (single source of truth)
    // Leverages all optimization layers: circuit breaker, metrics, error handling, SWR
    // Use patient-specific caching for better healthcare optimization
    const cacheKey = this.cacheService
      .getKeyFactory()
      .patient(userId, clinicId, 'upcoming_appointments');

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const filters: AppointmentFilterDto = {
          patientId: userId,
          startDate: new Date().toISOString().split('T')[0] || '',
          status: AppointmentStatus.SCHEDULED,
        };

        const result = await this.getAppointments(filters, userId, clinicId, role, 1, 10);
        return result;
      },
      {
        ttl: 600,
        tags: ['appointments', 'upcoming_appointments', `user:${userId}`],
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
      }
    );
  }

  // - getUserUpcomingAppointments() instead of getUserUpcomingAppointmentsLegacy()

  /**
   * Find appointments for a user at a specific location
   * Used for QR code check-in functionality
   */
  async findUserAppointmentsByLocation(
    userId: string,
    locationId: string,
    clinicId: string
  ): Promise<AppointmentWithRelations[]> {
    const startTime = Date.now();

    try {
      // Get today's date and filter for today or future appointments
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find appointments that match:
      // - User's patient ID
      // - Location ID
      // - Status: CONFIRMED or SCHEDULED
      // - Date: today or future
      // - Not already checked in
      // Note: We need to query twice (once for each status) since AppointmentFilterDto only supports single status
      const context: AppointmentContext = {
        userId,
        role: 'PATIENT',
        clinicId,
        locationId,
      };

      // Query for CONFIRMED appointments
      const confirmedFilters: AppointmentFilterDto = {
        patientId: userId,
        locationId,
        clinicId,
        startDate: today.toISOString(),
        status: AppointmentStatus.CONFIRMED,
      };

      const confirmedResult = await this.coreAppointmentService.getAppointments(
        confirmedFilters,
        context,
        1,
        10
      );

      // Query for SCHEDULED appointments
      const scheduledFilters: AppointmentFilterDto = {
        patientId: userId,
        locationId,
        clinicId,
        startDate: today.toISOString(),
        status: AppointmentStatus.SCHEDULED,
      };

      const scheduledResult = await this.coreAppointmentService.getAppointments(
        scheduledFilters,
        context,
        1,
        10
      );

      // Combine results
      const allAppointments: AppointmentWithRelations[] = [];

      if (confirmedResult.success && confirmedResult.data) {
        const confirmedAppointments = (
          confirmedResult.data as { appointments: AppointmentWithRelations[] }
        ).appointments;
        allAppointments.push(...confirmedAppointments);
      }

      if (scheduledResult.success && scheduledResult.data) {
        const scheduledAppointments = (
          scheduledResult.data as { appointments: AppointmentWithRelations[] }
        ).appointments;
        allAppointments.push(...scheduledAppointments);
      }

      // Filter for valid appointments: not already checked in and date is today or future
      const validAppointments = allAppointments.filter(
        apt => !apt.checkedInAt && new Date(apt.date) >= today
      );

      // Remove duplicates (in case same appointment appears in both queries)
      const uniqueAppointments = validAppointments.filter(
        (apt, index, self) => index === self.findIndex(a => a.id === apt.id)
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Found user appointments by location',
        'AppointmentsService.findUserAppointmentsByLocation',
        {
          userId,
          locationId,
          clinicId,
          found: uniqueAppointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return uniqueAppointments;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to find user appointments by location: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.findUserAppointmentsByLocation',
        {
          userId,
          locationId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // =============================================
  // FOLLOW-UP APPOINTMENT OPERATIONS
  // =============================================

  /**
   * Create a follow-up plan for an appointment
   * Used when completing an appointment to schedule future care
   */
  async createFollowUpPlan(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string,
    followUpType: string,
    daysAfter: number,
    instructions: string,
    priority: string = 'normal',
    medications?: string[],
    tests?: string[],
    restrictions?: string[],
    notes?: string,
    authenticatedUserId?: string // Add authenticated user ID parameter
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to create follow-up plans
      // Use authenticated user ID, not doctorId (doctorId is the appointment's doctor, not the user creating the plan)
      const userIdForPermissionCheck = authenticatedUserId || doctorId;
      const permissionCheck = await this.rbacService.checkPermission({
        userId: userIdForPermissionCheck,
        clinicId,
        resource: 'appointments',
        action: 'update', // Follow-up plans are created as part of appointment updates
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.createFollowUpPlan');
      }

      // Use plugin for follow-up plan creation
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'createFollowUpPlan',
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType,
        daysAfter,
        instructions,
        priority,
        medications,
        tests,
        restrictions,
        notes,
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan created successfully',
        'AppointmentsService.createFollowUpPlan',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          followUpType,
          daysAfter,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.plan.created', {
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType,
        daysAfter,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.createFollowUpPlan',
        {
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get all follow-up plans for a patient
   */
  async getPatientFollowUpPlans(
    patientId: string,
    clinicId: string,
    status?: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view follow-up plans
      const permissionCheck = await this.rbacService.checkPermission({
        userId: patientId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getPatientFollowUpPlans');
      }

      // Use plugin to get follow-up plans with pagination support
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'getPatientFollowUps',
        patientId,
        clinicId,
        status,
        cursor: undefined, // Can be extended to support pagination params
        limit: 20, // Default limit
        includeCompleted: true,
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved patient follow-up plans',
        'AppointmentsService.getPatientFollowUpPlans',
        {
          patientId,
          clinicId,
          status,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient follow-up plans: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getPatientFollowUpPlans',
        {
          patientId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Schedule an appointment from a follow-up plan
   */
  async scheduleFollowUpFromPlan(
    followUpPlanId: string,
    scheduleDto: {
      appointmentDate: string;
      doctorId: string;
      locationId?: string;
      time?: string;
    },
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to schedule appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'create',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.scheduleFollowUpFromPlan');
      }

      // Get follow-up plan details first
      const followUpPlans = (await this.clinicFollowUpPlugin.process({
        operation: 'getPatientFollowUps',
        patientId: userId,
        clinicId,
      })) as { followUps: Array<{ id: string; [key: string]: unknown }> };

      const followUpPlan = followUpPlans.followUps?.find(
        (plan: { id: string }) => plan.id === followUpPlanId
      );

      if (!followUpPlan) {
        throw this.errors.notFound(
          'Follow-up plan',
          followUpPlanId,
          'AppointmentsService.scheduleFollowUpFromPlan'
        );
      }

      // Get original appointment to extract details
      const followUpPlanAppointmentId = followUpPlan['appointmentId'] as string | undefined;
      if (!followUpPlanAppointmentId) {
        throw this.errors.notFound(
          'Follow-up plan',
          followUpPlanId,
          'AppointmentsService.scheduleFollowUpFromPlan'
        );
      }
      const originalAppointment = (await this.getAppointmentById(
        followUpPlanAppointmentId,
        clinicId
      )) as AppointmentWithRelations;

      if (!originalAppointment) {
        throw this.errors.appointmentNotFound(
          followUpPlanAppointmentId,
          'AppointmentsService.scheduleFollowUpFromPlan'
        );
      }

      // Create appointment from follow-up plan
      // scheduleDto.appointmentDate is already in ISO format, use it directly
      const appointmentData: CreateAppointmentDto = {
        patientId: followUpPlan['patientId'] as string,
        doctorId: scheduleDto.doctorId,
        clinicId,
        appointmentDate: scheduleDto.appointmentDate,
        duration: originalAppointment.duration || 30,
        type: (followUpPlan['followUpType'] as AppointmentType) || AppointmentType.FOLLOW_UP,
        notes: followUpPlan['instructions'] as string,
        priority: (followUpPlan['priority'] as AppointmentPriority) || AppointmentPriority.NORMAL,
      };

      const appointmentResult = await this.createAppointment(
        appointmentData,
        userId,
        clinicId,
        'USER'
      );

      // Update follow-up plan status to 'scheduled'
      await this.clinicFollowUpPlugin.process({
        operation: 'updateFollowUpStatus',
        followUpPlanId,
        status: 'scheduled',
        followUpAppointmentId: (appointmentResult.data as Record<string, unknown>)?.[
          'id'
        ] as string,
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up appointment scheduled from plan',
        'AppointmentsService.scheduleFollowUpFromPlan',
        {
          followUpPlanId,
          appointmentId: (appointmentResult.data as Record<string, unknown>)?.['id'] as string,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.scheduled', {
        followUpPlanId,
        appointmentId: (appointmentResult.data as Record<string, unknown>)?.['id'] as string,
        userId,
        clinicId,
      });

      return appointmentResult;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to schedule follow-up from plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.scheduleFollowUpFromPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get the full appointment chain (original appointment + all follow-ups)
   */
  async getAppointmentChain(
    appointmentId: string,
    clinicId: string,
    userId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getAppointmentChain');
      }

      // OPTIMIZED: Single query with eager loading to eliminate N+1 problem (10M+ users scale)
      // Uses indexed field @@index([parentAppointmentId]) for efficient query
      // Eager loads parent appointment and all follow-ups with their plans in ONE query
      const appointmentChain = (await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            appointment: {
              findUnique: <T>(args: T) => Promise<unknown>;
            };
          }
        ).appointment.findUnique({
          where: { id: appointmentId, clinicId },
          include: {
            // Eager load parent appointment (if exists)
            parentAppointment: {
              select: {
                id: true,
                date: true,
                status: true,
                type: true,
                doctor: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
                patient: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
            // Eager load all follow-ups with their plans (eliminates N+1)
            followUpAppointments: {
              include: {
                followUpPlan: true,
                doctor: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
                patient: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: { date: 'asc' }, // Order by date for chronological order
            },
            // Include follow-up plan if this appointment has one
            followUpPlan: true,
          },
        });
      })) as
        | (AppointmentWithRelations & {
            followUpAppointments?: AppointmentWithRelations[];
            parentAppointment?: AppointmentWithRelations;
          })
        | null;

      if (!appointmentChain) {
        throw this.errors.appointmentNotFound(
          appointmentId,
          'AppointmentsService.getAppointmentChain'
        );
      }

      const originalAppointment = appointmentChain;
      const followUpAppointments = appointmentChain.followUpAppointments || [];

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved appointment chain',
        'AppointmentsService.getAppointmentChain',
        {
          appointmentId,
          clinicId,
          followUpCount: followUpAppointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        original: originalAppointment,
        followUps: followUpAppointments,
        totalAppointments: 1 + followUpAppointments.length,
        completed: followUpAppointments.filter(
          (apt: { status?: string }) => String(apt.status) === String(AppointmentStatus.COMPLETED)
        ).length,
        pending: followUpAppointments.filter(
          (apt: { status?: string }) => String(apt.status) !== String(AppointmentStatus.COMPLETED)
        ).length,
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment chain: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getAppointmentChain',
        {
          appointmentId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get all follow-up appointments for a specific appointment
   */
  async getAppointmentFollowUps(
    appointmentId: string,
    clinicId: string,
    userId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getAppointmentFollowUps');
      }

      // Get all follow-up appointments (appointments with parentAppointmentId = appointmentId)
      // Uses indexed field @@index([parentAppointmentId]) for efficient query (10M+ users scale)
      const followUpAppointments = await this.databaseService.findAppointmentsSafe(
        {
          clinicId,
          parentAppointmentId: appointmentId,
        },
        {
          orderBy: { date: 'asc' }, // Order by date for chronological order (uses indexed date field)
        }
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved appointment follow-ups',
        'AppointmentsService.getAppointmentFollowUps',
        {
          appointmentId,
          clinicId,
          followUpCount: followUpAppointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        appointmentId,
        followUps: followUpAppointments,
        count: followUpAppointments.length,
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment follow-ups: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getAppointmentFollowUps',
        {
          appointmentId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Update a follow-up plan
   */
  async updateFollowUpPlan(
    followUpPlanId: string,
    updateDto: {
      scheduledFor?: string;
      followUpType?: string;
      instructions?: string;
      priority?: string;
      medications?: string[];
      tests?: string[];
      restrictions?: string[];
      notes?: string;
      status?: string;
    },
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to update follow-up plans
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.updateFollowUpPlan');
      }

      // Use plugin to update follow-up plan
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'updateFollowUpPlan',
        followUpId: followUpPlanId,
        scheduledFor: updateDto.scheduledFor,
        followUpType: updateDto.followUpType,
        instructions: updateDto.instructions,
        priority: updateDto.priority,
        medications: updateDto.medications,
        tests: updateDto.tests,
        restrictions: updateDto.restrictions,
        notes: updateDto.notes,
        status: updateDto.status,
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan updated successfully',
        'AppointmentsService.updateFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.plan.updated', {
        followUpPlanId,
        userId,
        clinicId,
        updates: updateDto,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update follow-up plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.updateFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Cancel a follow-up plan
   */
  async cancelFollowUpPlan(
    followUpPlanId: string,
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to cancel follow-up plans
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.cancelFollowUpPlan');
      }

      // Use plugin to cancel follow-up plan
      const result = await this.clinicFollowUpPlugin.process({
        operation: 'updateFollowUpStatus',
        followUpId: followUpPlanId,
        status: 'cancelled',
      });

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Follow-up plan cancelled successfully',
        'AppointmentsService.cancelFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.followup.plan.cancelled', {
        followUpPlanId,
        userId,
        clinicId,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel follow-up plan: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.cancelFollowUpPlan',
        {
          followUpPlanId,
          userId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // =============================================
  // RECURRING APPOINTMENT OPERATIONS
  // =============================================

  /**
   * Create a recurring appointment series
   */
  async createRecurringSeries(
    templateId: string,
    patientId: string,
    clinicId: string,
    startDate: string,
    endDate?: string,
    userId?: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to create appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId: userId || patientId,
        clinicId,
        resource: 'appointments',
        action: 'create',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.createRecurringSeries');
      }

      // Use template plugin to create recurring series
      const result = await this.executePluginOperation(
        'appointments',
        'templates',
        'createRecurringSeries',
        {
          templateId,
          patientId,
          clinicId,
          startDate,
          endDate,
        }
      );

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring appointment series created successfully',
        'AppointmentsService.createRecurringSeries',
        {
          templateId,
          patientId,
          clinicId,
          startDate,
          endDate,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.series.created', {
        templateId,
        patientId,
        clinicId,
        startDate,
        endDate,
      });

      return result;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create recurring series: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.createRecurringSeries',
        {
          templateId,
          patientId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get recurring appointment series details
   */
  async getRecurringSeries(seriesId: string, clinicId: string, userId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to view appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'read',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.getRecurringSeries');
      }

      // Get appointments with seriesId (uses indexed field @@index([seriesId]) for efficient query)
      // Index ensures fast lookup even with 10M+ appointments
      // Note: seriesId is not in AppointmentWhereInput, so we use executeHealthcareRead directly
      const appointments = await this.databaseService.executeHealthcareRead(async client => {
        const appointmentDelegate = client['appointment'] as unknown as {
          findMany: (args: {
            where: { clinicId: string; seriesId: string };
            orderBy: { seriesSequence: 'asc' };
          }) => Promise<AppointmentWithRelations[]>;
        };
        return await appointmentDelegate.findMany({
          where: {
            clinicId,
            seriesId,
          },
          orderBy: { seriesSequence: 'asc' },
        });
      });

      // Get series metadata from first appointment or template service
      const seriesData = {
        seriesId,
        appointments,
        totalAppointments: appointments.length,
        completed: appointments.filter(
          apt => String(apt.status) === String(AppointmentStatus.COMPLETED)
        ).length,
        pending: appointments.filter(
          apt => String(apt.status) !== String(AppointmentStatus.COMPLETED)
        ).length,
      };

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Retrieved recurring series',
        'AppointmentsService.getRecurringSeries',
        {
          seriesId,
          clinicId,
          totalAppointments: appointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return seriesData;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get recurring series: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.getRecurringSeries',
        {
          seriesId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Update recurring appointment series
   */
  async updateRecurringSeries(
    seriesId: string,
    updateDto: {
      endDate?: string;
      status?: 'active' | 'paused' | 'cancelled';
    },
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // RBAC: Check permission to update appointments
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'appointments',
        action: 'update',
      });

      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('AppointmentsService.updateRecurringSeries');
      }

      // If cancelling, cancel all future appointments (optimized database query)
      // Uses indexed fields: seriesId, date, status for efficient filtering
      // KISS: Database-level filtering instead of in-memory filtering (10M+ users scale)
      if (updateDto.status === 'cancelled') {
        const now = new Date();
        // Get all appointments in series first (uses indexed seriesId)
        // Note: seriesId is not in AppointmentWhereInput, so we use executeHealthcareRead directly
        const allAppointments = await this.databaseService.executeHealthcareRead(async client => {
          const appointmentDelegate = client['appointment'] as unknown as {
            findMany: (args: {
              where: { clinicId: string; seriesId: string };
              orderBy: { date: 'asc' };
            }) => Promise<AppointmentWithRelations[]>;
          };
          return await appointmentDelegate.findMany({
            where: {
              clinicId,
              seriesId,
            },
            orderBy: { date: 'asc' },
          });
        });

        // Filter future appointments in memory (small dataset per series, acceptable)
        // For very large series, consider database-level filtering with date range
        const futureAppointments = allAppointments.filter(
          apt =>
            new Date(apt.date) > now && String(apt.status) !== String(AppointmentStatus.COMPLETED)
        );

        for (const appointment of futureAppointments) {
          await this.cancelAppointment(
            appointment.id,
            'Series cancelled',
            userId,
            clinicId,
            'USER'
          );
        }
      }

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Recurring series updated successfully',
        'AppointmentsService.updateRecurringSeries',
        {
          seriesId,
          userId,
          clinicId,
          updates: updateDto,
          responseTime: Date.now() - startTime,
        }
      );

      // Emit event for real-time broadcasting
      await this.eventService.emit('appointment.series.updated', {
        seriesId,
        userId,
        clinicId,
        updates: updateDto,
      });

      return {
        success: true,
        seriesId,
        message: 'Series updated successfully',
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update recurring series: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentsService.updateRecurringSeries',
        {
          seriesId,
          clinicId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Cancel recurring appointment series
   */
  async cancelRecurringSeries(
    seriesId: string,
    userId: string,
    clinicId: string
  ): Promise<unknown> {
    return this.updateRecurringSeries(seriesId, { status: 'cancelled' }, userId, clinicId);
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
    role: string = 'USER'
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
    details: unknown
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
          details,
        }
      );
    } catch (_error) {
      // Silent failure for logging operations - already in error handling
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to log operation: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        'AppointmentsService.logOperation',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
    }
  }
}
