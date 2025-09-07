import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Infrastructure Services
import { LoggingModule } from '../../libs/infrastructure/logging';
import { DatabaseModule } from '../../libs/infrastructure/database';
import { RbacModule } from '../../libs/core/rbac/rbac.module';
import { QueueModule } from '../../libs/infrastructure/queue';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { RateLimitModule } from '../../libs/utils/rate-limit/rate-limit.module';
import { GuardsModule } from '../../libs/core/guards/guards.module';
// import { CommunicationModule } from '../../libs/communication';

// Core Services
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

// Enhanced Core Services
import { CoreAppointmentService } from './core/core-appointment.service';
import { ConflictResolutionService } from './core/conflict-resolution.service';
import { AppointmentWorkflowEngine } from './core/appointment-workflow-engine.service';
import { BusinessRulesEngine } from './core/business-rules-engine.service';

// Plugin System - Updated with new libs structure
// import { AppointmentPluginRegistry } from './plugins/plugin.registry';
// import { AppointmentPluginManager } from './plugins/plugin.manager';
import { AppointmentEnterprisePluginManager } from './plugins/enterprise-plugin-manager';
import { AppointmentPluginController } from './plugins/plugin.controller';
// import { AppointmentPluginInitializer } from './plugins/plugin.initializer';
import { PluginConfigService } from './plugins/config/plugin-config.service';
import { PluginHealthService } from './plugins/health/plugin-health.service';

// Clinic-Specific Plugins - Updated with new libs structure
import { ClinicQueuePlugin } from './plugins/queue/clinic-queue.plugin';
// import { ClinicSocketPlugin } from './plugins/socket/clinic-socket.plugin';
// Other plugins will be created as needed
// import { ClinicLocationPlugin } from './plugins/location/clinic-location.plugin';
// import { ClinicConfirmationPlugin } from './plugins/confirmation/clinic-confirmation.plugin';
// import { ClinicCheckInPlugin } from './plugins/checkin/clinic-checkin.plugin';
// import { ClinicPaymentPlugin } from './plugins/payment/clinic-payment.plugin';
// import { ClinicVideoPlugin } from './plugins/video/clinic-video.plugin';

// Service Dependencies - Updated with new libs structure
// import { AppointmentSocketService } from './plugins/socket/appointment-socket.service';
import { AppointmentQueueService } from './plugins/queue/appointment-queue.service';
// Other services will be created as needed
// import { VideoService } from './plugins/video/video.service';
// import { CheckInService } from './plugins/checkin/check-in.service';
// import { AppointmentConfirmationService } from './plugins/confirmation/appointment-confirmation.service';
// import { AppointmentLocationService } from './plugins/location/appointment-location.service';
import { QrService } from '../../libs/utils/QR';

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
    RateLimitModule,
    GuardsModule,
    // CommunicationModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
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
      { name: 'clinic-appointment' },
      { name: 'clinic-notification' },
      { name: 'clinic-payment' },
      { name: 'clinic-video-call' },
      { name: 'clinic-analytics' },
      { name: 'clinic-reminder' },
      { name: 'clinic-followup' }
    ),
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    AppointmentsController, 
    AppointmentPluginController
  ],
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

    // Clinic-Specific Plugins - Only implemented plugins
    ClinicQueuePlugin,
    // ClinicSocketPlugin,
    // Other plugins commented out until implemented
    // ClinicLocationPlugin,
    // ClinicConfirmationPlugin,
    // ClinicCheckInPlugin,
    // ClinicPaymentPlugin,
    // ClinicVideoPlugin,

    // Service Dependencies - Only implemented services
    // AppointmentSocketService,
    AppointmentQueueService,
    // Other services commented out until implemented
    // VideoService,
    // CheckInService,
    // AppointmentConfirmationService,
    // AppointmentLocationService,
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

    // Clinic Plugins - Only implemented plugins
    ClinicQueuePlugin,
    // ClinicSocketPlugin,
    // Other plugins commented out until implemented
    // ClinicLocationPlugin,
    // ClinicConfirmationPlugin,
    // ClinicCheckInPlugin,
    // ClinicPaymentPlugin,
    // ClinicVideoPlugin,
  ],
})
export class AppointmentsModule {} 