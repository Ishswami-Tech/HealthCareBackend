import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bull";
import { EventEmitterModule } from "@nestjs/event-emitter";

// Infrastructure Services
import { LoggingModule } from "../../libs/infrastructure/logging";
import { DatabaseModule } from "../../libs/infrastructure/database";
import { RbacModule } from "../../libs/core/rbac/rbac.module";
import { QueueModule } from "../../libs/infrastructure/queue";
import { AuthModule } from "../auth/auth.module";
import { JwtModule } from "@nestjs/jwt";
// import { RateLimitModule } from "../../libs/utils/rate-limit/rate-limit.module";
import { GuardsModule } from "../../libs/core/guards/guards.module";
// import { CommunicationModule } from '../../libs/communication';

// Core Services
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";

// Enhanced Core Services
import { CoreAppointmentService } from "./core/core-appointment.service";
import { ConflictResolutionService } from "./core/conflict-resolution.service";
import { AppointmentWorkflowEngine } from "./core/appointment-workflow-engine.service";
import { BusinessRulesEngine } from "./core/business-rules-engine.service";

// Plugin System - Updated with new libs structure
// import { AppointmentPluginRegistry } from './plugins/plugin.registry';
// import { AppointmentPluginManager } from './plugins/plugin.manager';
import { AppointmentEnterprisePluginManager } from "./plugins/enterprise-plugin-manager";
import { AppointmentPluginController } from "./plugins/plugin.controller";
// import { AppointmentPluginInitializer } from './plugins/plugin.initializer';
import { PluginConfigService } from "./plugins/config/plugin-config.service";
import { PluginHealthService } from "./plugins/health/plugin-health.service";

// Clinic-Specific Plugins - Updated with new libs structure
import { ClinicQueuePlugin } from "./plugins/queue/clinic-queue.plugin";
import { ClinicNotificationPlugin } from "./plugins/notifications/clinic-notification.plugin";
import { ClinicReminderPlugin } from "./plugins/reminders/clinic-reminder.plugin";
import { ClinicAnalyticsPlugin } from "./plugins/analytics/clinic-analytics.plugin";
import { ClinicFollowUpPlugin } from "./plugins/followup/clinic-followup.plugin";
import { ClinicLocationPlugin } from "./plugins/location/clinic-location.plugin";
import { ClinicConfirmationPlugin } from "./plugins/confirmation/clinic-confirmation.plugin";
import { ClinicCheckInPlugin } from "./plugins/checkin/clinic-checkin.plugin";
import { ClinicPaymentPlugin } from "./plugins/payment/clinic-payment.plugin";
import { ClinicVideoPlugin } from "./plugins/video/clinic-video.plugin";
import { AppointmentCommunicationsPlugin } from "./communications/appointment-communications.plugin";

// New Plugin Imports
import { ClinicTemplatePlugin } from "./plugins/templates/clinic-template.plugin";
import { ClinicWaitlistPlugin } from "./plugins/waitlist/clinic-waitlist.plugin";
import { ClinicResourcePlugin } from "./plugins/resources/clinic-resource.plugin";
import { ClinicEligibilityPlugin } from "./plugins/eligibility/clinic-eligibility.plugin";

// Service Dependencies - Updated with new libs structure
import { AppointmentQueueService } from "./plugins/queue/appointment-queue.service";
import { AppointmentNotificationService } from "./plugins/notifications/appointment-notification.service";
import { AppointmentReminderService } from "./plugins/reminders/appointment-reminder.service";
import { AppointmentAnalyticsService } from "./plugins/analytics/appointment-analytics.service";
import { AppointmentFollowUpService } from "./plugins/followup/appointment-followup.service";
import { AppointmentLocationService } from "./plugins/location/appointment-location.service";
import { AppointmentConfirmationService } from "./plugins/confirmation/appointment-confirmation.service";
import { CheckInService } from "./plugins/checkin/check-in.service";
import { PaymentService } from "./plugins/payment/payment.service";
import { VideoService } from "./plugins/video/video.service";
import { JitsiVideoService } from "./plugins/video/jitsi-video.service";
import { VideoConsultationTracker } from "./plugins/video/video-consultation-tracker.service";
import { AppointmentCommunicationsService } from "./communications/appointment-communications.service";

// New Service Imports
import { AppointmentTemplateService } from "./plugins/templates/appointment-template.service";
import { AppointmentWaitlistService } from "./plugins/waitlist/appointment-waitlist.service";
import { AppointmentResourceService } from "./plugins/resources/appointment-resource.service";
import { AppointmentEligibilityService } from "./plugins/eligibility/appointment-eligibility.service";
import { BusinessRulesDatabaseService } from "./core/business-rules-database.service";

import { QrService } from "../../libs/utils/QR";

// Communication Modules
import { EmailModule } from "../../libs/communication/messaging/email/email.module";
import { WhatsAppModule } from "../../libs/communication/messaging/whatsapp/whatsapp.module";
import { PushModule } from "../../libs/communication/messaging/push/push.module";
import { SocketModule } from "../../libs/communication/socket/socket.module";

/**
 * Enhanced Appointments Module
 *
 * Enterprise-grade appointment management with HIPAA compliance.
 * Features:
 * - Plugin-based architecture for extensibility
 * - Advanced queue management with BullMQ
 * - Conflict resolution and intelligent scheduling
 * - Business rules engine with configurable rules
 * - Multi-tenant clinic support
 * - Real-time updates via WebSocket
 * - Comprehensive audit logging
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    RbacModule,
    QueueModule.forRoot(),
    AuthModule,
    JwtModule.register({}),
    // RateLimitModule,
    GuardsModule,
    // Communication Modules
    EmailModule,
    WhatsAppModule,
    PushModule,
    SocketModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get("REDIS_HOST", "localhost"),
          port: configService.get("REDIS_PORT", 6379),
          ...(configService.get("REDIS_PASSWORD") && {
            password: configService.get("REDIS_PASSWORD"),
          }),
          db: configService.get("REDIS_DB", 0),
        },
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail: 500,
          attempts: 5,
          timeout: 60000,
        },
        settings: {
          stalledInterval: 30000,
          maxStalledCount: 1,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: "clinic-appointment" },
      { name: "clinic-notification" },
      { name: "clinic-payment" },
      { name: "clinic-video-call" },
      { name: "clinic-analytics" },
      { name: "clinic-reminder" },
      { name: "clinic-followup" },
    ),
    EventEmitterModule.forRoot(),
  ],
  controllers: [AppointmentsController, AppointmentPluginController],
  providers: [
    // Core Services
    AppointmentsService,
    CoreAppointmentService,
    ConflictResolutionService,
    AppointmentWorkflowEngine,
    BusinessRulesEngine,

    // Plugin System
    // AppointmentPluginRegistry,
    // AppointmentPluginManager,
    AppointmentEnterprisePluginManager,
    // AppointmentPluginInitializer,
    PluginConfigService,
    PluginHealthService,

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
    AppointmentQueueService,
    AppointmentNotificationService,
    AppointmentReminderService,
    AppointmentAnalyticsService,
    AppointmentFollowUpService,
    AppointmentLocationService,
    AppointmentConfirmationService,
    CheckInService,
    PaymentService,
    VideoService,
    JitsiVideoService,
    VideoConsultationTracker,
    AppointmentCommunicationsService,
    AppointmentTemplateService,
    AppointmentWaitlistService,
    AppointmentResourceService,
    AppointmentEligibilityService,
    BusinessRulesDatabaseService,
    QrService,
  ],
  exports: [
    // Core Services
    AppointmentsService,
    CoreAppointmentService,
    ConflictResolutionService,
    AppointmentWorkflowEngine,
    BusinessRulesEngine,

    // Plugin System
    // AppointmentPluginRegistry,
    // AppointmentPluginManager,
    AppointmentEnterprisePluginManager,
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
  ],
})
export class AppointmentsModule {}
