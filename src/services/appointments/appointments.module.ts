import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Infrastructure Services
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { EventsModule } from '@infrastructure/events';
import { CacheModule } from '@infrastructure/cache';
import { RbacModule } from '@core/rbac/rbac.module';
import { QueueModule } from '@infrastructure/queue';
import { AuthModule } from '@services/auth/auth.module';
import { GuardsModule } from '@core/guards/guards.module';
import { ClinicModule } from '@services/clinic/clinic.module';
// Core Services
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

// Enhanced Core Services
import { CoreAppointmentService } from './core/core-appointment.service';
import { ConflictResolutionService } from './core/conflict-resolution.service';
import { AppointmentWorkflowEngine } from './core/appointment-workflow-engine.service';
import { BusinessRulesEngine } from './core/business-rules-engine.service';

// Plugin System - Using centralized generic implementations
import { EnterprisePluginRegistry, EnterprisePluginManager } from '@core/plugin-interface';
import { AppointmentPluginController } from './plugins/plugin.controller';
import { PluginConfigService } from './plugins/config/plugin-config.service';
import { PluginHealthService } from './plugins/health/plugin-health.service';
import { AppointmentPluginInitializer } from './plugins/plugin-initializer.service';

// Clinic-Specific Plugins - Updated with new libs structure
import { ClinicQueuePlugin } from './plugins/queue/clinic-queue.plugin';

import { ClinicNotificationPlugin } from './plugins/notifications/clinic-notification.plugin';
import { ClinicReminderPlugin } from './plugins/reminders/clinic-reminder.plugin';
import { ClinicAnalyticsPlugin } from './plugins/analytics/clinic-analytics.plugin';
import { ClinicFollowUpPlugin } from './plugins/followup/clinic-followup.plugin';
import { ClinicLocationPlugin } from './plugins/location/clinic-location.plugin';
import { ClinicConfirmationPlugin } from './plugins/confirmation/clinic-confirmation.plugin';
import { ClinicCheckInPlugin } from './plugins/checkin/clinic-checkin.plugin';
import { ClinicPaymentPlugin } from './plugins/payment/clinic-payment.plugin';
import { ClinicVideoPlugin } from './plugins/video/clinic-video.plugin';
import { AppointmentCommunicationsPlugin } from './communications/appointment-communications.plugin';

// New Plugin Imports
import { ClinicTemplatePlugin } from './plugins/templates/clinic-template.plugin';
import { ClinicWaitlistPlugin } from './plugins/waitlist/clinic-waitlist.plugin';
import { ClinicResourcePlugin } from './plugins/resources/clinic-resource.plugin';
import { ClinicEligibilityPlugin } from './plugins/eligibility/clinic-eligibility.plugin';

// Service Dependencies - Updated with new libs structure

import { AppointmentNotificationService } from './plugins/notifications/appointment-notification.service';
import { AppointmentReminderService } from './plugins/reminders/appointment-reminder.service';
import { AppointmentAnalyticsService } from './plugins/analytics/appointment-analytics.service';
import { AppointmentFollowUpService } from './plugins/followup/appointment-followup.service';
import { AppointmentLocationService } from './plugins/location/appointment-location.service';
import { AppointmentConfirmationService } from './plugins/confirmation/appointment-confirmation.service';
import { CheckInService } from './plugins/checkin/check-in.service';
import { CheckInLocationService } from './plugins/therapy/check-in-location.service';
import { PaymentService } from './plugins/payment/payment.service';
// VideoService and VideoConsultationTracker are provided by VideoModule (imported below)
import { AppointmentCommunicationsService } from './communications/appointment-communications.service';

// New Service Imports
import { AppointmentTemplateService } from './plugins/templates/appointment-template.service';
import { AppointmentWaitlistService } from './plugins/waitlist/appointment-waitlist.service';
import { AppointmentResourceService } from './plugins/resources/appointment-resource.service';
import { AppointmentEligibilityService } from './plugins/eligibility/appointment-eligibility.service';
import { BusinessRulesDatabaseService } from './core/business-rules-database.service';

import { QrService } from '@utils/QR';
import { QrModule } from '@utils/QR/qr.module';

import { AppointmentQueueService } from './plugins/queue/appointment-queue.service';

// Video Module - Standalone service
import { VideoModule } from '@services/video/video.module';

// Communication Modules
import { CommunicationModule } from '@communication/communication.module';

/**
 * Enhanced Appointments Module
 *
 * Enterprise-grade appointment management with HIPAA compliance.
 * Features:
 * - Plugin-based architecture for extensibility (Hybrid Approach)
 * - Advanced queue management with BullMQ
 * - Conflict resolution and intelligent scheduling
 * - Business rules engine with configurable rules
 * - Multi-tenant clinic support
 * - Real-time updates via WebSocket
 * - Comprehensive audit logging
 *
 * Plugin System Architecture:
 * ============================
 * - Hybrid Approach: Direct injection for hot-path plugins + Registry for cross-service
 * - All plugins are registered via AppointmentPluginInitializer on module startup
 * - Hot-path plugins (top 5): Direct injection for 10M+ users scale optimization
 * - Other plugins: Registry-based for dynamic discovery and cross-service use
 * - Both approaches work seamlessly - plugins available via both methods
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    EventsModule,
    CacheModule, // Provides LocationCacheService
    RbacModule,
    QueueModule.forRoot(), // BullMQ queue system - provides QueueService with standard queues
    AuthModule, // AuthModule already provides JwtModule with proper configuration
    // RateLimitModule,
    GuardsModule,
    ClinicModule, // Provides ClinicLocationService for location data
    // Communication Modules - Unified module
    CommunicationModule,
    // QR Code Module
    QrModule,
    // Video Module (provides VideoService and video providers)
    VideoModule,
    // QueueModule.forRoot() registers standard queues using BullMQ:
    // - APPOINTMENT_QUEUE (appointment-queue)
    // - NOTIFICATION_QUEUE (notification-queue)
    // - ANALYTICS_QUEUE (analytics-queue)
    // - REMINDER_QUEUE (reminder-queue)
    // - FOLLOW_UP_QUEUE (follow-up-queue)
    // - PAYMENT_PROCESSING_QUEUE (payment-processing-queue)
    // All appointment services now use QueueService from @infrastructure/queue
    EventEmitterModule, // Already configured in AppModule with forRoot()
  ],
  controllers: [AppointmentsController, AppointmentPluginController],
  providers: [
    // Core Services
    AppointmentsService,
    CoreAppointmentService,
    ConflictResolutionService,
    AppointmentWorkflowEngine,
    BusinessRulesEngine,

    // Plugin System - Centralized generic implementations
    EnterprisePluginRegistry,
    EnterprisePluginManager,
    PluginConfigService,
    PluginHealthService,
    AppointmentPluginInitializer,

    // Clinic-Specific Plugins - All implemented plugins
    ClinicQueuePlugin,
    ClinicNotificationPlugin,
    ClinicReminderPlugin,
    ClinicAnalyticsPlugin,
    ClinicFollowUpPlugin,
    ClinicLocationPlugin,
    ClinicConfirmationPlugin,
    ClinicCheckInPlugin,
    ClinicPaymentPlugin,
    ClinicVideoPlugin,
    AppointmentCommunicationsPlugin,
    ClinicTemplatePlugin,
    ClinicWaitlistPlugin,
    ClinicResourcePlugin,
    ClinicEligibilityPlugin,

    // Service Dependencies - All implemented services

    AppointmentNotificationService,
    AppointmentReminderService,
    AppointmentAnalyticsService,
    AppointmentFollowUpService,
    AppointmentLocationService,
    AppointmentConfirmationService,
    CheckInService,
    CheckInLocationService,
    PaymentService,
    // VideoService and VideoConsultationTracker are provided by VideoModule (imported above)
    AppointmentCommunicationsService,
    AppointmentTemplateService,
    AppointmentWaitlistService,
    AppointmentResourceService,
    AppointmentEligibilityService,
    BusinessRulesDatabaseService,
    QrService,
    AppointmentQueueService,
  ],
  exports: [
    // Core Services
    AppointmentsService,
    CoreAppointmentService,
    ConflictResolutionService,
    AppointmentWorkflowEngine,
    BusinessRulesEngine,

    // Plugin System - Centralized generic implementations
    EnterprisePluginRegistry,
    EnterprisePluginManager,
    PluginConfigService,
    PluginHealthService,

    // Clinic Plugins - All implemented plugins
    ClinicQueuePlugin,
    ClinicNotificationPlugin,
    ClinicReminderPlugin,
    ClinicAnalyticsPlugin,
    ClinicFollowUpPlugin,
    ClinicLocationPlugin,
    ClinicConfirmationPlugin,
    ClinicCheckInPlugin,
    ClinicPaymentPlugin,
    ClinicVideoPlugin,
    AppointmentCommunicationsPlugin,
    ClinicTemplatePlugin,
    ClinicWaitlistPlugin,
    ClinicResourcePlugin,
    ClinicEligibilityPlugin,
    AppointmentQueueService,
  ],
})
export class AppointmentsModule {}
